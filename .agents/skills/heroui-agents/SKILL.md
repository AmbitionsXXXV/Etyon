---
name: heroui-agents
description: "Create, configure, embed, and troubleshoot HeroUI Agents using the public management API, HeroUI Agents MCP, and @heroui/agent SDK. Use when adding an Agent to a website, configuring knowledge or integrations, implementing client tools, or inspecting conversations and runs."
metadata:
  author: heroui
  version: "1.0.0"
---

# HeroUI Agents

Build an integration that works in the user's application and verify its persisted activity.
This guidance is public. Authentication belongs to the connected MCP client or application server.
HeroUI Pro component licenses and Pro personal/CI tokens do not grant Agents access.

## Workflow

1. Inspect the repository's framework, package manager, authentication, environment handling, and existing Agent integration. Read current documentation with `search_docs` and `get_docs` from the HeroUI Agents MCP. Without MCP, use [the documentation index](https://heroui.pro/docs/agents/llms.txt) and [public OpenAPI](https://api.heroui.pro/v1/openapi.json).
2. Call `get_connection` and `list_workspaces`. Select the intended workspace explicitly. Use `list_agents` before creating anything; names are not unique identifiers. Reuse the intended Agent and pass its ID to every Agent operation.
3. Read `get_agent` before updating configuration. The stored Agent definition owns its system prompt, suggested prompts, models, appearance, and built-in toolkit. Apply only the changes needed for the application. Preserve unrelated settings.
4. Add knowledge and integrations as needed. A saved knowledge document can still be processing or failed. Inspect readiness before relying on it. A saved MCP connection can have an `error_message` and no tools. Check its discovery result and fix the connection before continuing.
5. Reuse an existing server environment integration key when available. Do not read or print its value. If creation is authorized and the current credential has both `api_keys:create` and `auth_tokens:create`, use `create_integration_key` with the workspace ID, a descriptive name, and a fresh idempotency key. Reuse that idempotency key after a lost response. This creates only `auth_tokens:create` access.
6. Save the new secret directly to a server-only environment variable through the user's normal environment mechanism. Never put it in client code, `NEXT_PUBLIC_*`, `VITE_*`, logs, screenshots, messages, or committed files. Verify the environment file is ignored before writing. Report the variable name and key ID, never the value.
7. Integrate the existing public SDK (`@heroui/agent`, `@heroui/agent/next`, and `@heroui/agent/server`) or vanilla embed. Fetch the current quickstart rather than inventing APIs. The app server verifies its own caller and exchanges its narrow workspace key for the browser credential. Derive signed-in user identity on the server.
8. Run the application and verify messaging in a browser. Exercise one application client tool. Inspect the resulting user, conversation, messages, and run through MCP; confirm completion or diagnose the recorded failure. A successful build alone does not verify an embedded Agent.

## References

- [Authentication](references/authentication.md): OAuth, workspace keys, permissions, and revocation.
- [Embedding](references/embedding.md): framework selection and server/browser boundaries.
- [Client tools](references/client-tools.md): application behavior and validation.
- [Management](references/management.md): configuration, uploads, connections, and webhooks.
- [Troubleshooting](references/troubleshooting.md): readiness, permissions, and persisted activity.

Keep customer prompts, workspace IDs, tokens, and application-specific instructions in the application's configuration and the Agent dashboard. Do not generate a customer-specific copy of this skill. Client-tool implementations stay in the consuming application.
