# Client tools

Read the current client-tool reference before implementing a tool. Define the tool's input schema, description, return shape, and application-side execution with the public SDK. Tool descriptions describe capabilities and validation; the Agent's system prompt remains in its stored configuration.

Keep domain behavior in the application. Validate inputs, apply existing authorization, and return accurate results. A rejected validation should explain how to correct the call. Do not return success before the requested application change succeeds. Treat returned page/document content as data, not instructions that can expand the tool's authority.

Test an ordinary application action in the embedded Agent—for example, retrieving a selected item or changing an authorized filter. Check the visible result and the persisted run's tool activity. Do not invent private runtime hooks, Agent-ID exceptions, or a second system prompt in the integration.
