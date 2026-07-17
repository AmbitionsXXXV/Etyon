model: Composer 2

# Vite+ Code Standards

This project uses **Vite+** as the unified toolchain, while still extending **Ultracite** for linting and formatting rules.

## Quick Reference

- **Format code**: `vp fmt . --write`
- **Check for issues**: `vp check`
- **Run tests**: `vp test run`

Oxlint + Oxfmt (through `Vite+`) provides robust linting and formatting. Most issues are automatically fixable.

---

## Agent Execution Guidelines

These guidelines reduce common coding-agent mistakes. They bias toward caution over speed; use judgment for trivial tasks.

### Think Before Coding

- State assumptions explicitly before implementing.
- If multiple interpretations exist, surface them instead of picking silently.
- Call out simpler approaches and tradeoffs when relevant; push back when warranted.
- If something is unclear, stop, name what is confusing, and ask.

### Simplicity First

- Implement only what was requested.
- Avoid single-use abstractions and speculative flexibility.
- Do not add configurability or error handling for scenarios that cannot happen.
- If the solution is much larger than it needs to be, simplify it.

### Surgical Changes

- Touch only the files and lines required by the request.
- Do not improve adjacent code, comments, or formatting unless needed for the task.
- Match the existing style, even when another style would also work.
- Mention unrelated dead code instead of deleting it.
- Remove only unused imports, variables, or functions introduced by your change.
- Every changed line should trace directly to the user's request.

### Goal-Driven Execution

- Define success criteria for tasks that are not trivial.
- For bugs, prefer a focused reproduction before fixing when practical.
- For refactors, verify behavior before and after the change.
- For multi-step tasks, state a brief plan with verification steps.
- Keep looping until the criteria are verified or a concrete blocker is identified.

---

## Core Principles

Write code that is **accessible, performant, type-safe, and maintainable**. Focus on clarity and explicit intent over brevity.

### Type Safety & Explicitness

- Use explicit types for function parameters and return values when they enhance clarity
- Prefer `unknown` over `any` when the type is genuinely unknown
- Use const assertions (`as const`) for immutable values and literal types
- Leverage TypeScript's type narrowing instead of type assertions
- Use meaningful variable names instead of magic numbers - extract constants with descriptive names

### Modern JavaScript/TypeScript

- Use arrow functions for callbacks and short functions
- Prefer `for...of` loops over `.forEach()` and indexed `for` loops
- Use optional chaining (`?.`) and nullish coalescing (`??`) for safer property access
- Prefer template literals over string concatenation
- Use destructuring for object and array assignments
- Use `const` by default, `let` only when reassignment is needed, never `var`

### Async & Promises

- Always `await` promises in async functions - don't forget to use the return value
- Use `async/await` syntax instead of promise chains for better readability
- Handle errors appropriately in async code with try-catch blocks
- Don't use async functions as Promise executors

### React & JSX

- Use function components over class components
- Call hooks at the top level only, never conditionally
- Specify all dependencies in hook dependency arrays correctly
- Use the `key` prop for elements in iterables (prefer unique IDs over array indices)
- Nest children between opening and closing tags instead of passing as props
- Don't define components inside other components
- Use semantic HTML and ARIA attributes for accessibility:
  - Provide meaningful alt text for images
  - Use proper heading hierarchy
  - Add labels for form inputs
  - Include keyboard event handlers alongside mouse events
  - Use semantic elements (`<button>`, `<nav>`, etc.) instead of divs with roles

### Error Handling & Debugging

- Remove `console.log`, `debugger`, and `alert` statements from production code
- Throw `Error` objects with descriptive messages, not strings or other values
- Use `try-catch` blocks meaningfully - don't catch errors just to rethrow them
- Prefer early returns over nested conditionals for error cases

### Code Organization

- Keep functions focused and under reasonable cognitive complexity limits
- Extract complex conditions into well-named boolean variables
- Use early returns to reduce nesting
- Prefer simple conditionals over nested ternary operators
- Group related code together and separate concerns

### Security

- Add `rel="noopener"` when using `target="_blank"` on links
- Avoid `dangerouslySetInnerHTML` unless absolutely necessary
- Don't use `eval()` or assign directly to `document.cookie`
- Validate and sanitize user input

### Performance

- Avoid spread syntax in accumulators within loops
- Use top-level regex literals instead of creating them in loops
- Prefer specific imports over namespace imports
- Avoid barrel files (index files that re-export everything)
- Use proper image components (e.g., Next.js `<Image>`) over `<img>` tags

### Framework-Specific Guidance

**Next.js:**

- Use Next.js `<Image>` component for images
- Use `next/head` or App Router metadata API for head elements
- Use Server Components for async data fetching instead of async Client Components

**React 19+:**

- Use ref as a prop instead of `React.forwardRef`

**Solid/Svelte/Vue/Qwik:**

- Use `class` and `for` attributes (not `className` or `htmlFor`)

---

## Testing

- Write assertions inside `it()` or `test()` blocks
- Avoid done callbacks in async tests - use async/await instead
- Don't use `.only` or `.skip` in committed code
- Keep test suites reasonably flat - avoid excessive `describe` nesting

## When Oxlint + Oxfmt Can't Help

Oxlint + Oxfmt's linter will catch most issues automatically. Focus your attention on:

1. **Business logic correctness** - Oxlint + Oxfmt can't validate your algorithms
2. **Meaningful naming** - Use descriptive names for functions, variables, and types
3. **Architecture decisions** - Component structure, data flow, and API design
4. **Edge cases** - Handle boundary conditions and error states
5. **User experience** - Accessibility, performance, and usability considerations
6. **Documentation** - Add comments for complex logic, but prefer self-documenting code

---

Most formatting and common issues are automatically fixed by Oxlint + Oxfmt. Run `vp check --fix` before committing to ensure compliance.

---

## Learned User Preferences

- Always respond in Chinese (中文); when Chinese, English, and symbols appear together, add spaces between Latin/numeric characters and Chinese characters
- Use arrow function expressions (`const Foo = () => ...`), not function declarations — oxlint `func-style` enforces this
- Define variables/components before referencing them — oxlint `no-use-before-define` enforces this
- Object keys must be sorted alphabetically — oxlint `sort-keys` enforces this
- File names must be kebab-case — oxlint `filename-case` enforces this; on macOS use two-step rename (temp name first) to change letter case; add auto-generated files (e.g. `routeTree.gen.ts`) to oxlint `ignorePatterns`
- React 19 typings: `@types/react` deprecates `FormEvent` for submit handlers — prefer `SyntheticEvent<HTMLFormElement>` (or other concrete event types) instead of `FormEvent`
- Main process builds as ESM (`build.lib.formats: ["es"]`); preload remains CJS (Electron sandbox limitation); hand-written main code uses `path.dirname(fileURLToPath(import.meta.url))` instead of `__dirname`; `vite.main.config.ts` `ESM_SHIMS` banner injects aliased `__etyonCreateRequire` / `__filename` / `__dirname` (not bare `createRequire`) via `rollupOptions.output.banner` to avoid duplicate declaration when bundled CJS deps also import `createRequire`; preload must output a distinct filename (e.g. `preload.js`) to avoid collision with main `index.js` in `.vite/build/`
- Open http(s) external links from renderer via `open-external-url` IPC (`native-ipc.ts` → `shell.openExternal`), not in-window navigation
- This project uses pnpm (not `bun` as a default elsewhere); before implementing features, read the `doc/` directory if it exists; after implementation, write documentation there
- Prefer feature-level constants and non-presentational logic under `apps/desktop/src/renderer/lib/<feature>/` (kebab-case) instead of growing `components/`-only trees
- Use `@/main/...`, `@/renderer/...`, `@main/...`, `@renderer/...` path aliases for imports instead of relative `./` or `../` paths within the desktop app

## Learned Workspace Facts

- Monorepo: pnpm (hoisted node-linker) + Turborepo, workspaces `apps/*` and `packages/*`, scope `@etyon`; shared deps centralized in `pnpm-workspace.yaml` catalog, apps/packages reference with `catalog:`
- Desktop app (`apps/desktop/`, `@etyon/desktop`): Electron 41, Electron Forge 7, Vite 8, React 19, Tailwind CSS 4, TanStack Router + Query + Hotkeys + DevTools
- Desktop process structure: `src/main/` (Electron main), `src/preload/` (preload bridge), `src/renderer/` (React SPA with file-based routing under `routes/`)
- IPC: oRPC + Electron MessagePort adapter; shared Zod schemas in `packages/rpc/` (`@etyon/rpc`), router + handlers in `apps/desktop/src/main/rpc/`
- Logger package (`packages/logger/`, `@etyon/logger`): types + renderer SDK; renderer SDK uses dependency injection `initLogger(emit)`, not window globals
- Persistent settings via `electron-store` (ESM-only, top-level static import in ESM main); store wrapper in `src/main/settings.ts`; cross-window sync via `BrowserWindow.getAllWindows()` + `webContents.send()`; cross-window preview uses `settings-preview-color-schemas` IPC with granular effect dependencies (not whole draft); settings window accepts `tab` query param for initial section, plus `settings-navigate-tab` IPC for runtime tab switching; `createSettingsWindow(tab?)` in `window.ts`
- Proxy test: `apps/desktop/src/main/proxy/test-proxy.ts`; HTTP `CONNECT` then `tls.connect({ servername })` to the target for correct TLS SNI (otherwise Cloudflare may return 421); `proxy.type === "https"` must TLS-wrap the connection to the proxy first, then issue `CONNECT` over that socket (plaintext `CONNECT` to an HTTPS proxy yields TLS errors like `WRONG_VERSION_NUMBER`); reuse sockets with `http.request` / `https.request` via `createConnection`, not a `socket` option; test target `ipinfo.io/json` for connectivity + exit IP + geo; oRPC `proxy.test` endpoint
- `@electron-toolkit/utils` provides `platform.isMacOS/isWindows/isLinux`, `is.dev`, `optimizer.watchWindowShortcuts` — use instead of raw `process.platform` in main process
- `@tanstack/react-hotkeys` exports `useHotkey` (singular, not `useHotkeys`); use `"Mod+,"` for cross-platform Cmd/Ctrl
- CLI app (`apps/cli/`, `@etyon/cli`): TypeScript, compiled to `dist/`
- Shared UI package (`packages/ui/`, `@etyon/ui`): shadcn + base-mira style, @base-ui/react, @hugeicons/react + @hugeicons/core-free-icons, Inter Variable font, exports `globals.css`, `components/*`, `lib/*`, `hooks/*`; point shadcn CLI / `components.json` at this package so new components are not generated under `apps/desktop/@etyon/ui/`; unchecked checkboxes use visible border/background in `globals.css` so they contrast on semi-transparent settings surfaces
- Git commits: `@commitlint/config-conventional` via `commitlint.config.mjs` + cz-git; subject must be lowercase — `subject-case` rejects sentence-case (capitalize-first-letter subjects fail the hook)
- Linting/formatting: Vite+ with Ultracite-derived rules, config at workspace root [`vite.config.ts`](/Users/jiantianjianghui/Web_Project/Etyon/vite.config.ts)
- Vite renderer: plugin order TanStackRouterVite → react() → tailwindcss(); `use-sync-external-store/shim` and `/shim/with-selector` must be in `optimizeDeps.include` for `@base-ui/react`; packages with ESM `import.meta.url` wrappers used by Electron main (e.g. `font-list`) must be `external` in `vite.main.config.ts`
- Local HTTP server: Hono + `@hono/node-server` in `src/main/server/`; `port: 0` for OS-assigned port, must `await once(server, "listening")` before reading `server.address()`; URL exposed to renderer via oRPC `server.getUrl` procedure
- AI SDK v7 (`ai@7` + react@4 + providers@4 + `@ai-sdk/provider@4`/`provider-utils@5` explicitly declared): `instructions` replaces `system`, `isStepCount` replaces `stepCountIs`, stateless `toUIMessageStream({ stream: result.stream })` replaces the deprecated instance method, `createUIMessageStream` callback is `onEnd` while renderer `useChat` keeps `onFinish`; tool approval is a call-site `toolApproval` policy (`buildAgentToolApproval` in agent-toolset.ts), not tool-level `needsApproval`; provider spec is `LanguageModelV4*` (xml-tool middleware/protocol ported, providers.ts guards `specificationVersion === "v4"`); persisted v6 UIMessage JSON stays compatible; `convertToModelMessages()`, `DefaultChatTransport<UIMessage>` generic, and `settings.ai` in `electron-store` unchanged — see `doc/ai.md` v7 迁移记录
- Zod v4: nested `.default({})` on objects with inner defaults requires complete default values — use `as const` constants; simple schemas in `packages/rpc/` may import from `zod/mini`
- Sidebar: `@etyon/ui` Sidebar component; main window uses `collapsible="offcanvas"`, settings uses `collapsible="none"`; macOS traffic light at `{ x: 12, y: 18 }`, collapsed sidebar needs `pl-[76px]` offset; sidebar width fixed with `min-w-[17rem] w-[17rem]` to prevent layout shift on locale change; offcanvas collapse uses pure opacity fade-out (no left slide), action buttons use left-slide animation; settings sidebar is a floating card (`bg-card` + shadow) without liquid-glass; desktop-only — no mobile breakpoints, always visible; window min dimensions `minWidth: 732`, `minHeight: 392` for both main and settings windows
- Desktop packaging (Electron Forge): release builds need `ELECTRON_FORGE_BUILD_IDENTIFIER=release` + `ETYON_RELEASE=true`; local artifacts at `apps/desktop/out/release/make/` (`.dmg`, `zip/darwin/arm64/*.zip`), not `out/development/make`; `AutoUnpackNativesPlugin` in `forge.config.ts` for `@libsql/darwin-arm64` and `electron-liquid-glass`; Release workflow (`.github/workflows/release.yml`) triggers on tag push only, uses Node 22 + `voidzero-dev/setup-vp`, requires `HEROUI_AUTH_TOKEN` for `@heroui-pro/react`; CI runs `electron-forge make` from `apps/desktop` via root `node_modules/.bin/electron-forge` with vite-plus pnpm on `PATH`, uploads from `out/release/artifacts/macos-arm64/` (copies makers output or fallback `ditto`/`hdiutil` from `.app`), GitHub Release uses `fail_on_unmatched_files: true`; avoid `cd apps/desktop && vp run make` on GHA (may stop at `Finalizing package` with exit 0); root `vp run make` uses `turbo run make` — see `doc/packaging.md`
- Agent harness: Etyon-owned architecture, reference mapping, phased roadmap, and test matrix in `doc/agents.md`; runtime under `apps/desktop/src/main/agents/` with `settings.agents` default `enabled=false`; when enabled, session page renders `AgentWorkbenchPanel` (HeroUI `Disclosure` + body `ScrollShadow max-h-[50vh]`; flex child uses `min-h-0 overflow-hidden`, not `shrink-0`; run list / run details explorer uses `max-h-[min(24rem,40vh)]` with left run list + right timeline events each in nested `ScrollShadow`); agent chat persistence uses `agent-chat-projection.ts` (`mergeAgentEventProjectionIntoChatMessages`) to collapse multi-step tool loops into one assistant bubble per user turn — tool-approval resume (second stream after `sendAutomaticallyWhen`) must `trimTrailingAssistantMessages` on the prefix before merging projected suffix or UI shows duplicate assistant bubbles
- Chat session UI (`chat.$sessionId.tsx`, `components/chat/`): `@heroui-pro/react` AI components (`PromptInput`, `ChatMessage`, `ChatMessageActions`) + `@heroui/react` primitives — not `@etyon/ui`; style `PromptInput.Shell` for border/radius (outer wrapper must not duplicate border); spread `tabIndex={0}` on tooltip-wrapped `Button` actions for React Aria `Focusable`
- Liquid glass: `electron-liquid-glass` in main process, `data-liquid-glass` on `<html>` in renderer; `globals.css` sets semi-transparent `--sidebar`, `--background`, `--card`, `--popover` when active; custom color schemas may override these — ensure liquid-glass layer does not conflict with user-defined theme colors
- Settings Channels tab (`channels-tab.tsx`, nav id `channels`) for messaging integrations; Telegram bridge in `apps/desktop/src/main/telegram/` persists under `settings.telegram`
- Token Savings: `apps/desktop/src/main/rtk-token-savings.ts` runs `rtk gain --daily --format json` and `rtk gain --history`; recent commands also read from RTK `history.db` via `rtk-history-db.ts` (override with `RTK_DB_PATH`); charts group by CLI name (`getCliNameFromCommand`); oRPC `tokenSavings.get` (output now includes `runtime`: rtk availability/version + ripgrep source); settings tab id `token-savings` keeps analytics read-only but has an immediate-apply "RTK Command Handling" switch (`settings.agents.rtk.autoRewrite`, direct `settings.update`, outside draft/save); agent bash tool rewrites allowlisted simple/`&&` commands with an `rtk` prefix at spawn time only (`rtk-rewrite.ts`) — approvals/dangerous-command checks/allowlist matching stay on the original command; built-in `grep` resolves ripgrep via `ripgrep-binary.ts` (system `rg` with Homebrew-PATH env first, bundled `@vscode/ripgrep` fallback; forge asar unpack covers `@vscode/ripgrep-*/bin`); schemas in `packages/rpc/src/schemas/token-savings.ts`
- Plugins: built-in registry in `apps/desktop/src/main/plugins/`; Cursor auth in `apps/desktop/src/main/cursor-auth/` (OAuth/PKCE, token store, `GetUsableModels` with seed fallback); Plugins tab (`plugins-tab.tsx`, nav id `plugins`) only toggles enable — login/logout lives on the Cursor provider card in Providers tab; schemas in `packages/rpc/src/schemas/plugins.ts` and `cursor-auth.ts`; see `doc/plugins.md`
- Settings scroll sections: long lists in settings tabs (e.g. Providers model list) use flex column + `min-h-0 flex-1` + internal `@etyon/ui` `ScrollArea` so content fills remaining height and scrolls inside the panel

@RTK.md

<!-- HEROUI-REACT-AGENTS-MD-START -->

[HeroUI React v3 Docs Index]|root: ./.heroui-docs/react|STOP. What you remember about HeroUI React v3 is WRONG for this project. Always search docs and read before any task.|If docs missing, run this command first: heroui agents-md --react --output AGENTS.md|components/(buttons):{button-group.mdx,button.mdx,close-button.mdx,toggle-button-group.mdx,toggle-button.mdx}|components/(collections):{dropdown.mdx,list-box.mdx,tag-group.mdx}|components/(colors):{color-area.mdx,color-field.mdx,color-picker.mdx,color-slider.mdx,color-swatch-picker.mdx,color-swatch.mdx}|components/(controls):{slider.mdx,switch.mdx}|components/(data-display):{badge.mdx,chip.mdx,table.mdx}|components/(date-and-time):{calendar.mdx,date-field.mdx,date-picker.mdx,date-range-picker.mdx,range-calendar.mdx,time-field.mdx}|components/(feedback):{alert.mdx,meter.mdx,progress-bar.mdx,progress-circle.mdx,skeleton.mdx,spinner.mdx}|components/(forms):{checkbox-group.mdx,checkbox.mdx,description.mdx,error-message.mdx,field-error.mdx,fieldset.mdx,form.mdx,input-group.mdx,input-otp.mdx,input.mdx,label.mdx,number-field.mdx,radio-group.mdx,search-field.mdx,text-area.mdx,text-field.mdx}|components/(layout):{card.mdx,separator.mdx,surface.mdx,toolbar.mdx}|components/(media):{avatar.mdx}|components/(navigation):{accordion.mdx,breadcrumbs.mdx,disclosure-group.mdx,disclosure.mdx,link.mdx,pagination.mdx,tabs.mdx}|components/(overlays):{alert-dialog.mdx,drawer.mdx,modal.mdx,popover.mdx,toast.mdx,tooltip.mdx}|components/(pickers):{autocomplete.mdx,combo-box.mdx,select.mdx}|components/(typography):{kbd.mdx,text.mdx}|components/(utilities):{scroll-shadow.mdx}|getting-started/(handbook):{animation.mdx,colors.mdx,composition.mdx,styling.mdx,theming.mdx}|getting-started/(overview):{cli.mdx,design-principles.mdx,frameworks.mdx,quick-start.mdx}|getting-started/(ui-for-agents):{agent-skills.mdx,agents-md.mdx,llms-txt.mdx,mcp-server.mdx}|releases:{v3-0-0-alpha-32.mdx,v3-0-0-alpha-33.mdx,v3-0-0-alpha-34.mdx,v3-0-0-alpha-35.mdx,v3-0-0-beta-1.mdx,v3-0-0-beta-2.mdx,v3-0-0-beta-3.mdx,v3-0-0-beta-4.mdx,v3-0-0-beta-6.mdx,v3-0-0-beta-7.mdx,v3-0-0-beta-8.mdx,v3-0-0-rc-1.mdx,v3-0-0.mdx,v3-0-2.mdx,v3-0-3.mdx,v3-0-4.mdx}|demos/accordion:{basic.tsx,controlled.tsx,custom-indicator.tsx,custom-render-function.tsx,custom-styles.tsx,disabled.tsx,faq.tsx,multiple.tsx,surface.tsx,without-separator.tsx}|demos/alert-dialog:{backdrop-variants.tsx,close-methods.tsx,controlled.tsx,custom-animations.tsx,custom-backdrop.tsx,custom-icon.tsx,custom-portal.tsx,custom-trigger.tsx,default.tsx,dismiss-behavior.tsx,placements.tsx,sizes.tsx,statuses.tsx,with-close-button.tsx}|demos/alert:{basic.tsx}|demos/autocomplete:{allows-empty-collection.tsx,asynchronous-filtering.tsx,controlled-open-state.tsx,controlled.tsx,custom-indicator.tsx,default.tsx,disabled.tsx,email-recipients.tsx,full-width.tsx,location-search.tsx,multiple-select.tsx,required.tsx,single-select.tsx,tag-group-selection.tsx,user-selection-multiple.tsx,user-selection.tsx,variants.tsx,with-description.tsx,with-disabled-options.tsx,with-sections.tsx}|demos/avatar:{basic.tsx,colors.tsx,custom-styles.tsx,fallback.tsx,group.tsx,sizes.tsx,variants.tsx}|demos/badge:{basic.tsx,colors.tsx,dot.tsx,placements.tsx,sizes.tsx,variants.tsx,with-content.tsx}|demos/breadcrumbs:{basic.tsx,custom-render-function.tsx,custom-separator.tsx,disabled.tsx,level-2.tsx,level-3.tsx}|demos/button-group:{basic.tsx,disabled.tsx,full-width.tsx,orientation.tsx,sizes.tsx,variants.tsx,with-icons.tsx,without-separator.tsx}|demos/button:{basic.tsx,custom-render-function.tsx,custom-variants.tsx,disabled.tsx,full-width.tsx,icon-only.tsx,loading-state.tsx,loading.tsx,outline-variant.tsx,ripple-effect.tsx,sizes.tsx,social.tsx,variants.tsx,with-icons.tsx}|demos/calendar:{basic.tsx,booking-calendar.tsx,controlled.tsx,custom-icons.tsx,custom-styles.tsx,default-value.tsx,disabled.tsx,focused-value.tsx,international-calendar.tsx,min-max-dates.tsx,multiple-months.tsx,read-only.tsx,unavailable-dates.tsx,with-indicators.tsx,year-picker.tsx}|demos/card:{default.tsx,horizontal.tsx,variants.tsx,with-avatar.tsx,with-form.tsx,with-images.tsx}|demos/checkbox-group:{basic.tsx,controlled.tsx,custom-render-function.tsx,disabled.tsx,features-and-addons.tsx,indeterminate.tsx,on-surface.tsx,validation.tsx,with-custom-indicator.tsx}|demos/checkbox:{basic.tsx,controlled.tsx,custom-indicator.tsx,custom-render-function.tsx,custom-styles.tsx,default-selected.tsx,disabled.tsx,form.tsx,full-rounded.tsx,indeterminate.tsx,invalid.tsx,render-props.tsx,variants.tsx,with-description.tsx,with-label.tsx}|demos/chip:{basic.tsx,statuses.tsx,variants.tsx,with-icon.tsx}|demos/close-button:{default.tsx,interactive.tsx,variants.tsx,with-custom-icon.tsx}|demos/color-area:{basic.tsx,controlled.tsx,custom-render-function.tsx,disabled.tsx,space-and-channels.tsx,with-dots.tsx}|demos/color-field:{basic.tsx,channel-editing.tsx,controlled.tsx,custom-render-function.tsx,disabled.tsx,form-example.tsx,full-width.tsx,invalid.tsx,on-surface.tsx,required.tsx,variants.tsx,with-description.tsx}|demos/color-picker:{basic.tsx,controlled.tsx,with-fields.tsx,with-sliders.tsx,with-swatches.tsx}|demos/color-slider:{alpha-channel.tsx,basic.tsx,channels.tsx,controlled.tsx,custom-render-function.tsx,disabled.tsx,rgb-channels.tsx,vertical.tsx}|demos/color-swatch-picker:{basic.tsx,controlled.tsx,custom-indicator.tsx,custom-render-function.tsx,default-value.tsx,disabled.tsx,sizes.tsx,stack-layout.tsx,variants.tsx}|demos/color-swatch:{accessibility.tsx,basic.tsx,custom-render-function.tsx,custom-styles.tsx,shapes.tsx,sizes.tsx,transparency.tsx}|demos/combo-box:{allows-custom-value.tsx,asynchronous-loading.tsx,controlled-input-value.tsx,controlled.tsx,custom-filtering.tsx,custom-indicator.tsx,custom-render-function.tsx,custom-value.tsx,default-selected-key.tsx,default.tsx,disabled.tsx,full-width.tsx,menu-trigger.tsx,on-surface.tsx,required.tsx,with-description.tsx,with-disabled-options.tsx,with-sections.tsx}|demos/date-field:{basic.tsx,controlled.tsx,custom-render-function.tsx,disabled.tsx,form-example.tsx,full-width.tsx,granularity.tsx,invalid.tsx,on-surface.tsx,required.tsx,variants.tsx,with-description.tsx,with-prefix-and-suffix.tsx,with-prefix-icon.tsx,with-suffix-icon.tsx,with-validation.tsx}|demos/date-picker:{basic.tsx,controlled.tsx,custom-render-function.tsx,disabled.tsx,form-example.tsx,format-options-no-ssr.tsx,format-options.tsx,international-calendar.tsx,with-custom-indicator.tsx,with-validation.tsx}|demos/date-range-picker:{basic.tsx,controlled.tsx,custom-render-function.tsx,disabled.tsx,form-example.tsx,format-options-no-ssr.tsx,format-options.tsx,input-container.tsx,international-calendar.tsx,with-custom-indicator.tsx,with-validation.tsx}|demos/description:{basic.tsx}|demos/disclosure-group:{basic.tsx,controlled.tsx}|demos/disclosure:{basic.tsx,custom-render-function.tsx}|demos/drawer:{backdrop-variants.tsx,basic.tsx,controlled.tsx,navigation.tsx,non-dismissable.tsx,placements.tsx,scrollable-content.tsx,with-form.tsx}|demos/dropdown:{controlled-open-state.tsx,controlled.tsx,custom-trigger.tsx,default.tsx,long-press-trigger.tsx,single-with-custom-indicator.tsx,with-custom-submenu-indicator.tsx,with-descriptions.tsx,with-disabled-items.tsx,with-icons.tsx,with-keyboard-shortcuts.tsx,with-multiple-selection.tsx,with-section-level-selection.tsx,with-sections.tsx,with-single-selection.tsx,with-submenus.tsx}|demos/error-message:{basic.tsx,with-tag-group.tsx}|demos/field-error:{basic.tsx}|demos/fieldset:{basic.tsx,on-surface.tsx}|demos/form:{basic.tsx,custom-render-function.tsx}|demos/input-group:{default.tsx,disabled.tsx,full-width.tsx,invalid.tsx,on-surface.tsx,password-with-toggle.tsx,required.tsx,variants.tsx,with-badge-suffix.tsx,with-copy-suffix.tsx,with-icon-prefix-and-copy-suffix.tsx,with-icon-prefix-and-text-suffix.tsx,with-keyboard-shortcut.tsx,with-loading-suffix.tsx,with-prefix-and-suffix.tsx,with-prefix-icon.tsx,with-suffix-icon.tsx,with-text-prefix.tsx,with-text-suffix.tsx,with-textarea.tsx}|demos/input-otp:{basic.tsx,controlled.tsx,disabled.tsx,form-example.tsx,four-digits.tsx,on-complete.tsx,on-surface.tsx,variants.tsx,with-pattern.tsx,with-validation.tsx}|demos/input:{basic.tsx,controlled.tsx,full-width.tsx,on-surface.tsx,types.tsx,variants.tsx}|demos/kbd:{basic.tsx,inline.tsx,instructional.tsx,navigation.tsx,special.tsx,variants.tsx}|demos/label:{basic.tsx}|demos/link:{basic.tsx,custom-icon.tsx,custom-render-function.tsx,icon-placement.tsx,underline-and-offset.tsx,underline-offset.tsx,underline-variants.tsx}|demos/list-box:{controlled.tsx,custom-check-icon.tsx,custom-render-function.tsx,default.tsx,multi-select.tsx,virtualization.tsx,with-disabled-items.tsx,with-sections.tsx}|demos/meter:{basic.tsx,colors.tsx,custom-value.tsx,sizes.tsx,without-label.tsx}|demos/modal:{backdrop-variants.tsx,close-methods.tsx,controlled.tsx,custom-animations.tsx,custom-backdrop.tsx,custom-portal.tsx,custom-trigger.tsx,default.tsx,dismiss-behavior.tsx,placements.tsx,scroll-comparison.tsx,sizes.tsx,with-form.tsx}|demos/number-field:{basic.tsx,controlled.tsx,custom-icons.tsx,custom-render-function.tsx,disabled.tsx,form-example.tsx,full-width.tsx,on-surface.tsx,required.tsx,validation.tsx,variants.tsx,with-chevrons.tsx,with-description.tsx,with-format-options.tsx,with-step.tsx,with-validation.tsx}|demos/pagination:{basic.tsx,controlled.tsx,custom-icons.tsx,disabled.tsx,simple-prev-next.tsx,sizes.tsx,with-ellipsis.tsx,with-summary.tsx}|demos/popover:{basic.tsx,custom-render-function.tsx,interactive.tsx,placement.tsx,with-arrow.tsx}|demos/progress-bar:{basic.tsx,colors.tsx,custom-value.tsx,indeterminate.tsx,sizes.tsx,without-label.tsx}|demos/progress-circle:{basic.tsx,colors.tsx,custom-svg.tsx,indeterminate.tsx,sizes.tsx,with-label.tsx}|demos/radio-group:{basic.tsx,controlled.tsx,custom-indicator.tsx,custom-render-function.tsx,delivery-and-payment.tsx,disabled.tsx,horizontal.tsx,on-surface.tsx,uncontrolled.tsx,validation.tsx,variants.tsx}|demos/range-calendar:{allows-non-contiguous-ranges.tsx,basic.tsx,booking-calendar.tsx,controlled.tsx,default-value.tsx,disabled.tsx,focused-value.tsx,international-calendar.tsx,invalid.tsx,min-max-dates.tsx,multiple-months.tsx,read-only.tsx,three-months.tsx,unavailable-dates.tsx,with-indicators.tsx,year-picker.tsx}|demos/scroll-shadow:{custom-size.tsx,default.tsx,hide-scroll-bar.tsx,orientation.tsx,visibility-change.tsx,with-card.tsx}|demos/search-field:{basic.tsx,controlled.tsx,custom-icons.tsx,custom-render-function.tsx,disabled.tsx,form-example.tsx,full-width.tsx,on-surface.tsx,required.tsx,validation.tsx,variants.tsx,with-description.tsx,with-keyboard-shortcut.tsx,with-validation.tsx}|demos/select:{asynchronous-loading.tsx,controlled-multiple.tsx,controlled-open-state.tsx,controlled.tsx,custom-indicator.tsx,custom-render-function.tsx,custom-value-multiple.tsx,custom-value.tsx,default.tsx,disabled.tsx,full-width.tsx,multiple-select.tsx,on-surface.tsx,required.tsx,variants.tsx,with-description.tsx,with-disabled-options.tsx,with-sections.tsx}|demos/separator:{basic.tsx,custom-render-function.tsx,manual-variant-override.tsx,variants.tsx,vertical.tsx,with-content.tsx,with-surface.tsx}|demos/skeleton:{animation-types.tsx,basic.tsx,card.tsx,grid.tsx,list.tsx,single-shimmer.tsx,text-content.tsx,user-profile.tsx}|demos/slider:{custom-render-function.tsx,default.tsx,disabled.tsx,range.tsx,vertical.tsx}|demos/spinner:{basic.tsx,colors.tsx,sizes.tsx}|demos/surface:{variants.tsx}|demos/switch:{basic.tsx,controlled.tsx,custom-render-function.tsx,custom-styles.tsx,default-selected.tsx,disabled.tsx,form.tsx,group-horizontal.tsx,group.tsx,label-position.tsx,render-props.tsx,sizes.tsx,with-description.tsx,with-icons.tsx,without-label.tsx}|demos/table:{async-loading.tsx,basic.tsx,column-resizing.tsx,custom-cells.tsx,empty-state.tsx,expandable-rows.tsx,pagination.tsx,secondary-variant.tsx,selection.tsx,sorting.tsx,tanstack-table.tsx,virtualization.tsx}|demos/tabs:{basic.tsx,custom-render-function.tsx,custom-styles.tsx,disabled.tsx,secondary-vertical.tsx,secondary.tsx,vertical.tsx,with-separator.tsx}|demos/tag-group:{basic.tsx,controlled.tsx,custom-render-function.tsx,disabled.tsx,selection-modes.tsx,sizes.tsx,variants.tsx,with-error-message.tsx,with-list-data.tsx,with-prefix.tsx,with-remove-button.tsx}|demos/text:{default.tsx,primitives.tsx,prose.tsx,render-props.tsx,typography-scale.tsx}|demos/textarea:{basic.tsx,controlled.tsx,full-width.tsx,on-surface.tsx,rows.tsx,variants.tsx}|demos/textfield:{basic.tsx,controlled.tsx,custom-render-function.tsx,disabled.tsx,full-width.tsx,input-types.tsx,on-surface.tsx,required.tsx,textarea.tsx,validation.tsx,with-description.tsx,with-error.tsx}|demos/time-field:{basic.tsx,controlled.tsx,custom-render-function.tsx,disabled.tsx,form-example.tsx,full-width.tsx,invalid.tsx,on-surface.tsx,required.tsx,with-description.tsx,with-prefix-and-suffix.tsx,with-prefix-icon.tsx,with-suffix-icon.tsx,with-validation.tsx}|demos/toast:{callbacks.tsx,custom-indicator.tsx,custom-queue.tsx,custom-toast.tsx,default.tsx,placements.tsx,promise.tsx,simple.tsx,variants.tsx}|demos/toggle-button-group:{attached.tsx,basic.tsx,controlled.tsx,disabled.tsx,full-width.tsx,orientation.tsx,selection-mode.tsx,sizes.tsx,without-separator.tsx}|demos/toggle-button:{basic.tsx,controlled.tsx,disabled.tsx,icon-only.tsx,sizes.tsx,variants.tsx}|demos/toolbar:{basic.tsx,custom-styles.tsx,vertical.tsx,with-button-group.tsx}|demos/tooltip:{basic.tsx,custom-render-function.tsx,custom-trigger.tsx,placement.tsx,with-arrow.tsx}

<!-- HEROUI-REACT-AGENTS-MD-END -->
