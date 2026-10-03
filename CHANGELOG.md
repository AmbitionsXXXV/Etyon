# Changelog

All notable changes to this project are documented in this file.

## [0.1.9] - 2026-10-03

### Features
- Complete agent runtime and screen awareness (852b3ef)
- Add durable tasks and on-demand skills (83e6267)
- Add macos screen awareness onboarding (1a51bcd)
- Check for updates from github releases in-app (43b4ead)
- Add session turn navigator (fd7fa49)
- Add tanstack table v9 (1db46cb)
- Improve browser panels and tab sessions (7eb0df2)
- Add animated live status orb (0f013a9)
- Unified motion language for the chat ui (aed5c76)
- Import sign-ins from local Chromium browser profiles (d8883c5)
- Pick web elements from the embedded browser into the composer (b05abf3)
- Browser-style tab strip and global panel trigger (browser-tab pr5) (bbebac0)
- Rebuild right panel as dynamic tab sessions (browser-tab pr4) (40e9060)
- Add agent browser tool with approvals and timeline cards (browser-tab pr3) (c1aa29a)
- Add browser tab panel ui and tab wiring (browser-tab pr2) (c1029f6)
- Add main-process browser host and rpc surface (browser-tab pr1) (fc4411e)
- Add vp-driven product version workflow (4390998)
- Add switchable app icons (0a8dfbc)

### Bug Fixes
- Close feature acceptance gaps (f7b923a)
- Harden in-app update flow (d60aa0f)
- Keep composer toolbar intact when the chat column is narrow (117d98d)
- Open settings window from empty model selector (7d1a225)
- Update RecentCommandsTable styles for improved layout (ec072cc)
- Isolate development app data (84da547)
- Preserve messages when local fetch fails (b0147ec)

### Other
- Merge pull request #2 from AmbitionsXXXV/codex/on-demand-preset-tools

feat(desktop): complete agent runtime and screen awareness (5235b0b)
- Merge pull request #1 from AmbitionsXXXV/feat/in-app-updates

feat(desktop): add in-app update checks and release gates (1b9aaad)

### Refactor
- Move update core logic into src/shared (28c9d20)

### Chores
- Add shadcn tailwind checks (d386f23)
- Update dependencies and improve code quality (eec4c38)
- Merge origin main updates (9923d3f)
- Gate releases on typecheck, lint, and tests (5e6f570)
- Update heroui dependencies (70559a7)
- Update .gitignore and modify CLAUDE.md for model version change (5d4c8df)
- Update packageManager version to pnpm@11.15.1 (af137d9)

## [0.1.8] - 2026-07-21

### Features
- Implement Content Security Policy for renderer and introduce AgentMarkdown component (d1d9720)
- Brand the installer surfaces (PR3) (9a715c9)
- Polish First Light reveal (PR2) (1794068)
- Add First Light first-run onboarding animation (eb9e55b)

### Bug Fixes
- Actually publish the changelog to the GitHub release body (a51bc40)
- Harden terminal theme tracking (c0c86e7)
- Fail loud on missing packaged deps and derive libsql binding names (920ce87)

### Refactor
- Extract forge helper logic into forge/ modules (9a66e6f)

### Documentation
- Add First Light install experience design spec (f56493c)

### Chores
- Bump version to 0.1.8 (045336f)

## [0.1.7] - 2026-07-17

### Features
- Add Tailwind CSS v4 documentation skill (bee4861)
- Sync the terminal theme with the app theme (e039fad)

### Bug Fixes
- Polish light-theme chat readability and indicators (1848be9)
- Use hash history so the packaged renderer resolves routes (84927e3)
- Ship native deps and app assets in packaged build (a9bd43f)

### Chores
- Bump version to 0.1.7 (6e449f8)

## [0.1.6] - 2026-07-17

### Features
- Adopt ai sdk 7 semantic apis in the agent runtime (4e42c19)
- Migrate to ai sdk 7 (5672a6e)
- Wire vite devtools into renderer dev server (61b19d5)
- Add composer plan queue (b88c62b)
- Crew UI refactor, artifact recovery, XML tool middleware, capability icons (19e2403)
- Plan-mode interactions + agent-loop/provider hardening (ce409b4)
- Restore bash checkpoints from their git snapshots (de2b765)
- Let the agent see images — composer attachments to model vision parts (4586ba9)
- Give the agent a todo checklist rendered in the work section (c1662d7)
- Surface checkpoint restore in the chat timeline (799430a)
- Capture workspace checkpoints before agent file mutations (e62147d)
- Enable git commit from the project panel Commit tab (796fdec)
- Add file tree sidebar and buffer tabs to file preview (a605cfd)
- Click-through file navigation from chat to the project panel (e093a93)
- Add interactive terminal panel as a fourth project-context tab (09dadbf)
- Auto-load workspace AGENTS.md rules into agent instructions (64e96e7)
- Add session-bound pty core for the interactive terminal panel (b8c12e0)
- Render live agent work bare in the chat flow and fold into worked summary on settle (320f1bd)
- Gate workflow tool behind approval outside bypass mode (ef4ef71)
- Rtk auto-rewrite, memory manager, per-session git scope, icon dedup, permission hotkey (3c94d02)
- Introduce /workflow command for multi-agent orchestration (a0b693b)
- Live execution timeline with concurrent writable sub-agents (8b23d77)
- Update model rankings and introduce new skills (b93067e)
- Searchable model selector with per-model reasoning effort (e025cd7)
- Auto-ignore generated images in the project .gitignore (c334cdd)
- Composer image mode + self-owned agent loop (070dde2)
- Enhance error handling for chat stream responses (ff17957)
- Replace live long-term-memory retrieval with a cheap digest + on-demand tools (ed6a6b7)
- Harden provider settings with base URL validation and better upstream errors (a5f58fe)
- Add OpenAI provider support with API mode toggle and proxy-aware fetch (6b76801)
- Add provider icons, composer context breakdown, and fix message trailing whitespace (9bd0ce5)
- Upgrade HeroUI v3.2.0 + Pro beta-6, add composer context indicator (bba922b)
- Add improve skill for codebase auditing and enhancement (d4ac8bb)
- Redact secret-shaped tokens before persisting agent tool data (abcb10a)
- Complete managed profiles, delegation, and run inspector (b88add7)
- Enhance chat capabilities and input handling (df5837d)
- Implement event-sourced agent run management (ef7578b)
- Introduce plan mode functionality for chat agent (264febc)

### Bug Fixes
- Approval resume denial, plan queue during approvals, allowlist patterns (3b7e09d)
- Update Kbd component styling in prompt input (2dbfec5)
- Stretch project panel tabs to full width and drop the empty status strip (13ed691)
- Boot the terminal only once its container is measurable (f461d64)
- Pre-bundle xterm packages for the renderer dev server (3ce48b0)
- Reset composer permission mode and message queue per session and queue during approvals (43e1823)
- Serialize agent-run and chat persistence transactions through the write lock (488b61e)
- Eliminate composer flicker on model switch (3387f63)
- Remove unused pr-12 right padding on ChatMessage.Body (5d80912)
- Write connection token file with 0600 permissions (7607e2a)

### Refactor
- Move context-usage indicator beside the send button (00bee53)
- Update dependencies and remove deprecated agent features (1b2377d)
- Reorganize chat components and enhance utility functions (86e3408)

### Documentation
- Record ai sdk 7 migration and vite devtools integration (6ef0292)
- Apply formatter to gap-closure roadmap (b3e592f)
- Add gap-closure roadmap with per-feature implementation plans (365fcf3)
- Add mainstream feature-gap research (Alma/Cursor/Claude Code vs Etyon) (8339585)
- Record 2026-07-12 reconcile and 008 CDP verification in advisor-plans (96af21f)
- Record 2026-07-12 branch audit round in advisor-plans (plans 006-008 executed) (0d04afb)
- Mark 已落地实现明细 section as pre-pivot historical (2186cf0)
- Realign agents doc with the shipped file-only runtime (4f81466)

### Testing
- Pin renderer view logic against sdk-materialized streams (7c1c2ae)
- Cover delegate concurrency limit, output clamps, and failure path (f001c31)

### CI
- Add git-cliff changelog generation for releases (be74897)

### Chores
- Bump version to 0.1.6 (97c2844)
- Update package manager (a09c4c3)
- Update package manager (8298d0c)
- Upgrade TypeScript to 7, Electron to 43, and refresh HeroUI + deps (6f812c0)
- Refresh model ranking table and editor spell-check dictionary (b8f180c)
- Update Node.js version from 24.15.0 to 24.18.0 (dddc7e7)
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


