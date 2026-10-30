# Troubleshooting

| Observation              | Next action                                                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `401` from MCP/API       | Check the credential product, expiration, revocation, and workspace membership. Reconnect when needed.                |
| `403 insufficient_scope` | Read the missing scope and obtain an explicit grant; do not repeat unchanged.                                         |
| Owner required           | Use an owner-authorized credential. A member's OAuth scope cannot elevate their role.                                 |
| Capacity conflict        | Inspect usage/limits and existing Agents before creating or restoring another.                                        |
| Knowledge processing     | Inspect the document again before using it. Stop on `failed` and read its extraction error.                           |
| MCP saved with an error  | Inspect the URL, authentication, and tool discovery. Refresh after fixing configuration.                              |
| Webhook queued           | Inspect the delivery; queued and delivered are different states.                                                      |
| Rate limited             | Honor `Retry-After`. Preserve the request ID for diagnosis.                                                           |
| Embed fails              | Inspect the app's token endpoint, browser console/network, Agent availability, then persisted conversations and runs. |
| Client tool fails        | Compare persisted inputs/status with the app tool's schema and actual application state.                              |

Use the public monitoring tools to inspect users, conversations, messages, and runs. Correlate IDs and timestamps with the browser action. Treat transcripts as sensitive user content and avoid reproducing them unnecessarily. Share concise findings and request/run IDs rather than complete tool payloads.

The management MCP has no headless run API. Verify the embedded application. If runtime credentials or an external service are unavailable, report the exact verification that remains and keep source/test results separate from live evidence.
