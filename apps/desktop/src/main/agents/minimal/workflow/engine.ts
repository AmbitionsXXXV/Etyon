import vm from "node:vm"

import type { Node } from "acorn"
import { parse } from "acorn"

/**
 * Deterministic multi-agent workflow engine (ported from pi-dynamic-workflows).
 *
 * A model-authored JavaScript script orchestrates many sub-agents through the
 * injected `agent()`/`parallel()`/`pipeline()` globals. The script runs in a
 * node:vm context that exposes only a curated set of globals — no require, fs,
 * network, or process — plus a determinism blocklist and a literal-only `meta`
 * parser.
 *
 * THREAT MODEL: scripts are MODEL-AUTHORED and semi-trusted, not adversarial
 * third-party input. node:vm is NOT a hard security boundary (host constructors
 * remain reachable via `.constructor.constructor`), so this is defense against
 * a buggy/confused script, not a sandbox for hostile code. If workflow scripts
 * ever become untrusted, move to isolated-vm / QuickJS and stop injecting real
 * host constructors.
 * Since plan 006, script execution is approval-gated outside bypass mode
 * (needsWorkflowApproval), so a hostile script additionally requires explicit
 * user consent — approval is the boundary; the vm is only accident containment.
 * The `runAgent` seam is separately responsible for keeping
 * every spawned agent within its own permission envelope.
 */

export interface WorkflowMetaPhase {
  detail?: string
  model?: string
  title: string
}

export interface WorkflowMeta {
  description: string
  name: string
  phases?: WorkflowMetaPhase[]
  whenToUse?: string
}

export interface WorkflowAgentOptions {
  label?: string
  model?: string
  phase?: string
  schema?: unknown
}

/** The single seam binding the engine to the host agent runtime. */
export type WorkflowRunAgent = (input: {
  label: string
  phase: string | undefined
  prompt: string
  schema: unknown
  model: string | undefined
  signal: AbortSignal | undefined
}) => Promise<unknown>

export interface WorkflowRunOptions {
  args?: unknown
  concurrency?: number
  onAgentEnd?: (event: {
    label: string
    phase: string | undefined
    result: unknown
  }) => void
  onAgentStart?: (event: {
    label: string
    phase: string | undefined
    prompt: string
  }) => void
  onLog?: (message: string) => void
  onPhase?: (title: string) => void
  runAgent: WorkflowRunAgent
  signal?: AbortSignal
  startedAtMs: number
  tokenBudget?: number | null
}

export interface WorkflowRunResult<TResult = unknown> {
  agentCount: number
  durationMs: number
  logs: string[]
  meta: WorkflowMeta
  phases: string[]
  result: TResult
}

interface RuntimeState {
  agentCount: number
  currentPhase: string | undefined
  logs: string[]
  phases: string[]
  spent: number
}

type LiteralNode = Node & Record<string, unknown>

const MAX_CONCURRENCY = 16
const DEFAULT_CONCURRENCY = 8
const MAX_TOTAL_AGENTS = 1000
const VM_SYNC_TIMEOUT_MS = 5000
const TOKEN_ESTIMATE_DIVISOR = 4
const DETERMINISM_ERROR =
  "Workflow scripts must be deterministic: Date.now()/Math.random()/new Date() are unavailable"

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const estimateTokens = (value: unknown): number =>
  Math.ceil(JSON.stringify(value ?? "").length / TOKEN_ESTIMATE_DIVISOR)

const defaultAgentLabel = (phase: string | undefined, index: number): string =>
  phase ? `${phase} agent ${index}` : `agent ${index}`

const isBlockedDeterminismNode = (node: LiteralNode): boolean => {
  if (node.type === "NewExpression") {
    const callee = node.callee as LiteralNode

    return (
      callee?.type === "Identifier" &&
      callee.name === "Date" &&
      (node.arguments as unknown[]).length === 0
    )
  }

  if (node.type !== "CallExpression") {
    return false
  }

  const callee = node.callee as LiteralNode

  if (callee?.type !== "MemberExpression" || callee.computed) {
    return false
  }

  const object = callee.object as LiteralNode
  const property = callee.property as LiteralNode
  const memberName = `${String(object?.name)}.${String(property?.name)}`

  return memberName === "Date.now" || memberName === "Math.random"
}

const containsBlockedDeterminismNode = (node: unknown): boolean => {
  if (!node || typeof node !== "object") {
    return false
  }

  const value = node as LiteralNode

  if (isBlockedDeterminismNode(value)) {
    return true
  }

  for (const child of Object.values(value)) {
    const blocked = Array.isArray(child)
      ? child.some(containsBlockedDeterminismNode)
      : containsBlockedDeterminismNode(child)

    if (blocked) {
      return true
    }
  }

  return false
}

// A bounded concurrency gate. Excess calls queue and run as slots free up.
const createLimiter = (limit: number) => {
  let active = 0
  const queue: (() => void)[] = []
  const releaseNext = (): void => {
    active -= 1
    queue.shift()?.()
  }

  return async <TValue>(task: () => Promise<TValue>): Promise<TValue> => {
    if (active >= limit) {
      const gate = Promise.withResolvers<undefined>()
      queue.push(() => gate.resolve())
      await gate.promise
    }

    active += 1

    try {
      return await task()
    } finally {
      releaseNext()
    }
  }
}

const propertyKey = (node: LiteralNode, path: string): string => {
  if (node.type === "Identifier") {
    return node.name as string
  }

  if (
    node.type === "Literal" &&
    (typeof node.value === "string" || typeof node.value === "number")
  ) {
    return String(node.value)
  }

  throw new Error(`unsupported key type in ${path}: ${node.type}`)
}

// Evaluates the `meta` initializer from AST literals only — no execution, no
// identifiers, no calls — so parsing meta can never run script code.
const evaluateLiteral = (node: LiteralNode, path: string): unknown => {
  switch (node.type) {
    case "ObjectExpression": {
      const out: Record<string, unknown> = {}

      for (const prop of node.properties as LiteralNode[]) {
        if (prop.type === "SpreadElement") {
          throw new Error(`spread not allowed in ${path}`)
        }

        if (prop.type !== "Property") {
          throw new Error(`only plain properties allowed in ${path}`)
        }

        if (prop.computed) {
          throw new Error(`computed keys not allowed in ${path}`)
        }

        if (prop.kind !== "init" || prop.method) {
          throw new Error(`methods/accessors not allowed in ${path}`)
        }

        const key = propertyKey(prop.key as LiteralNode, path)

        if (
          key === "__proto__" ||
          key === "constructor" ||
          key === "prototype"
        ) {
          throw new Error(`reserved key name not allowed in ${path}: ${key}`)
        }

        out[key] = evaluateLiteral(prop.value as LiteralNode, `${path}.${key}`)
      }

      return out
    }
    case "ArrayExpression": {
      return (node.elements as (LiteralNode | null)[]).map((element, index) => {
        if (!element) {
          throw new Error(`sparse arrays not allowed in ${path}`)
        }

        if (element.type === "SpreadElement") {
          throw new Error(`spread not allowed in ${path}`)
        }

        return evaluateLiteral(element, `${path}[${index}]`)
      })
    }
    case "Literal": {
      return node.value
    }
    case "TemplateLiteral": {
      if ((node.expressions as unknown[]).length > 0) {
        throw new Error(`template interpolation not allowed in ${path}`)
      }

      return (node.quasis as { value: { cooked?: string; raw: string } }[])
        .map((quasi) => quasi.value.cooked ?? quasi.value.raw)
        .join("")
    }
    case "UnaryExpression": {
      const argument = node.argument as LiteralNode | undefined

      if (
        node.operator === "-" &&
        argument?.type === "Literal" &&
        typeof argument.value === "number"
      ) {
        return -argument.value
      }

      throw new Error(`only negative-number unary allowed in ${path}`)
    }
    default: {
      throw new Error(`non-literal node type in ${path}: ${node.type}`)
    }
  }
}

// A function declaration (not an arrow) because assertion signatures require
// the call target to have an explicit, hoistable type annotation (TS2775).
function validateMeta(meta: unknown): asserts meta is WorkflowMeta {
  if (!meta || typeof meta !== "object") {
    throw new Error("meta must be an object")
  }

  const value = meta as WorkflowMeta

  if (typeof value.name !== "string" || value.name.trim().length === 0) {
    throw new Error("meta.name must be a non-empty string")
  }

  if (
    typeof value.description !== "string" ||
    value.description.trim().length === 0
  ) {
    throw new Error("meta.description must be a non-empty string")
  }

  if (value.whenToUse !== undefined && typeof value.whenToUse !== "string") {
    throw new Error("meta.whenToUse must be a string")
  }

  if (value.phases !== undefined) {
    if (!Array.isArray(value.phases)) {
      throw new TypeError("meta.phases must be an array")
    }

    for (const phase of value.phases) {
      if (
        !phase ||
        typeof phase !== "object" ||
        typeof (phase as WorkflowMetaPhase).title !== "string"
      ) {
        throw new Error("each meta phase must have a title string")
      }
    }
  }
}

/**
 * Splits a workflow script into its validated `meta` object and the executable
 * body. Rejects non-deterministic constructs and any `meta` that is not the
 * first statement or is not a plain literal.
 */
export const parseWorkflowScript = (
  script: string
): { body: string; meta: WorkflowMeta } => {
  const ast = parse(script, {
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
    ecmaVersion: "latest",
    ranges: false,
    sourceType: "module"
  }) as unknown as { body: LiteralNode[] }

  if (containsBlockedDeterminismNode(ast)) {
    throw new Error(DETERMINISM_ERROR)
  }

  const [first] = ast.body

  if (first?.type !== "ExportNamedDeclaration") {
    throw new Error(
      "`export const meta = { name, description, phases }` must be the first statement in the script"
    )
  }

  const declaration = first.declaration as LiteralNode | null

  if (
    declaration?.type !== "VariableDeclaration" ||
    declaration.kind !== "const"
  ) {
    throw new Error("meta export must be `export const meta = ...`")
  }

  const declarators = declaration.declarations as LiteralNode[]

  if (declarators.length !== 1) {
    throw new Error("meta export must declare only `meta`")
  }

  const declarator = declarators[0] as LiteralNode
  const id = declarator.id as LiteralNode

  if (id?.type !== "Identifier" || id.name !== "meta") {
    throw new Error("meta export must declare `meta`")
  }

  if (!declarator.init) {
    throw new Error("meta must have a literal value")
  }

  const meta = evaluateLiteral(declarator.init as LiteralNode, "meta")

  validateMeta(meta)

  const start = first.start as number
  const end = first.end as number

  return { body: script.slice(0, start) + script.slice(end), meta }
}

/**
 * Parses and runs a workflow script. `runAgent` is the host seam every
 * `agent()` call routes through; the engine adds fan-out (`parallel`),
 * per-item pipelining (`pipeline`), phase/log progress, a concurrency limiter,
 * a token budget, and abort propagation. Sub-agent failures resolve to `null`
 * (fail-soft) so a script can synthesize partial results; only an abort rethrows.
 */
export const runWorkflow = async <TResult = unknown>(
  script: string,
  options: WorkflowRunOptions
): Promise<WorkflowRunResult<TResult>> => {
  const { body, meta } = parseWorkflowScript(script)
  const state: RuntimeState = {
    agentCount: 0,
    currentPhase: undefined,
    logs: [],
    phases: [],
    spent: 0
  }
  const concurrency = Math.max(
    1,
    Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, MAX_CONCURRENCY)
  )
  const limiter = createLimiter(concurrency)
  const tokenBudget = options.tokenBudget ?? null

  const log = (message: unknown): void => {
    const text = String(message)
    state.logs.push(text)
    options.onLog?.(text)
  }

  const phase = (title: string): void => {
    state.currentPhase = title

    if (!state.phases.includes(title)) {
      state.phases.push(title)
    }

    options.onPhase?.(title)
  }

  const budget = Object.freeze({
    remaining: () =>
      tokenBudget === null
        ? Number.POSITIVE_INFINITY
        : Math.max(0, tokenBudget - state.spent),
    spent: () => state.spent,
    total: tokenBudget
  })

  const throwIfAborted = (): void => {
    if (options.signal?.aborted) {
      throw new Error("workflow aborted")
    }
  }

  const agent = (
    prompt: string,
    agentOptions: WorkflowAgentOptions = {}
  ): Promise<unknown> => {
    throwIfAborted()

    if (tokenBudget !== null && budget.remaining() <= 0) {
      throw new Error("workflow token budget exhausted")
    }

    if (state.agentCount >= MAX_TOTAL_AGENTS) {
      throw new Error(`workflow exceeded ${MAX_TOTAL_AGENTS} agents`)
    }

    const assignedPhase = agentOptions.phase ?? state.currentPhase
    const requestedLabel = agentOptions.label?.trim()
    state.agentCount += 1
    const agentIndex = state.agentCount

    return limiter(async () => {
      const label =
        requestedLabel && requestedLabel.length > 0
          ? requestedLabel
          : defaultAgentLabel(assignedPhase, agentIndex)
      options.onAgentStart?.({ label, phase: assignedPhase, prompt })

      try {
        throwIfAborted()
        const result = await options.runAgent({
          label,
          phase: assignedPhase,
          prompt,
          schema: agentOptions.schema,
          model: agentOptions.model,
          signal: options.signal
        })
        throwIfAborted()
        state.spent += estimateTokens(result)
        options.onAgentEnd?.({ label, phase: assignedPhase, result })

        return result
      } catch (error) {
        if (options.signal?.aborted) {
          throw error
        }

        log(`agent ${label} failed: ${describeError(error)}`)
        options.onAgentEnd?.({ label, phase: assignedPhase, result: null })

        return null
      }
    })
  }

  const parallel = (thunks: (() => Promise<unknown>)[]): Promise<unknown[]> => {
    throwIfAborted()

    if (!Array.isArray(thunks)) {
      throw new TypeError("parallel() expects an array of functions")
    }

    if (thunks.some((thunk) => typeof thunk !== "function")) {
      throw new TypeError(
        "parallel() expects an array of functions, not promises. Wrap each call: () => agent(...)"
      )
    }

    return Promise.all(
      thunks.map(async (thunk, index) => {
        try {
          return await thunk()
        } catch (error) {
          if (options.signal?.aborted) {
            throw error
          }

          log(`parallel[${index}] failed: ${describeError(error)}`)

          return null
        }
      })
    )
  }

  const pipeline = (
    items: unknown[],
    ...stages: ((prev: unknown, original: unknown, index: number) => unknown)[]
  ): Promise<unknown[]> => {
    throwIfAborted()

    if (!Array.isArray(items)) {
      throw new TypeError("pipeline() expects an array as the first argument")
    }

    if (stages.some((stage) => typeof stage !== "function")) {
      throw new TypeError(
        "pipeline() stages must be functions: pipeline(items, item => ..., result => ...)"
      )
    }

    return Promise.all(
      items.map(async (item, index) => {
        let value: unknown = item

        for (const stage of stages) {
          try {
            throwIfAborted()
            value = await stage(value, item, index)
            throwIfAborted()
          } catch (error) {
            if (options.signal?.aborted) {
              throw error
            }

            log(`pipeline[${index}] failed: ${describeError(error)}`)

            return null
          }
        }

        return value
      })
    )
  }

  const context = vm.createContext({
    Array,
    Boolean,
    JSON,
    Map,
    Math,
    Number,
    Object,
    Promise,
    Set,
    String,
    agent,
    args: options.args,
    budget,
    console: {
      error: (message: unknown) => log(`[error] ${String(message)}`),
      info: log,
      log,
      warn: (message: unknown) => log(`[warn] ${String(message)}`)
    },
    log,
    parallel,
    phase,
    pipeline
  })

  const wrapped = `(async () => {\n${body}\n})()`
  // This only bounds synchronous execution between await suspension points.
  const result = await new vm.Script(wrapped, {
    filename: `${meta.name}.js`
  }).runInContext(context, {
    timeout: VM_SYNC_TIMEOUT_MS
  })

  return {
    agentCount: state.agentCount,
    durationMs: Date.now() - options.startedAtMs,
    logs: state.logs,
    meta,
    phases: state.phases,
    result: result as TResult
  }
}
