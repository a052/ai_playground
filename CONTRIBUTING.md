# Contributing

Thanks for your interest in improving AI Playground! This is a browser-only, multi-provider AI chat playground with **no backend**. For the full design, read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Development setup

**Prerequisites:** Node.js 20.19+ (Vite 8 requirement) and npm.

```bash
npm install
npm run dev        # dev server → http://localhost:51800
```

> There is **no `.env` file and no environment configuration**. API keys are entered in the UI at runtime and stored in your browser (`localStorage` / `IndexedDB`) — never commit keys, and never add a `.env` requirement to the build.

## The build is the gate

```bash
npm run build      # tsc -b (typecheck) then vite build
npm run lint       # ESLint
```

- `npm run build` runs `tsc -b` first, so **a type error fails the build**. This is the project's correctness gate — there is **no test runner**.
- TypeScript is strict: `noUnusedLocals` / `noUnusedParameters` are on, so unused imports/variables fail the build.
- Run `npm run build` (and `npm run lint`) before opening a PR.
- For UI changes, also run `npm run dev` and exercise the feature in a browser — type-checking verifies code correctness, not feature correctness.

## Conventions

- **Imports:** use the `@/…` path alias (maps to `src/`).
- **Styling:** Tailwind with `darkMode: 'class'`; use `cn()` from `src/lib/utils.ts` for conditional classes. Colors are HSL CSS tokens in `src/index.css`.
- **Types:** `src/types/index.ts` is the single source of truth — update it when you add domain fields.

### i18n is required for all UI text

Never hardcode user-facing strings in components. Every display string goes through the `t()` hook (`src/i18n`). When you add or change UI text:

1. Add/update the key in **both** `translations.en` and `translations.zh` in `src/i18n/translations.ts`.
2. The two dictionaries **must share an identical key set** (enforced by the `TranslationKey` type).
3. Keys follow the `section.name` convention; use `t('key', { var })` for `{placeholder}` interpolation.

Provider proper nouns (OpenAI / Claude / Gemini) are not translated.

### Common extension points

- **Add a provider** or **add a parameter** — see the developer guides in [`docs/ARCHITECTURE.md` §13](docs/ARCHITECTURE.md#13-developer-guides-notes-for-future-development). Provider changes touch all three layers of `src/lib/apiClient.ts` (builder, SSE handler, `parseFinal`).

## Pull requests

- Keep PRs focused; describe the "why", not just the "what".
- Confirm `npm run build` and `npm run lint` pass.
- Note any UI changes you verified in the browser.
