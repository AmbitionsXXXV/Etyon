import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import type * as Ai from "ai"
import { afterAll, describe, expect, it, vi } from "vite-plus/test"

const { generateImageMock } = vi.hoisted(() => ({
  generateImageMock: vi.fn()
}))

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof Ai>()),
  generateImage: generateImageMock
}))

vi.mock("@/main/server/lib/providers", () => ({
  IMAGE_MODEL_ID: "gpt-image-2",
  resolveImageModel: () => ({ modelId: "gpt-image-2" })
}))

const { buildImagenTool, slugifyImageTitle } =
  await import("@/main/agents/minimal/imagen-tool")
const { getWorkspaceCore } =
  await import("@/main/agents/minimal/workspace-core")

const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "etyon-imagen-"))
const workspace = getWorkspaceCore(projectPath)
const tool = buildImagenTool(workspace)

const execute = async <TOutput>(input: unknown): Promise<TOutput> => {
  const { execute: executeTool } = tool as unknown as {
    execute: (inputData: never, context?: never) => Promise<unknown>
  }

  return (await executeTool(input as never)) as TOutput
}

afterAll(() => {
  fs.rmSync(projectPath, { force: true, recursive: true })
})

describe("slugifyImageTitle", () => {
  it("kebab-cases ascii titles and trims to a max length", () => {
    expect(slugifyImageTitle("A Cyberpunk Shiba!")).toBe("a-cyberpunk-shiba")
    expect(slugifyImageTitle("   spaced   out   ")).toBe("spaced-out")
  })

  it("falls back to 'image' when nothing survives slugification", () => {
    expect(slugifyImageTitle("柴犬")).toBe("image")
    expect(slugifyImageTitle("!!!")).toBe("image")
  })
})

describe("imagen tool", () => {
  it("generates an image, writes it under generated-images, and returns image metadata", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02])

    generateImageMock.mockResolvedValueOnce({
      images: [{ mediaType: "image/png", uint8Array: bytes }]
    })

    const output = await execute<{
      byteLength: number
      kind: string
      model: string
      path: string
      prompt: string
      title: string
    }>({
      prompt: "a neon shiba eating ramen",
      quality: "medium",
      size: "1024x1024",
      title: "Neon Shiba"
    })

    expect(output.kind).toBe("image")
    expect(output.model).toBe("gpt-image-2")
    expect(output.prompt).toBe("a neon shiba eating ramen")
    expect(output.title).toBe("Neon Shiba")
    expect(output.byteLength).toBe(6)
    expect(output.path.startsWith("generated-images/neon-shiba-")).toBe(true)
    expect(output.path.endsWith(".png")).toBe(true)

    const written = fs.readFileSync(path.join(projectPath, output.path))
    expect([...written]).toEqual([...bytes])

    const callArg = generateImageMock.mock.calls[0]?.[0] as {
      n: number
      prompt: string
      providerOptions: { openai: { outputFormat: string; quality: string } }
      size: string
    }
    expect(callArg.n).toBe(1)
    expect(callArg.size).toBe("1024x1024")
    expect(callArg.providerOptions.openai).toEqual({
      outputFormat: "png",
      quality: "medium"
    })
  })

  it("throws when the model returns no image", async () => {
    generateImageMock.mockResolvedValueOnce({ images: [] })

    await expect(
      execute({
        prompt: "empty",
        quality: "low",
        size: "1024x1024",
        title: "Empty"
      })
    ).rejects.toThrow(/no image/u)
  })
})
