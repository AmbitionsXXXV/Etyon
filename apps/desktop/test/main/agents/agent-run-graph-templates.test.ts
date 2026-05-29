import { describe, expect, it } from "vite-plus/test"

import {
  AGENT_RUN_GRAPH_TEMPLATE_IDS,
  getAgentRunGraphTemplate,
  listAgentRunGraphTemplates
} from "@/main/agents/agent-run-graph-templates"

const expectTemplateDependenciesToBeValid = (templateId: string): void => {
  const template = getAgentRunGraphTemplate(templateId)

  if (!template) {
    throw new Error(`Template not found: ${templateId}`)
  }

  const nodeIds = new Set(template.nodes.map((node) => node.id))

  for (const node of template.nodes) {
    for (const dependencyId of node.dependsOn) {
      expect(nodeIds.has(dependencyId)).toBe(true)
    }
  }
}

describe("agent run graph templates", () => {
  it("lists the built-in graph templates in stable order", () => {
    expect(listAgentRunGraphTemplates().map((template) => template.id)).toEqual(
      AGENT_RUN_GRAPH_TEMPLATE_IDS
    )
  })

  it("models the plan-execute-review template as a run graph", () => {
    expect(getAgentRunGraphTemplate("plan-execute-review")).toMatchObject({
      id: "plan-execute-review",
      nodes: [
        {
          dependsOn: [],
          id: "plan",
          profileId: "plan",
          toolScope: "read-only"
        },
        {
          dependsOn: ["plan"],
          id: "explore-code",
          parallelGroup: "explore",
          profileId: "explore"
        },
        {
          dependsOn: ["plan"],
          id: "explore-tests",
          parallelGroup: "explore",
          profileId: "explore"
        },
        {
          dependsOn: ["explore-code", "explore-tests"],
          id: "coder",
          profileId: "coder",
          toolScope: "approval-gated"
        },
        {
          dependsOn: ["coder"],
          id: "review",
          profileId: "review"
        },
        {
          dependsOn: ["review"],
          id: "final",
          profileId: "general-purpose"
        }
      ]
    })
  })

  it("keeps every template dependency inside the same template", () => {
    for (const templateId of AGENT_RUN_GRAPH_TEMPLATE_IDS) {
      expectTemplateDependenciesToBeValid(templateId)
    }
  })

  it("returns null for unknown graph template ids", () => {
    expect(getAgentRunGraphTemplate("unknown")).toBeNull()
  })
})
