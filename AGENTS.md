# Ultracite Code Standards

This project uses **Ultracite**, a zero-config preset that enforces strict code quality standards through automated formatting and linting.

## Quick Reference

- **Format code**: `pnpm dlx ultracite fix`
- **Check for issues**: `pnpm dlx ultracite check`
- **Diagnose setup**: `pnpm dlx ultracite doctor`

Oxlint + Oxfmt (the underlying engine) provides robust linting and formatting. Most issues are automatically fixable.

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

Most formatting and common issues are automatically fixed by Oxlint + Oxfmt. Run `pnpm dlx ultracite fix` before committing to ensure compliance.

---

## Learned User Preferences

- Always respond in Chinese (中文)
- When Chinese, English, and symbols appear together, add spaces between Latin/numeric characters and Chinese characters
- Use arrow function expressions (`const Foo = () => ...`), not function declarations — oxlint `func-style` enforces this
- Define variables/components before referencing them — oxlint `no-use-before-define` enforces this
- Object keys must be sorted alphabetically — oxlint `sort-keys` enforces this
- File names must be kebab-case — oxlint `filename-case` enforces this; on macOS use two-step rename (temp name first) to change letter case
- Auto-generated files like `routeTree.gen.ts` must be added to oxlint `ignorePatterns`
- ESM-only packages (e.g. `@tanstack/devtools-vite`) in Electron Forge vite configs must use dynamic `import()` inside a plugin hook, not top-level static imports
- Electron main process uses CJS context — `__dirname` requires inline `/* eslint-disable unicorn/prefer-module */`
- Preload entry must output a distinct filename (e.g. `preload.js`) to avoid collision with main's `index.js` in `.vite/build/`
- Default JS package manager is `bun`; this project specifically uses pnpm
- Before implementing features, read the `doc/` directory if it exists; after implementation, write documentation there

## Learned Workspace Facts

- Monorepo: pnpm (hoisted node-linker) + Turborepo, workspaces `apps/*` and `packages/*`, scope `@etyon`; shared deps centralized in `pnpm-workspace.yaml` catalog, apps/packages reference with `catalog:`
- Desktop app (`apps/desktop/`, `@etyon/desktop`): Electron 41, Electron Forge 7, Vite 8, React 19, Tailwind CSS 4, TanStack Router + Query + Hotkeys + DevTools
- Desktop process structure: `src/main/` (Electron main), `src/preload/` (preload bridge), `src/renderer/` (React SPA with file-based routing under `routes/`)
- IPC: oRPC + Electron MessagePort adapter; shared Zod schemas in `packages/rpc/` (`@etyon/rpc`), router + handlers in `apps/desktop/src/main/rpc/`
- Logger package (`packages/logger/`, `@etyon/logger`): types + renderer SDK; renderer SDK uses dependency injection `initLogger(emit)`, not window globals
- Persistent settings via `electron-store` (ESM-only, needs dynamic `import()` in main CJS); store wrapper in `src/main/settings.ts`; cross-window sync via `BrowserWindow.getAllWindows()` + `webContents.send()`
- `@electron-toolkit/utils` provides `platform.isMacOS/isWindows/isLinux`, `is.dev`, `optimizer.watchWindowShortcuts` — use instead of raw `process.platform` in main process
- `@tanstack/react-hotkeys` exports `useHotkey` (singular, not `useHotkeys`); use `"Mod+,"` for cross-platform Cmd/Ctrl
- CLI app (`apps/cli/`, `@etyon/cli`): TypeScript, compiled to `dist/`
- Shared UI package (`packages/ui/`, `@etyon/ui`): shadcn + base-mira style, @base-ui/react, @hugeicons/react + @hugeicons/core-free-icons, Inter Variable font, exports `globals.css`, `components/*`, `lib/*`, `hooks/*`
- Linting/formatting: Ultracite (Oxlint + Oxfmt), config at workspace root (`.oxlintrc.json`, `.oxfmtrc.jsonc`)
- Vite renderer: plugin order TanStackRouterVite → react() → tailwindcss(); `use-sync-external-store/shim` and `/shim/with-selector` must be in `optimizeDeps.include` for `@base-ui/react`; packages with ESM `import.meta.url` wrappers used by Electron main (e.g. `font-list`) must be `external` in `vite.main.config.ts`
