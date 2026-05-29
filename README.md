# Etyon

Etyon is a local desktop agent workbench built around the existing chat surface,
workspace tools, approvals, and observable agent runs.

## Agent Runtime

The agent runtime is Etyon-owned in naming and public interfaces. Code-agent
tools use short Etyon aliases such as `read`, `grep`, `find`, `ls`, `bash`,
`edit`, `write`, and `inspect`, while internal workspace operations use
`etyon_workspace_*` names.

The design is inspired by [Mastra](https://github.com/mastra-ai/mastra) and [Pi](https://github.com/earendil-works/pi), but Etyon keeps its implementation
names, settings, tool registry, workspace substrate, sandbox, and LSP lifecycle
under Etyon-owned interfaces.
