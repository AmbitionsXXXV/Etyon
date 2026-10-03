import { randomUUID } from "node:crypto"
import { createServer } from "node:http"

const MODEL_ID = "qa-feature-model"
const ALT_MODEL_ID = "qa-candidate-alt"
const BROWSER_URL = "https://www.selenium.dev/selenium/web/web-form.html"
const MAX_REQUEST_BYTES = 512 * 1024
const QA_BROWSER_MARKER = /qa[-\s_]browser|(?:浏览器.*验收|验收.*浏览器)/iu
const QA_BASH_MARKER = /qa-bash-checkpoint/iu
const QA_BEST_OF_N_MARKER = /qa-best-of-n/iu
const QA_CAPTURE_MARKER =
  /qa-capture|QA selected text fixture|QA accessible text fixture/u
const BASH_QA_COMMAND = "printf 'bash qa change\\n' > checkpoint-qa.txt"
const state = {
  bashCheckpointCompleted: false,
  bashCheckpointStage: "idle",
  candidateCompletedCount: 0,
  capture: {
    accessibleTextPresent: false,
    image_parts: 0,
    selectedTextPresent: false
  },
  browserCompleted: false,
  browserStage: "idle",
  chatRequests: 0,
  invalidRequests: 0,
  modelRequests: 0,
  reviewerCompletedCount: 0,
  toolProposals: 0
}
const usage = { completion_tokens: 16, prompt_tokens: 64, total_tokens: 80 }
const record = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : null
const textContent = (value) => {
  if (typeof value === "string") {
    return value
  }
  if (!Array.isArray(value)) {
    return ""
  }
  return value
    .filter((part) => record(part)?.type === "text")
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("\n")
}
const parseValue = (value) => {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}
const browserSnapshot = (value, depth = 0) => {
  const object = record(value)
  if (!object || depth > 3) {
    return null
  }
  if (object.action === "read" && Array.isArray(object.elements)) {
    return object
  }
  for (const key of ["output", "result", "value"]) {
    const snapshot = browserSnapshot(object[key], depth + 1)
    if (snapshot) {
      return snapshot
    }
  }
  return null
}
const completedToolCalls = (messages, names) => {
  const calls = new Map()
  const outputs = []
  const seen = new Set()
  for (const message of messages) {
    if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) {
        if (
          names.includes(record(call.function)?.name) &&
          typeof call.id === "string"
        ) {
          calls.set(call.id, {
            input: parseValue(call.function.arguments),
            name: call.function.name
          })
        }
      }
    }
    if (
      message.role === "tool" &&
      calls.has(message.tool_call_id) &&
      !seen.has(message.tool_call_id)
    ) {
      const content = textContent(message.content)
      outputs.push({
        ...calls.get(message.tool_call_id),
        output: parseValue(content),
        text: content
      })
      seen.add(message.tool_call_id)
    }
  }
  return outputs
}
const hasTool = (body, name) =>
  Array.isArray(body.tools) &&
  body.tools.some((entry) => record(entry.function)?.name === name)
const proposeTool = (name, input) => {
  state.toolProposals += 1
  return {
    call: {
      function: { arguments: JSON.stringify(input), name },
      id: `call_qa_${randomUUID().replaceAll("-", "")}`,
      type: "function"
    }
  }
}
const resultRef = (results, type) => {
  for (const result of results.toReversed()) {
    const snapshot = browserSnapshot(result.output)
    if (!snapshot) {
      continue
    }
    let url
    try {
      url = new URL(snapshot.url)
    } catch {
      return null
    }
    if (
      url.protocol !== "https:" ||
      !["selenium.dev", "www.selenium.dev"].includes(url.hostname) ||
      url.pathname !== "/selenium/web/web-form.html"
    ) {
      return null
    }
    const element = snapshot.elements.find(
      (candidate) =>
        record(candidate)?.type === type && typeof candidate.ref === "string"
    )
    return element?.ref ?? null
  }
  return null
}
const browserReply = (body, messages) => {
  if (
    !Array.isArray(body.tools) ||
    !body.tools.some((entry) => record(entry.function)?.name === "browser")
  ) {
    state.browserStage = "missing_browser_tool"
    return {
      text: "本地 QA provider 已连接。运行 qa-browser 场景需要启用 Agent 并提供 browser 工具。"
    }
  }
  const results = completedToolCalls(messages, ["browser"])
  if (
    results.some(
      (result) =>
        !record(result.output) ||
        typeof record(result.output)?.error === "string" ||
        record(result.output)?.isError === true ||
        record(result.output)?.action !== record(result.input)?.action
    )
  ) {
    state.browserStage = "stopped_after_tool_error"
    return { text: "浏览器 QA 已停止：有工具调用被拒绝或返回错误。" }
  }
  const step = results.length
  if (step === 0) {
    state.browserCompleted = false
  }
  if (step >= 8) {
    state.browserCompleted = true
    state.browserStage = "completed"
    return {
      text: "浏览器 QA 工具链已完成：导航、读取 refs、填写测试文本、切换复选框、滚动、Tab 按键和最终读取。未提交表单。请在可见浏览器中复核文本和复选框状态。"
    }
  }
  const actions = [
    "navigate",
    "read",
    "type",
    "read",
    "click",
    "scroll",
    "press",
    "read"
  ]
  const action = actions[step]
  state.browserStage = `awaiting_${action}_result`
  let args = { action }
  if (action === "navigate") {
    args = { action, url: BROWSER_URL }
  }
  if (action === "type") {
    const ref = resultRef(results, "text")
    if (!ref) {
      state.browserStage = "failed_missing_text_ref"
      return {
        text: "浏览器 QA 未完成：实际 read 结果未提供 text 输入框 ref。"
      }
    }
    args = { action, append: false, ref, text: "etyon browser QA" }
  }
  if (action === "click") {
    const ref = resultRef(results, "checkbox")
    if (!ref) {
      state.browserStage = "failed_missing_checkbox_ref"
      return { text: "浏览器 QA 未完成：实际 read 结果未提供 checkbox ref。" }
    }
    args = { action, ref }
  }
  if (action === "scroll") {
    args = { action, deltaX: 0, deltaY: 240 }
  }
  if (action === "press") {
    args = { action, key: "Tab" }
  }
  return proposeTool("browser", args)
}
const markerIndex = (messages, pattern) => {
  let lastMatch = -1
  for (const [index, message] of messages.entries()) {
    if (message.role === "user" && pattern.test(textContent(message.content))) {
      lastMatch = index
    }
  }
  return lastMatch
}
const toolFailed = (result) => {
  const output = record(result.output)
  const text = typeof result.output === "string" ? result.output : result.text
  return (
    output?.isError === true ||
    typeof output?.error === "string" ||
    /^(?:error:|Tool execution denied|Denied|User denied)/iu.test(text)
  )
}
const bashReply = (body, messages) => {
  if (!hasTool(body, "bash")) {
    return { text: "Bash QA 未完成：缺少 bash 工具。" }
  }
  const results = completedToolCalls(messages, ["bash"])
  if (results.length === 0) {
    state.bashCheckpointCompleted = false
    state.bashCheckpointStage = "awaiting_bash_result"
    return proposeTool("bash", { command: BASH_QA_COMMAND })
  }
  const result = results.at(-1)
  const output = record(result.output)
  if (
    toolFailed(result) ||
    output?.status !== "completed" ||
    output?.exitCode !== 0
  ) {
    state.bashCheckpointStage = "stopped_after_tool_error"
    return { text: "Bash QA 未完成：调用未返回成功；不自动重试。" }
  }
  state.bashCheckpointCompleted = true
  state.bashCheckpointStage = "completed"
  return {
    text: "受控 Bash 写入已完成，未 commit。请使用 Checkpoint 预览 / 恢复入口复核 checkpoint-qa.txt。"
  }
}
const candidateReply = (body, messages) => {
  const results = completedToolCalls(messages, ["read", "write"])
  if (results.some(toolFailed)) {
    return { text: "候选 QA 已停止：有工具调用返回错误。" }
  }
  const read = results.find(
    (result) =>
      result.name === "read" && result.input?.path === "candidate-qa.txt"
  )
  if (!read) {
    if (!hasTool(body, "read")) {
      return { text: "候选 QA 未完成：缺少 read 工具。" }
    }
    return proposeTool("read", { path: "candidate-qa.txt" })
  }
  const readContent =
    record(read.output)?.content ??
    (typeof read.output === "string" ? read.output : read.text)
  if (typeof readContent !== "string" || readContent.length === 0) {
    return { text: "候选 QA 未完成：受控文件未成功读取。" }
  }
  const write = results.find(
    (result) =>
      result.name === "write" && result.input?.path === "candidate-qa.txt"
  )
  const label = body.model === ALT_MODEL_ID ? "B" : "A"
  if (!write) {
    return proposeTool("write", {
      content: `candidate ${label} QA change\n`,
      path: "candidate-qa.txt"
    })
  }
  if (typeof record(write.output)?.bytesWritten !== "number") {
    return { text: "候选 QA 未完成：没有成功写入证据。" }
  }
  state.candidateCompletedCount += 1
  return {
    text: `候选 ${label} 已读取并改写受控 candidate-qa.txt；尚未应用到主工作区，请复核差异。`
  }
}
const parseCandidates = (prompt) => {
  const header = prompt.lastIndexOf("\nCandidates:")
  if (header === -1) {
    return null
  }
  const start = prompt.indexOf("[", header)
  if (start === -1) {
    return null
  }
  let depth = 0
  let quoted = false
  let escaped = false
  let end = start
  for (const character of prompt.slice(start)) {
    end += character.length
    if (quoted) {
      if (escaped) {
        escaped = false
      } else if (character === "\\") {
        escaped = true
      } else if (character === '"') {
        quoted = false
      }
      continue
    }
    if (character === '"') {
      quoted = true
      continue
    }
    if (character === "[") {
      depth += 1
    }
    if (character === "]") {
      depth -= 1
      if (depth === 0) {
        return parseValue(prompt.slice(start, end))
      }
    }
  }
  return null
}
const reviewerReply = (prompt, messages) => {
  const candidates = parseCandidates(prompt)
  const first = Array.isArray(candidates) ? record(candidates[0]) : null
  if (typeof first?.id !== "string" || first.id.length === 0) {
    return { text: "Reviewer QA 未完成：没有可用的真实候选 ID。" }
  }
  const submitted = completedToolCalls(messages, ["submit_findings"])
  if (submitted.some(toolFailed)) {
    return { text: "Reviewer QA 未完成：结构化提交返回错误。" }
  }
  if (submitted.length) {
    state.reviewerCompletedCount += 1
    return { text: "受控结构化 review 已提交，未应用任何候选。" }
  }
  return proposeTool("submit_findings", {
    recommendation:
      "本地 QA fixture 推荐第一个已提供候选，仅用于验证结构化 review；选择前请人工检查真实差异和验证结果。",
    recommendedCandidateId: first.id
  })
}
const captureReply = (message) => {
  const text = textContent(message.content)
  const parts = Array.isArray(message.content) ? message.content : []
  state.capture = {
    accessibleTextPresent: text.includes("QA accessible text fixture"),
    image_parts: parts.filter((part) => record(part)?.type === "image_url")
      .length,
    selectedTextPresent: text.includes("QA selected text fixture")
  }
  return {
    text:
      state.capture.selectedTextPresent && state.capture.accessibleTextPresent
        ? "QA 捕获确认：模型请求同时含选中文本与辅助功能文本。图片数量已在受控状态中记录。"
        : "QA 捕获未完成：模型请求缺少预期的文本捕获标记。"
  }
}
const chooseReply = (body) => {
  const messages = Array.isArray(body.messages) ? body.messages : []
  const capture = markerIndex(messages, QA_CAPTURE_MARKER)
  const latestUserIndex = messages.findLastIndex(
    (message) => message.role === "user"
  )
  if (capture >= 0 && capture === latestUserIndex) {
    return captureReply(messages[capture])
  }
  const bestOfN = markerIndex(messages, QA_BEST_OF_N_MARKER)
  const bash = markerIndex(messages, QA_BASH_MARKER)
  const browser = markerIndex(messages, QA_BROWSER_MARKER)
  const latestScenario = Math.max(bestOfN, bash, browser)
  if (bestOfN >= 0 && bestOfN === latestScenario) {
    const prompt = textContent(messages[bestOfN].content)
    const transcript = messages.slice(bestOfN + 1)
    if (
      hasTool(body, "submit_findings") &&
      prompt.includes("independently produced")
    ) {
      return reviewerReply(prompt, transcript)
    }
    if (hasTool(body, "write")) {
      return candidateReply(body, transcript)
    }
    return {
      text: "Best-of-N QA 未完成：当前工具面不匹配候选或 reviewer 场景。"
    }
  }
  if (bash >= 0 && bash === latestScenario) {
    return bashReply(body, messages.slice(bash + 1))
  }
  if (browser >= 0) {
    return browserReply(body, messages.slice(browser + 1))
  }
  return {
    text: "本地 QA provider 可用：qa-browser / qa-bash-checkpoint / qa-best-of-n / qa-capture。"
  }
}

const sendJson = (response, status, value) => {
  response.writeHead(status, { "content-type": "application/json" })
  response.end(JSON.stringify(value))
}
const sendCompletion = (response, body, reply) => {
  const base = {
    created: Math.floor(Date.now() / 1000),
    id: `chatcmpl_qa_${randomUUID().replaceAll("-", "")}`,
    model: body.model === ALT_MODEL_ID ? ALT_MODEL_ID : MODEL_ID
  }
  const finishReason = reply.call ? "tool_calls" : "stop"
  if (!body.stream) {
    sendJson(response, 200, {
      ...base,
      choices: [
        {
          finish_reason: finishReason,
          index: 0,
          message: {
            content: reply.text ?? null,
            role: "assistant",
            ...(reply.call ? { tool_calls: [reply.call] } : {})
          }
        }
      ],
      object: "chat.completion",
      usage
    })
    return
  }
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": "text/event-stream"
  })
  const chunk = (delta, finish = null, extra = {}) =>
    response.write(
      `data: ${JSON.stringify({ ...base, choices: [{ delta, finish_reason: finish, index: 0 }], object: "chat.completion.chunk", ...extra })}\n\n`
    )
  chunk({ content: "", role: "assistant" })
  chunk(
    reply.call
      ? { tool_calls: [{ ...reply.call, index: 0 }] }
      : { content: reply.text }
  )
  chunk({}, finishReason)
  response.write(
    `data: ${JSON.stringify({ ...base, choices: [], object: "chat.completion.chunk", usage })}\n\n`
  )
  response.end("data: [DONE]\n\n")
}
const requestBody = async (request) => {
  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_REQUEST_BYTES) {
      throw new Error("QA request too large")
    }
    chunks.push(chunk)
  }
  const value = record(JSON.parse(Buffer.concat(chunks).toString("utf-8")))
  if (!value) {
    throw new Error("Invalid QA request")
  }
  return value
}
const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname
  if (request.method === "GET" && path === "/status") {
    sendJson(response, 200, state)
    return
  }
  if (request.method === "GET" && path === "/v1/models") {
    state.modelRequests += 1
    sendJson(response, 200, {
      data: [
        {
          context_window: 128000,
          created: 1,
          id: MODEL_ID,
          object: "model",
          owned_by: "etyon-local-qa"
        },
        {
          context_window: 128000,
          created: 1,
          id: ALT_MODEL_ID,
          object: "model",
          owned_by: "etyon-local-qa"
        }
      ],
      object: "list"
    })
    return
  }
  if (request.method !== "POST" || path !== "/v1/chat/completions") {
    sendJson(response, 404, { error: { message: "Unknown QA endpoint" } })
    return
  }
  state.chatRequests += 1
  try {
    const body = await requestBody(request)
    sendCompletion(response, body, chooseReply(body))
  } catch {
    state.invalidRequests += 1
    sendJson(response, 400, {
      error: {
        code: "qa_invalid_request",
        message: "Invalid QA completion request",
        param: null,
        type: "invalid_request_error"
      }
    })
  }
})
server.listen(0, "127.0.0.1", () => {
  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("No QA port")
  }
  process.stdout.write(
    `${JSON.stringify({ baseURL: `http://127.0.0.1:${address.port}/v1`, model: MODEL_ID, port: address.port, statusURL: `http://127.0.0.1:${address.port}/status` })}\n`
  )
})
const stop = () => {
  server.close()
  server.closeAllConnections()
}
process.once("SIGINT", stop)
process.once("SIGTERM", stop)
