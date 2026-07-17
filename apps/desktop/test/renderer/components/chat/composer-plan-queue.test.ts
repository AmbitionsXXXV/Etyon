// @vitest-environment happy-dom

import { I18nProvider } from "@etyon/i18n/react"
import { createElement } from "react"
import type { ReactElement, ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it } from "vite-plus/test"

import { ComposerPlanQueue } from "@/renderer/components/chat/composer-plan-queue"
import type { ComposerPlanQueueProps } from "@/renderer/lib/chat/plan-queue"
import { clearTodos, setTodos } from "@/renderer/lib/chat/todo-store"
import type { ChatTodoItem } from "@/shared/chat/stream-data"

const TestI18nProvider = I18nProvider as unknown as (props: {
  children?: ReactNode
  locale: "en-US"
}) => ReactElement

const noop = (): void => {}

const render = (props: Partial<ComposerPlanQueueProps> = {}): string =>
  renderToStaticMarkup(
    createElement(
      TestI18nProvider,
      { locale: "en-US" },
      createElement(ComposerPlanQueue, {
        isBusy: false,
        onDismiss: noop,
        onMarkDone: noop,
        ...props
      })
    )
  )

const liveTodos: ChatTodoItem[] = [
  { content: "Read the config", status: "completed" },
  {
    activeForm: "Writing the migration",
    content: "Write the migration",
    status: "in_progress"
  },
  { content: "Run the tests", status: "pending" }
]

const planFixture = {
  planMarkdown: "## Steps\n\n1. Migrate the schema",
  title: "Refactor auth"
}

// The default-expanded steps face is the only reachable initial render here:
// `isCollapsed` starts false and SSR runs no user interaction, so the collapsed
// variant is covered by the mode matrix in plan-queue.test.ts instead.
afterEach(() => {
  clearTodos()
})

describe("ComposerPlanQueue", () => {
  it("renders the live checklist without a plan (steps mode)", () => {
    setTodos("run-live", liveTodos)
    const html = render({ runId: "run-live" })

    expect(html).toContain("Todos")
    expect(html).toContain("Read the config")
    expect(html).toContain("Run the tests")
    // The active step shows its present-tense activeForm plus the progress count.
    expect(html).toContain("Writing the migration")
    expect(html).toContain("1/3")
    // No saved-plan chrome without a plan.
    expect(html).not.toContain("Executing plan")
    expect(html).not.toContain("View plan")
  })

  it("renders the plan header and actions alongside the live checklist", () => {
    setTodos("run-live", liveTodos)
    const html = render({ plan: planFixture, runId: "run-live" })

    expect(html).toContain("Executing plan")
    expect(html).toContain("Refactor auth")
    expect(html).toContain("View plan")
    expect(html).toContain("Plan options")
    // Still a steps strip: the checklist rows render below the header.
    expect(html).toContain("Writing the migration")
  })

  it("renders the plan header alone when no live todos exist", () => {
    const html = render({ plan: planFixture, runId: "run-idle" })

    expect(html).toContain("Executing plan")
    expect(html).toContain("View plan")
    // Header mode: no checklist rows and no collapse control.
    expect(html).not.toContain("Read the config")
    expect(html).not.toContain("Collapse steps")
    expect(html).not.toContain("Expand steps")
  })

  it("renders nothing when there is neither a plan nor live todos", () => {
    expect(render({ runId: "run-idle" })).toBe("")
  })
})
