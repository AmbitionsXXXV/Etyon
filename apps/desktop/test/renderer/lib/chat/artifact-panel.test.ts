import type {
  ArtifactReadErrorReason,
  ReadArtifactFileOutput
} from "@etyon/rpc"
import { describe, expect, it } from "vite-plus/test"

import {
  buildArtifactSrcDoc,
  collectPublishedArtifactRefs,
  deriveArtifactPanelView,
  getPublishedArtifactRef,
  isArtifactToolPart
} from "@/renderer/lib/chat/artifact-panel"
import type { ChatToolPart } from "@/renderer/lib/chat/message-tool-trace"

const publishedPart = {
  input: { path: "artifacts/report.html", title: "Report" },
  output: {
    byteLength: 128,
    kind: "html",
    path: "artifacts/report.html",
    title: "Report"
  },
  state: "output-available",
  toolCallId: "tc-artifact",
  type: "tool-artifact"
} as unknown as ChatToolPart

describe("artifact tool parts", () => {
  it("recognizes static and dynamic artifact tool parts", () => {
    expect(isArtifactToolPart(publishedPart)).toBe(true)
    expect(
      isArtifactToolPart({
        state: "output-available",
        toolCallId: "tc",
        toolName: "artifact",
        type: "dynamic-tool"
      })
    ).toBe(true)
    expect(isArtifactToolPart({ type: "tool-write" })).toBe(false)
    expect(isArtifactToolPart({ type: "text" })).toBe(false)
    expect(isArtifactToolPart(null)).toBe(false)
  })

  it("does not treat imagen parts as artifacts (images render inline)", () => {
    expect(isArtifactToolPart({ type: "tool-imagen" })).toBe(false)
    expect(
      isArtifactToolPart({ toolName: "imagen", type: "dynamic-tool" })
    ).toBe(false)
  })

  it("extracts a published artifact ref from a finished part", () => {
    expect(getPublishedArtifactRef(publishedPart)).toEqual({
      kind: "html",
      path: "artifacts/report.html",
      title: "Report",
      toolCallId: "tc-artifact"
    })
  })

  it("returns null for image kinds, unfinished, or malformed parts", () => {
    expect(
      getPublishedArtifactRef({
        ...publishedPart,
        output: {
          kind: "image",
          path: "generated-images/a.png",
          title: "A"
        }
      } as unknown as ChatToolPart)
    ).toBeNull()
    expect(
      getPublishedArtifactRef({
        ...publishedPart,
        state: "input-available"
      } as unknown as ChatToolPart)
    ).toBeNull()
    expect(
      getPublishedArtifactRef({
        ...publishedPart,
        output: { kind: "pdf", path: "a.pdf" }
      } as unknown as ChatToolPart)
    ).toBeNull()
  })

  it("collects published artifacts from assistant messages only", () => {
    const refs = collectPublishedArtifactRefs([
      { parts: [publishedPart], role: "user" },
      {
        parts: [{ text: "hi", type: "text" }, publishedPart],
        role: "assistant"
      }
    ])

    expect(refs).toHaveLength(1)
    expect(refs[0]?.toolCallId).toBe("tc-artifact")
  })
})

describe("buildArtifactSrcDoc", () => {
  it("injects the CSP meta directly after a leading doctype", () => {
    const srcDoc = buildArtifactSrcDoc({
      html: "<!doctype html><html><head></head><body>hi</body></html>",
      theme: "dark"
    })

    expect(
      srcDoc.startsWith(
        '<!doctype html><meta http-equiv="Content-Security-Policy"'
      )
    ).toBe(true)
    expect(srcDoc).toContain("default-src 'none'")
    expect(srcDoc).toContain("connect-src 'none'")
    expect(srcDoc).toContain('<meta name="color-scheme" content="dark">')
    expect(srcDoc).toContain('document.documentElement.dataset.theme="dark"')
  })

  it("prepends a doctype and the policy when the document has none", () => {
    const srcDoc = buildArtifactSrcDoc({
      html: "<div>fragment</div>",
      theme: "light"
    })

    expect(
      srcDoc.startsWith(
        '<!doctype html><meta http-equiv="Content-Security-Policy"'
      )
    ).toBe(true)
    expect(srcDoc.endsWith("<div>fragment</div>")).toBe(true)
    expect(srcDoc).toContain('document.documentElement.dataset.theme="light"')
  })

  it("keeps the policy ahead of author markup even with scripts before head", () => {
    const srcDoc = buildArtifactSrcDoc({
      html: "<script>exfil()</script><head><title>x</title></head>",
      theme: "light"
    })

    expect(srcDoc.indexOf("Content-Security-Policy")).toBeLessThan(
      srcDoc.indexOf("exfil()")
    )
  })
})

const okData = (recovery: {
  restoredFromSnapshot: boolean
  workspaceRecreated: boolean
}): ReadArtifactFileOutput => ({
  content: "<h1>hi</h1>",
  language: "html",
  relativePath: "artifacts/report.html",
  restoredFromSnapshot: recovery.restoredFromSnapshot,
  status: "ok",
  workspaceRecreated: recovery.workspaceRecreated
})

const errorData = (
  reason: ArtifactReadErrorReason,
  workspaceRecreated: boolean
): ReadArtifactFileOutput => ({
  reason,
  status: "error",
  workspaceRecreated
})

const ERROR_REASONS: ArtifactReadErrorReason[] = [
  "binary-file",
  "file-missing",
  "io-error",
  "not-file",
  "outside-project",
  "too-large"
]

describe("deriveArtifactPanelView", () => {
  it("returns loading while the query is loading", () => {
    expect(
      deriveArtifactPanelView({
        data: undefined,
        isError: false,
        isLoading: true
      })
    ).toEqual({ kind: "loading" })
  })

  it("maps a thrown request to a transport error", () => {
    expect(
      deriveArtifactPanelView({
        data: undefined,
        isError: true,
        isLoading: false
      })
    ).toEqual({ kind: "error", reason: "transport", workspaceRecreated: false })
  })

  it("maps a settled query with no body to a transport error", () => {
    expect(
      deriveArtifactPanelView({
        data: undefined,
        isError: false,
        isLoading: false
      })
    ).toEqual({ kind: "error", reason: "transport", workspaceRecreated: false })
  })

  it("maps a plain ok response to ready without a notice", () => {
    expect(
      deriveArtifactPanelView({
        data: okData({
          restoredFromSnapshot: false,
          workspaceRecreated: false
        }),
        isError: false,
        isLoading: false
      })
    ).toEqual({
      content: "<h1>hi</h1>",
      kind: "ready",
      language: "html",
      notice: null
    })
  })

  it("surfaces a workspace-recreated notice on an ok response", () => {
    expect(
      deriveArtifactPanelView({
        data: okData({ restoredFromSnapshot: false, workspaceRecreated: true }),
        isError: false,
        isLoading: false
      })
    ).toEqual({
      content: "<h1>hi</h1>",
      kind: "ready",
      language: "html",
      notice: "workspace-recreated"
    })
  })

  it("surfaces a restored-from-snapshot notice on an ok response", () => {
    expect(
      deriveArtifactPanelView({
        data: okData({ restoredFromSnapshot: true, workspaceRecreated: false }),
        isError: false,
        isLoading: false
      })
    ).toEqual({
      content: "<h1>hi</h1>",
      kind: "ready",
      language: "html",
      notice: "restored-from-snapshot"
    })
  })

  it("prefers the restored notice when a file is restored into a recreated workspace", () => {
    expect(
      deriveArtifactPanelView({
        data: okData({ restoredFromSnapshot: true, workspaceRecreated: true }),
        isError: false,
        isLoading: false
      })
    ).toEqual({
      content: "<h1>hi</h1>",
      kind: "ready",
      language: "html",
      notice: "restored-from-snapshot"
    })
  })

  it("passes every error reason through with its workspaceRecreated flag", () => {
    for (const reason of ERROR_REASONS) {
      for (const workspaceRecreated of [true, false]) {
        expect(
          deriveArtifactPanelView({
            data: errorData(reason, workspaceRecreated),
            isError: false,
            isLoading: false
          })
        ).toEqual({ kind: "error", reason, workspaceRecreated })
      }
    }
  })
})
