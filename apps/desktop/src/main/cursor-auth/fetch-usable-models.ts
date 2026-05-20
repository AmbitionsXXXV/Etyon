/* oxlint-disable promise/no-multiple-resolved -- HTTP/2 callbacks settle through guarded `complete` */
import * as http2 from "node:http2"

import { create, fromBinary, toBinary } from "@bufbuild/protobuf"
import type { StoredProviderModel } from "@etyon/rpc"

import {
  GetUsableModelsRequestSchema,
  GetUsableModelsResponseSchema
} from "./proto/agent-pb"

const CURSOR_BASE_URL = "https://api2.cursor.sh"
const CURSOR_CLIENT_VERSION = "cli-2026.02.13-41ac335"
const GET_USABLE_MODELS_PATH = "/agent.v1.AgentService/GetUsableModels"
const FETCH_TIMEOUT_MS = 15_000

const hasConnectCompressionFlag = (flags: number): boolean => flags % 2 === 1

const hasConnectTrailerFlag = (flags: number): boolean =>
  Math.floor(flags / 2) % 2 === 1

const decodeConnectUnaryBody = (payload: Uint8Array): Uint8Array | null => {
  if (payload.length < 5) {
    return null
  }

  let offset = 0

  while (offset + 5 <= payload.length) {
    const flags = payload[offset]

    if (flags === undefined) {
      return null
    }

    const view = new DataView(
      payload.buffer,
      payload.byteOffset + offset,
      payload.byteLength - offset
    )
    const messageLength = view.getUint32(1, false)
    const frameEnd = offset + 5 + messageLength

    if (frameEnd > payload.length) {
      return null
    }

    if (hasConnectCompressionFlag(flags)) {
      return null
    }

    if (!hasConnectTrailerFlag(flags)) {
      return payload.subarray(offset + 5, frameEnd)
    }

    offset = frameEnd
  }

  return null
}

const decodeGetUsableModelsResponse = (payload: Uint8Array): unknown => {
  if (payload.length === 0) {
    return null
  }

  const framedBody = decodeConnectUnaryBody(payload)

  if (framedBody) {
    try {
      return fromBinary(GetUsableModelsResponseSchema, framedBody)
    } catch {
      // fall through to raw protobuf
    }
  }

  try {
    return fromBinary(GetUsableModelsResponseSchema, payload)
  } catch {
    return null
  }
}

const fetchViaHttp2 = (
  body: Uint8Array,
  accessToken: string
): Promise<Uint8Array | null> =>
  // eslint-disable-next-line promise/avoid-new -- HTTP/2 client API is callback-driven
  new Promise((resolve) => {
    const client = http2.connect(CURSOR_BASE_URL)
    const chunks: Buffer[] = []
    let statusOk = false
    let settled = false
    let outcome: Uint8Array | null = null

    const complete = () => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeout)
      resolve(outcome)
    }

    const timeout = setTimeout(() => {
      client.destroy()
      outcome = null
      complete()
    }, FETCH_TIMEOUT_MS)

    client.on("error", () => {
      outcome = null
      complete()
    })

    const stream = client.request({
      ":method": "POST",
      ":path": GET_USABLE_MODELS_PATH,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/proto",
      te: "trailers",
      "x-cursor-client-type": "cli",
      "x-cursor-client-version": CURSOR_CLIENT_VERSION,
      "x-ghost-mode": "true"
    })

    stream.on("response", (headers) => {
      const status = headers[":status"]
      statusOk = typeof status === "number" && status >= 200 && status < 300
    })

    stream.on("data", (chunk: Buffer) => {
      chunks.push(chunk)
    })

    stream.on("end", () => {
      client.close()
      outcome = statusOk ? new Uint8Array(Buffer.concat(chunks)) : null
      complete()
    })

    stream.on("error", () => {
      client.close()
      outcome = null
      complete()
    })

    stream.write(body)
    stream.end()
  })

const pickDisplayName = (
  model: Record<string, unknown>,
  fallbackId: string
): string => {
  const candidates = [
    model.displayName,
    model.displayNameShort,
    model.displayModelId
  ]

  const { aliases } = model

  if (Array.isArray(aliases)) {
    candidates.push(...aliases)
  }

  candidates.push(fallbackId)

  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const trimmed = candidate.trim()

      if (trimmed) {
        return trimmed
      }
    }
  }

  return fallbackId
}

const normalizeSingleModel = (model: unknown): StoredProviderModel | null => {
  if (!model || typeof model !== "object") {
    return null
  }

  const record = model as Record<string, unknown>
  const id = typeof record.modelId === "string" ? record.modelId.trim() : ""

  if (!id) {
    return null
  }

  const reasoning = Boolean(record.thinkingDetails)

  return {
    capabilities: {
      functionCalling: true,
      reasoning,
      streaming: true,
      vision: true
    },
    id,
    isManual: undefined,
    name: pickDisplayName(record, id)
  }
}

const normalizeModels = (models: unknown[]): StoredProviderModel[] => {
  const byId = new Map<string, StoredProviderModel>()

  for (const model of models) {
    const normalized = normalizeSingleModel(model)

    if (normalized) {
      byId.set(normalized.id, normalized)
    }
  }

  return [...byId.values()].toSorted((left, right) =>
    left.id.localeCompare(right.id)
  )
}

export const fetchCursorUsableModels = async (
  accessToken: string
): Promise<StoredProviderModel[] | null> => {
  try {
    const requestPayload = create(GetUsableModelsRequestSchema, {})
    const body = toBinary(GetUsableModelsRequestSchema, requestPayload)
    const responseBuffer = await fetchViaHttp2(body, accessToken)

    if (!responseBuffer) {
      return null
    }

    const decoded = decodeGetUsableModelsResponse(responseBuffer)

    if (!decoded || typeof decoded !== "object" || decoded === null) {
      return null
    }

    const { models } = decoded as { models?: unknown[] }

    if (!Array.isArray(models) || models.length === 0) {
      return null
    }

    return normalizeModels(models)
  } catch {
    return null
  }
}
