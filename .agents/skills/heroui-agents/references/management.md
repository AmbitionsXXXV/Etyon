# Management

Use explicit workspace IDs for discovery and creation, and explicit Agent IDs for configuration. `get_agent` returns the authoritative definition. Update only intended fields; use the current configuration schema for supported model and appearance values. Creation/restoration enforces workspace capacity. Archiving takes the Agent offline and requires owner authority.

For a local knowledge file, call `create_knowledge_upload` with the file name, content type, and exact byte size. Upload bytes directly to the returned URL with its headers and the same authenticated credential; MCP does not accept a local path or base64 file. Inspect `document_id` through knowledge retrieval until `ready` or `failed`. Retry the same upload authorization to reuse the same document. Request a new authorization when it expires.

For URLs, use the existing knowledge URL operation. Inspect extraction status and refresh errors. Updates to document names/enabled state do not imply a new successful extraction.

MCP connections configured on an Agent are third-party tool providers used during conversations. They are distinct from the HeroUI Agents management MCP used by the coding agent. Connection mutations require owner authority. Existing encrypted header values are never returned. Inspect discovered tools and `error_message` after create/update/refresh.

Webhooks require owner authority. Configure the selected events, issue a test, then inspect delivery status. A queued test is not evidence of a successful delivery. Retry only failed deliveries. Keep the newly returned signing secret on the receiving server.
