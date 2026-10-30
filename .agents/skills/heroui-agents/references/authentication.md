# Authentication

Connect to `https://agent-mcp.heroui.pro/mcp` using a client with Streamable HTTP and OAuth support. The browser sign-in uses the existing HeroUI account and 2FA. Consent selects workspaces and permissions. Additional workspaces require explicit selection. The user can revoke a connection from Agents → Connected apps.

For CI, supply an Agents workspace key (`he_...`) in `Authorization: Bearer`. A Pro personal token or Pro CI token does not work here. Keep the key in the client's environment/secret store.

Read `get_connection` to inspect effective scopes and workspaces. An OAuth grant does not override current workspace membership or owner rules. `401` requires reconnecting or replacing a revoked credential; `403 insufficient_scope` requires a new explicit permission grant. Do not retry permission failures unchanged.

OAuth credentials received by MCP are bound to MCP. The server exchanges them for separate API credentials, preserving the user, client, grant, workspaces, and scopes. Do not forward an MCP OAuth token directly to REST.

Integration-key creation requires workspace ownership, `api_keys:create`, and `auth_tokens:create`. It returns a narrow key once, with replay of that same creation available for 24 hours using the same credential and idempotency key. There is no MCP tool to retrieve an existing key secret. If the application already has a key, use the existing environment reference.
