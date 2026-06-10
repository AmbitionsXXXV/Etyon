# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Features
- Introduce plan mode functionality for chat agent (264febc)

### Refactor
- Update dependencies and remove deprecated agent features (1b2377d)
- Reorganize chat components and enhance utility functions (86e3408)

### Chores
- Add RTK (Rust Token Killer) command guidelines and project-local filters (611d201)
- Update agents audit and project config (fb8a25b)

## [0.1.5] - 2026-06-09

### Features
- Implement chat agent mode functionality and UI controls (1c64e16)
- Enhance agent chat message handling and session management (4682ce8)
- Add comprehensive Mastra framework guide and common errors reference (a8c942d)
- Add command approval allowlist and resume (f0d5fbb)
- Enhance agent skill invocation and approval management (8c5b436)
- Enhance agent session management and integrate TypeScript support (2c8311e)
- Enhance agent chat context and projection management (cc29a6c)
- Implement active agent run management and enhance agent runtime (bfb43df)
- Enhance agent workbench UI and continual learning state (ffaca29)
- Implement agent artifacts management and enhance memory handling (134750a)
- Enhance agent message processing and tool integration (422ad77)
- Enhance agent session message handling and UI components (f5e55d6)
- Add support for agent session queued messages and recoverable runs (ad672fe)
- Enhance agent runtime and session management with new error handling and event structures (41c92eb)
- Update continual learning state and enhance chat component styling (bc615a6)
- Enhance git project diff handling with file snapshots and improved parsing (c4a09cf)
- Enhance command tool call display with collapsible card and output preview in chat interface (0242e0f)
- Integrate Streamdown for Markdown rendering in chat responses with customizable animation settings (40ddc65)
- Update package dependencies and enhance chat stream response handling (e7bd30d)
- Add message tool trace component and related utilities for command output handling (ae76298)
- Implement agent event and run management with permission engine and profiles (d9a94d5)
- Update ESLint rules and add new library to VSCode settings (79599db)
- Introduce agents architecture and runtime plan documentation (68e6663)
- Add formatting command and update package configurations (ea02800)
- Implement local embedding model installation and status management (00e8a7b)
- Add auto compact settings (1ef1492)
- Add hybrid memory retrieval (92daeb4)
- Add memory embeddings runtime (d1c74e7)
- Add memory summarization runtime (a26b8e8)
- Resolve memory tool model (5596675)
- Respect memory auto retrieval (04b7d81)
- Add memory settings copy (4af0313)
- Enhance memory settings tab (48515aa)
- Add memory settings helpers (978f2b4)
- Extend memory settings schema (a2f5c67)
- ✨ add built-in Cursor Auth plugin with dynamic model discovery (1729cd1)
- ✨ implement token savings feature and enhance settings (06b3b5e)
- ✨ enhance ProjectContextPanel with new file tree and preview functionality (25291b1)
- ✨ update package dependencies and enhance project file handling (7fb5365)
- ✨ update package dependencies and introduce MagicPath skill (7f730ff)
- ✨ integrate Git project status and diff features (0abdb6f)
- ✨ introduce HeroUI Pro themes and message actions (31bef55)
- ✨ enhance Telegram integration with default model configuration (bf76c01)
- ✨ integrate @heroui/react components and update settings (b1bb58e)
- ✨ implement skills management and enhance chat message normalization (1483586)
- ✨ add shared long-term memory (8614cdc)
- ✨ add chat messages and session memories to database schema (fce3107)
- ✨ integrate Telegram support and enhance settings management (b70d748)
- ✨ initialize Rust workspace and add core dependencies (714f2fd)
- ✨ add Rust coding guidelines and best practices documentation (ae74a79)
- ✨ enhance project chat session management and sidebar functionality (8f8861c)
- ✨ implement chat session archiving and enhance project snapshot management (e438add)
- ✨ add cache cleaning script and update Vite configuration (70b2cb4)
- ✨ streamline testing configuration and update dependencies (bb353bf)
- ✨ enhance project configuration and performance measurement (d4fdabb)
- ✨ update project configuration and dependencies (e8f6e4f)
- ✨ add model selection to chat sessions and enhance project snapshot management (679db5a)
- ✨ enhance sidebar state management with width adjustment (44d3096)
- ✨ implement chat session management and sidebar enhancements (3b3e53c)
- ✨ add network settings tab with proxy configuration and testing (505a8a6)
- ✨ add .nvmrc and enhance Lefthook configuration (b384740)
- ✨ update dependencies and enhance TypeScript configuration (c86311c)
- ✨ migrate to Vite+ for unified tooling and configuration (1700069)
- ✨ add comprehensive API specification and enhance testing capabilities (de4c951)
- ✨ integrate electron-liquid-glass for macOS native glass effects (143c56b)
- ✨ update dependencies and enhance React Doctor integration (0326118)
- ✨ integrate Hono HTTP server and AI SDK for enhanced chat functionality (e9dfc7a)
- ✨ enhance desktop application with sidebar integration and improved settings layout (29cbb2c)
- ✨ enhance desktop application with new UI components and improved settings (a91cd23)
- ✨ enhance desktop application with tray functionality and startup settings (2df7b4b)
- ✨ enhance settings management with color schema previews and theme customization (f4be8c1)
- ✨ enhance settings page with improved color schema and theme management (8ec0b0f)
- ✨ introduce custom themes management in settings (e807e9e)
- ✨ enhance ignore patterns and update package dependencies (efe794e)
- ✨ enhance packaging configuration for desktop application (57ee29b)
- ✨ integrate framer-motion for enhanced animations and update settings management (77d0cbb)
- ✨ transition to ESM in desktop application and enhance settings management (3b4640d)
- ✨ integrate Hugeicons library for enhanced UI components (c8e8b1e)
- ✨ enhance desktop application with new features and updates (a52514d)
- ✨ integrate TanStack Devtools and update dependencies (dea92c6)
- ✨ add shadcn monorepo support (a15ebd8)

### Bug Fixes
- Update continual learning state and improve chat message rendering (e535992)
- Update continual learning state and TypeScript configuration (e832fa6)
- 🐛 update settings and improve error handling in desktop application (01b5899)

### Other
- 🌱 init commit (a984617)

### Refactor
- Streamline agent chat message handling and remove deprecated features (1a3194e)
- 📦 simplify SQLite database URL validation in tests (b072f01)

### Documentation
- Refine behavioral guidelines and enhance agent architecture documentation (af1f46b)
- Update memory enhancement docs (6766691)
- Design memory enhancement (25094dd)
- Add rust cli integration design (edbfc15)

### Styling
- 🎨 improve settings page functionality and code organization (7460b0c)

### CI
- Add macOS ARM64 release workflow via GitHub Actions (120edc8)

### Chores
- Allow hono@4.12.25 past minimum-release-age policy (793a7f0)
- Bump version to 0.1.5 (dd8c9b1)
- Update package dependencies and versions (8a6b9c5)
- 🔨 remove .nvmrc and update package dependencies (2e80520)


