# HeroUI Pro AI Chat Migration

The desktop chat surface uses HeroUI Pro AI primitives around the existing chat runtime.

## Composer

- `PromptInput` is the composer shell.
- The TipTap editor remains inside `PromptInput.Content` so `@` project mentions, `$` skill mentions, `/prompt` templates, and `/plan` shortcuts keep their existing behavior.
- The component passes the extracted plain prompt text to `PromptInput.value`. This keeps `PromptInput.Send` disabled, stop, and submit behavior aligned with the editor state.
- `lockInputOnRun={false}` and `allowSubmitWhileRunning` keep the composer editable while `useChat` is `submitted` or `streaming`.
- The toolbar start renders a left-aligned `Chat` / `Agent` mode control with HeroUI `ToggleButtonGroup`; `Shift+Tab` is registered through TanStack Hotkeys and the selected mode is sent as request body `agentMode`.

## Queue

- Queue state is still stored as append-only `agent_events`; no queue table is added.
- `agents.queueMessage` appends a queued custom message and returns the stable queue item ID.
- `agents.listQueuedMessages`, `agents.updateQueuedMessage`, `agents.removeQueuedMessage`, and `agents.reorderQueuedMessages` replay queued-message control events over the active run, or the latest completed run when no active run exists.
- `PromptInput.Queue` renders the pending queue for the current session and supports drag reorder, edit, remove, and switching between `steer` and `follow-up`.
- Runtime drain behavior stays compatible with the existing model-message replay path: when a queued user message is appended into model context, the first matching queued item is consumed by content.

## Messages And Tools

- User and assistant messages are wrapped in `ChatMessage` primitives while the existing Streamdown timeline remains responsible for markdown rendering and code block behavior.
- Message controls use `ChatMessageActions` / `ChatMessage.Action` while preserving copy feedback, response rating state, regenerate, and edit.
- Tool traces use `ChatTool` and `ChatToolGroup`. AI SDK `approval-requested` maps to HeroUI Pro `requires-action`; denied output maps to `output-error`, and approved output maps to `output-available`.
- Approval buttons, command output, child run trace preview, and raw input/output panels remain inside `ChatTool.Content`.
