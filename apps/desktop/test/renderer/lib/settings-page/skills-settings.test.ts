import { I18nProvider } from "@etyon/i18n/react"
import type { ParsedSkill } from "@etyon/rpc"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement } from "react"
import type { ReactElement, ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vite-plus/test"

import {
  getSkillCommandDisplayItems,
  getSkillExtensionDisplayPaths,
  SkillsTab
} from "@/renderer/components/settings/skills-tab"

const TestI18nProvider = I18nProvider as unknown as (props: {
  children?: ReactNode
  locale: "en-US"
}) => ReactElement

vi.mock("@/renderer/lib/rpc", () => ({
  orpc: {
    skills: {
      list: {
        queryOptions: () => ({
          queryFn: () => Promise.resolve({ skills: [] }),
          queryKey: ["skills.list"]
        })
      }
    }
  }
}))

describe("skills settings helpers", () => {
  const skill = {
    body: "Use project tools.",
    capabilities: ["write-fs"],
    commands: [
      {
        description: "Review project changes.",
        flags: ["--strict", "--write"],
        name: "review"
      }
    ],
    description: "Use when editing project code.",
    extensions: ["./agent-extension.mjs", "extensions/reviewer.mjs"],
    modelVisible: true,
    name: "project-tools",
    path: "/project/.agents/skills/project-tools/SKILL.md",
    projectPath: "/project",
    scope: "project",
    shortDescription: null,
    visible: true
  } satisfies ParsedSkill

  it("keeps declared skill extension module paths visible for settings", () => {
    expect(getSkillExtensionDisplayPaths(skill)).toEqual([
      "./agent-extension.mjs",
      "extensions/reviewer.mjs"
    ])
  })

  it("keeps declared skill commands and flags visible for settings", () => {
    expect(getSkillCommandDisplayItems(skill)).toEqual([
      "review --strict --write"
    ])
  })

  it("renders extension module counts and paths in the skills settings tab", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false
        }
      }
    })

    queryClient.setQueryData(["skills.list"], {
      skills: [skill]
    })

    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          TestI18nProvider,
          { locale: "en-US" },
          createElement(SkillsTab, {
            onChange: vi.fn(),
            skills: {
              enabled: true,
              includeGlobal: true,
              includeProject: true,
              maxContextSkills: 4
            }
          })
        )
      )
    )

    expect(html).toContain("Extensions")
    expect(html).toContain("./agent-extension.mjs / extensions/reviewer.mjs")
    expect(html).toContain("2 extension module")
    expect(html).toContain("Commands")
    expect(html).toContain("review --strict --write")
    expect(html).toContain("1 command")
  })
})
