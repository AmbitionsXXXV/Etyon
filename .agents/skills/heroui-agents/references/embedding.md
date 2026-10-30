# Embedding

Fetch `agents/quickstart`, `agents/identifying-users`, and the relevant SDK reference through `get_docs`. For Next.js use `@heroui/agent/next`; for React use `@heroui/agent`. The server helper is `createAuthToken` from `@heroui/agent/server`. Vanilla sites use the documented hosted loader.

The server stores `HEROUI_AGENT_API_KEY` and the intended Agent ID. The browser can receive the Agent ID and a short-lived browser credential. Validate the requested Agent ID against the server configuration. For authenticated visitors, resolve identity from the application's session, not a user ID supplied by the browser. Follow the application's existing CSRF and authorization policies.

Implement the SDK's `getAuthToken` callback using an application endpoint. Never call the workspace-key endpoint directly from browser code. Use the SDK's existing callbacks for readiness, errors, and lifecycle behavior; retrieve their exact signatures from current docs.

Verify the mounted embed in the actual application's browser: open it, send a message, observe a reply, invoke a client tool, and inspect the persisted run. Report the route, Agent ID, and resulting run or conversation ID. Keep configuration and behavior generic to the public product.
