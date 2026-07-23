# Architecture & Technical Reference

This document explains how **AI Playground** is built: the directory layout, the request lifecycle, each core module, the full model-parameter reference, and the conventions you need to extend it. For an end-user overview, see the [README](../README.md).

---

## 1. Design principles

- **Browser-only, no backend.** The browser talks directly to each provider's chat API. There is no server component, no proxy of our own (an optional user-supplied CORS proxy aside), and no telemetry.
- **One provider abstraction.** All provider differences are isolated in a single module (`src/lib/apiClient.ts`) behind a uniform `streamChat()` entry point.
- **Capture everything.** Every request/response is recorded as an `HttpTransaction` so it can be inspected and re-exported as `curl`.
- **Local-first persistence.** Configs/params/settings live in `localStorage`; chat sessions (which embed base64 media) live in `IndexedDB`.
- **Typed single source of truth.** `src/types/index.ts` defines every domain type; read it first.

---

## 2. Directory structure

```
ai_playground/
├── index.html                 # SPA entry; <div id="root"> + /src/main.tsx
├── vite.config.ts             # Vite config: @ alias, dev port 51800, GH Pages base (relative './' in CI → works on github.io subpath + custom domain)
├── tsconfig*.json             # Project references (app + node)
├── tailwind.config.js         # darkMode: 'class', HSL token colors
├── .github/workflows/         # GitHub Pages deploy workflow
├── docs/                       # This document + screenshots/
└── src/
    ├── main.tsx               # React root (StrictMode)
    ├── App.tsx                # 3-pane shell; runs hydrate() on mount
    ├── index.css              # Tailwind layers + CSS theme tokens + KaTeX
    ├── types/index.ts         # All domain types (source of truth)
    ├── lib/                   # Core logic (no React)
    │   ├── apiClient.ts       # Provider abstraction: streamChat() + builders/handlers + tool calling
    │   ├── http.ts            # Shared fetch+CORS layer: BuiltRequest, fetchWithCorsFallback, runHttp
    │   ├── agent.ts           # Agentic tool-calling loop (web_search / fetch_url) + ReAct fallback
    │   ├── searchClient.ts    # Web-search adapters (Tavily/Brave/Serper/Exa/Custom) + runWebSearch
    │   ├── urlFetcher.ts      # runFetchUrl: Jina Reader → direct/proxy + htmlToText
    │   ├── toolContext.ts     # Shared ToolContext / ToolExecResult types
    │   ├── thinkSplitter.ts   # Streaming <think> tag state machine
    │   ├── storage.ts         # localStorage + IndexedDB (localforage) persistence
    │   ├── backup.ts          # Backup build/parse + field-by-field sanitization
    │   ├── defaults.ts        # DEFAULT_PARAMETERS, DEFAULT_ENABLED, API + search templates
    │   ├── curlGenerator.ts   # HttpTransaction → curl command
    │   └── utils.ts           # cn(), uid(), file helpers, attachment detection
    ├── store/                 # Zustand stores
    │   ├── useAppStore.ts     # Persistent domain state + generation control
    │   ├── useUiStore.ts      # Ephemeral UI state (panels, dialogs)
    │   ├── useToast.ts        # Toast queue
    │   └── useConfirm.ts      # Confirmation-dialog request + confirm() helper
    ├── hooks/
    │   └── useStream.ts       # Controller: UI → apiClient → store
    ├── components/            # React components (see §10)
    │   └── ui/                # Vendored shadcn/Radix primitives
    └── i18n/
        ├── index.ts          # useT() hook + interpolation
        └── translations.ts   # en / zh dictionaries
```

---

## 3. Request lifecycle

A single user message flows through these layers:

```
MessageComposer.send()                       (src/components/MessageComposer.tsx)
  → useStream.send(text, attachments)         (src/hooks/useStream.ts)
      → store.addMessage(user message)
      → runCompletion(sessionId, config, history)
          → store.addMessage(assistant placeholder, isStreaming: true)
          → store.setSessionModel(sessionId, config.id)   → records lastUsedConfigId on the chat
          → streamChat({ config, messages, parameters, callbacks })   (src/lib/apiClient.ts)
              → buildRequest()                 → provider-specific {url, headers, body}
              → fetchWithCorsFallback()        → direct fetch, retry via CORS proxy on TypeError
              → streaming:  SSE reader → pickEventHandler() → onContent / onReasoning
                non-stream: parseFinal()       → onContent / onReasoning
              → onTransaction(tx)              → HttpTransaction captured on the message
          ← callbacks drive store.appendToMessage() / updateMessage()
      → scheduleSessionSave()                  → debounced IndexedDB write (600ms)
```

`regenerate(assistantMessageId)` **forks a new branch** instead of overwriting: it builds history from the active path up to the target reply's `parentId`, then runs `runCompletion()` with a placeholder parented at that same node — creating a *sibling* of the old reply and switching the visible branch to it. Nothing is deleted. `editUserMessage(id, text)` similarly forks: it appends a new user message as a sibling of the edited one (same `parentId`, preserved attachments) and generates a reply on the new branch. `stop()` calls `store.stopGeneration()`, which aborts the in-flight `AbortController`.

### 3.1 Conversation branching (message tree)

Each `ChatSession` stores **all** messages from **all** branches in its flat `messages` array. Structure is defined by `Message.parentId`; the session's `currentLeafId` marks the tip of the currently-visible branch. The linear thread shown in the UI is *derived* — never stored — by `activePath(messages, currentLeafId)`, which walks parent links from the leaf to the root.

`src/lib/messageTree.ts` holds the pure helpers:
- `activePath(messages, leafId)` — the visible root→leaf thread (falls back to the last array element when the leaf is missing/stale).
- `childrenOf` / `siblingInfo` — sibling bookkeeping that powers the `‹index/total›` branch switcher rendered under a forked message.
- `subtreeLeaf(messages, id, currentLeafId)` — the leaf to select when switching *to* a sibling (keeps the current leaf if it descends from the target, else descends newest-child-first).
- `migrateLinear(session)` — upgrades a legacy pre-branching session (flat `messages`, no `parentId`/`currentLeafId`) into the tree shape by chaining messages in array order. Idempotent; applied on `hydrate()` and on backup import.

`store.addMessage` sets `parentId` (explicit, else the current leaf) and advances `currentLeafId`, so normal `send()` stays linear. `store.switchBranch(sessionId, messageId)` flips `currentLeafId` via `subtreeLeaf`. `store.deleteMessage` prunes the whole subtree of the removed node. All branches of a conversation remain a **single** entry in the session list.

---

## 4. Provider abstraction — `src/lib/apiClient.ts`

`streamChat(req)` is the single entry point. It builds the request, fires it (with CORS fallback), captures an `HttpTransaction`, and routes the response. Everything provider-specific lives in **three parallel layers** — when you change a provider's behavior you almost always touch all three for that provider.

### 4.1 Request builders

Translate the shared `Message[]` + `ModelParameters` into each provider's wire format (endpoint, auth header, body shape, multimodal content blocks):

| Builder | Endpoint | Auth header | Multimodal |
| --- | --- | --- | --- |
| `buildOpenAI` | `{baseUrl}/chat/completions` | `Authorization: Bearer …` | `image_url`, `input_audio`, `file` (PDF) blocks |
| `buildClaude` | `{baseUrl}/messages` | `x-api-key`, `anthropic-version`, `anthropic-dangerous-direct-browser-access: true` | base64 `image` + `document` (PDF) blocks |
| `buildGemini` | `{baseUrl}/models/{modelId}:{verb}` | `x-goog-api-key` | `inlineData` (base64) parts |

### 4.2 SSE event handlers

Parse each provider's streaming delta format into `onContent` / `onReasoning` callbacks:

- `makeOpenAIHandler` — reads `choices[].delta.content`; routes `delta.reasoning_content` / `delta.reasoning` to `onReasoning`. Content flows through the **think splitter** (§5) so inline `<think>` tags become reasoning.
- `makeClaudeHandler` — filters `content_block_delta` events; `text_delta` → content, `thinking_delta` → reasoning.
- `makeGeminiHandler` — reads `candidates[].content.parts[]`; parts flagged `thought` → reasoning, others → content.

### 4.3 Non-streaming parser

`parseFinal(type, json, cb)` does the same routing for single-shot (`stream: false`) responses, per provider.

Some endpoints ignore `stream: false` and still return an **SSE-framed** body (`data:{...}` lines). The non-streaming path detects a leading `data:` and routes the body through `parseSseFinal`, which strips the `data:` framing and replays the payloads through the normal streaming handlers (`pickEventHandler`) — so these responses parse correctly instead of failing on `JSON.parse`.

### 4.4 Encoded provider quirks

These are real constraints baked into the builders — keep them in mind when editing:

- **OpenAI reasoning models** reject `temperature` / `top_p` / penalties. When `reasoning_effort` is active (and not overridden by custom reasoning), the builder **strips sampling params**.
- **Claude** requires `max_tokens`. With extended thinking enabled, Anthropic **forbids sampling params**, so the builder **omits `temperature` / `top_p` / `top_k`** and sends `thinking` + `output_config.effort` instead. It also needs the `anthropic-dangerous-direct-browser-access: true` header to be called from a browser.
- **Gemini** uses a different URL verb for streaming (`streamGenerateContent?alt=sse`) vs. non-streaming (`generateContent`); thinking is requested via `thinkingConfig` with `includeThoughts: true`.
- **Custom reasoning** (`reasoningCustomEnabled`) merges a raw JSON fragment into the OpenAI-compatible body and does **not** strip sampling params.

### 4.5 CORS fallback

`fetchWithCorsFallback(built, corsProxy, signal, tx)` — now in **`src/lib/http.ts`** (shared by the chat client and the web-search/url-fetch tools) — tries a direct `fetch()` first. On a network `TypeError` (typically a CORS rejection), if a `corsProxy` prefix is configured, it retries with the proxy prepended. It records `tx.usedProxy` and `tx.effectiveUrl` either way. `http.ts` also exports `BuiltRequest` (generalized for GET/HEAD + object-or-string bodies), `headersToObject`, `safeReadText`, `formatHttpError`, and `runHttp(built, corsProxy, signal, apiType)` which runs a one-shot request and returns a fully-populated `HttpTransaction` — the single place that guarantees every tool HTTP call is inspectable.

### 4.6 Transaction capture

The `HttpTransaction` is constructed before the request (method, URL, headers, pretty-printed body, `startedAt` wall-clock timestamp) and completed afterward (status, response headers, accumulated body, `durationMs`, any `error`). It is delivered via `onTransaction` and stored on the assistant `Message`. `src/lib/curlGenerator.ts` turns it into a runnable `curl` command using the **direct** (non-proxied) URL, preserving auth headers, and appends `--no-buffer` for streaming requests.

`HttpInspectorModal.tsx` renders the captured transaction in a wide dialog: the header shows request time + `durationMs`, the Pretty/Raw toggle sits on the same row as the Copy cURL button, and both modes lay the request (left) and response (right) out in two side-by-side columns. Each tab uses a fixed-height (`h-[60vh]`) content region so the dialog never resizes when switching Pretty ↔ Raw, with each pane scrolling internally. Raw panes word-wrap long lines and carry their own Copy button; Pretty JSON bodies render via `CodeBlock` (which has its own copy button). Only the headers the app explicitly sets are visible — browsers do not expose the request headers they auto-add, and CORS hides response headers outside the safelist / `Access-Control-Expose-Headers`.

### 4.7 Web search & agentic tool calling

When web search is enabled, the model can call two tools — `web_search(query)` and `fetch_url(url)` — in a multi-round agentic loop. The pieces:

- **`streamChat`** accepts `tools?: ToolDef[]` + `promptToolMode?` and now returns a `StreamResult` (`finish: 'stop' | 'tool_calls' | 'error' | 'aborted'`, plus `toolCalls` / `errorStatus`). The three builders inject native tool fields (OpenAI `tools`/`tool_choice`, Claude `tools`/`input_schema`, Gemini `functionDeclarations`). The three SSE handlers became objects (`{ handle, finalize }`) that accumulate streamed tool-call fragments (OpenAI `delta.tool_calls[].index`, Claude `content_block_start`/`input_json_delta`, Gemini `functionCall` parts); `parseFinal` does the same for non-streaming.
- **`src/lib/agent.ts`** (`runAgenticCompletion`) is the orchestrator: call the model with tools → if it requested tools, execute each via `runWebSearch` / `runFetchUrl`, capture an `HttpTransaction` per call, push a `ToolRound` onto the assistant message (live status), feed results back, and loop until a final answer or `maxIterations` (then one forced no-tools answer). It respects the existing `AbortController` and falls back to a **prompt-based ReAct** path (`buildReactSystemPrompt` + `parseReactAction`) if native tools 400 on the first round.
- **Replay**: an assistant `Message.toolRounds` is expanded back into each provider's native request+result sequence by `openAIToolMessages` / `claudeToolMessages` / `geminiToolContents` (ReAct rounds, `native:false`, serialize as plain text + `OBSERVATION:` turns instead). One assistant message holds all rounds, so `regenerate()` is unchanged.
- **Executors**: `src/lib/searchClient.ts` has per-provider adapters (Tavily/Brave/Serper/Exa/Custom) + `runWebSearch`; `src/lib/urlFetcher.ts` has `runFetchUrl` (Jina Reader → direct/proxy + `htmlToText`, truncated). Both go through `runHttp`, so search/fetch calls appear in the inspector. Shared exec types live in `src/lib/toolContext.ts`.
- **Caveat**: Claude thinking is disabled during the tool loop (replaying signed thinking blocks isn't supported yet).

**Provider-native web search** is a separate, simpler mechanism from the agentic loop above. It is a single request-body field the model provider honors to run searches on its own servers during generation, streaming the answer back through the normal SSE handlers (no parser changes). It's exposed as the `nativeWebSearch` toggle in `ToggleableParam` (Parameters panel → **Tools** section) and injected in the builders when `enabled.nativeWebSearch` is true: OpenAI top-level `web_search_options: {}`; Claude `tools: [{ type: 'web_search_20250305', name: 'web_search' }]`; Gemini `tools: [{ google_search: {} }]`. It requires no separate search-provider key and works only on search-capable models. `agent.ts` `prepareParameters` force-clears this flag so it never stacks on top of the agentic loop's own tool calls.

UI: `MessageComposer.tsx` toggles `searchSettings.enabled` via a Globe toolbar button (next to attach; lit when on) and the same action in the `+` menu; `ToolCallCard.tsx` renders live "searching/reading" cards above the bubble in `ChatMessage.tsx` (each with an inspect button); `SearchApiEditorDialog.tsx` + a "Web search" group in `SettingsDialog.tsx` manage providers. Search configs/settings persist via `searchConfigsStorage`/`searchSettingsStorage` and round-trip through the `configs`-scope backup.

---

## 5. `<think>` splitting — `src/lib/thinkSplitter.ts`

Some OpenAI-compatible models inline their reasoning inside `<think>…</think>` tags within the normal content stream. `createThinkSplitter(onContent, onReasoning)` is a streaming-safe state machine that routes that text to the reasoning channel.

- **State:** `inside` (are we within a think block?) and `carry` (a buffered partial-tag suffix).
- **`push(text)`** prepends `carry`, then repeatedly: when outside, scans for `<think>` (emitting preceding text as content); when inside, scans for `</think>` (emitting preceding text as reasoning). If the tail of the chunk could be the start of a split tag, it's held in `carry` until the next `push()`.
- **`end()`** flushes any remaining `carry`.

This correctly handles tags split across SSE chunks. Claude and Gemini deliver reasoning as distinct event types and **bypass** the splitter.

---

## 6. State management — `src/store/`

State uses **Zustand** (no Redux/Context). Three stores:

### `useAppStore.ts` — persistent domain state

Holds `configs`, `parameters`, `settings`, `promptTemplates`, `reasoningTemplates`, `sessions`, `activeSessionId`, plus runtime `hydrated`, `isGenerating`, and `abortController`. Every mutator writes through to storage (config/params/settings/templates synchronously to `localStorage`; sessions via the debounced IndexedDB save). Notable actions:

- **Hydration:** `hydrate()` loads from storage, sorts sessions by `updatedAt`, validates the active config still exists, then sets `hydrated = true`. **It must run on mount** (done in `App.tsx`) before the UI renders; `hydrated` gates the loading spinner.
- **Configs:** `addConfig`, `updateConfig`, `duplicateConfig`, `removeConfig`, `setActiveConfig`.
- **Parameters:** `setParameter(key, value)`, `resetParameters`.
- **Settings:** `setTheme`, `toggleTheme`, `setLanguage`, `setCorsProxy`.
- **Templates:** `addPromptTemplate / updatePromptTemplate / removePromptTemplate` and `addReasoningTemplate / updateReasoningTemplate / removeReasoningTemplate`. Two parallel libraries of `PromptTemplate` (`{ id, title, content, createdAt, updatedAt }`) — one feeds the **System prompt** field, the other feeds the **Reasoning → Custom parameter** JSON-fragment field. Selecting a template overwrites the corresponding `parameters` field via `setParameter`.
- **Sessions:** `createSession`, `ensureActiveSession`, `deleteSession`, `renameSession`, `setActiveSession`, `setSessionModel` (records the config id last used to generate in a chat, on `ChatSession.lastUsedConfigId`), `openSession` (sets the active session **and** restores its `lastUsedConfigId` as the active config — returns an `OpenSessionResult` of `{ status: 'none' | 'switched' | 'missing', modelName? }` so the sidebar can toast on switch or when the recorded config was deleted).
- **Messages:** `addMessage` (sets `parentId` to the explicit value or the current leaf, advances `currentLeafId`, and auto-derives the session title from the first user message), `updateMessage`, `appendToMessage` (accumulates streaming content/reasoning deltas), `deleteMessage` (prunes the removed node's whole subtree), `switchBranch` (flips the visible branch via `subtreeLeaf`). See §3.1.
- **Generation control:** `setGenerating`, `setAbortController`, `stopGeneration` (aborts + clears).
- **Backup:** `exportBackup(scope)`, `importBackup(raw)`, `clearAll`.
- **Selectors:** `useActiveSession()`, `useActiveConfig()`.

### `useUiStore.ts` — ephemeral UI state

`sidebarOpen`, `paramPanelOpen`, `settingsOpen`, `apiEditorOpen`, `exportDialogOpen`, `editingConfigId` (null = "create new config"). **Never persisted.**

### `useToast.ts` — toast queue

`push(message, variant)` (auto-dismiss ~3.2s) and `dismiss(id)`, plus an imperative `toast.success/error/info` helper.

### `useConfirm.ts` — confirmation requests

Holds a single active `{ open, options, pending }` confirm request and the `request`/`cancel`/`accept` actions; `accept` awaits an async `onConfirm` while guarding with `pending`. Exposes an imperative `confirm({ title, description?, confirmLabel?, cancelLabel?, onConfirm })` helper (mirrors `toast`) so any code can pop the designed `ConfirmDialog` — replacing native `window.confirm()` for destructive actions (delete chat, delete model, clear all data).

---

## 7. Persistence — `src/lib/storage.ts`

A deliberate split by size and access pattern:

| Backing store | Contents | Keys | Notes |
| --- | --- | --- | --- |
| `localStorage` | API configs, parameters, settings, prompt/reasoning templates, search configs + settings | `ai-playground:configs`, `ai-playground:parameters`, `ai-playground:settings`, `ai-playground:promptTemplates`, `ai-playground:reasoningTemplates`, `ai-playground:searchConfigs`, `ai-playground:searchSettings` | Small, synchronous JSON. |
| `IndexedDB` (localforage) | Chat sessions (with base64 media/PDF) | DB `ai-playground`, store `sessions`, key `sessions` | Large; writes **debounced ~600ms** via `scheduleSessionSave`. |

`normalizeParameters` (in `src/lib/defaults.ts`) deep-merges stored/imported params onto `DEFAULT_PARAMETERS` so older saves missing newer fields (e.g. `stream`, `enabled`, `maxCompletionTokens`) don't break the app. `normalizeSearchSettings` does the same for `SearchSettings`. Search configs + settings are included in the `configs` (and `all`) backup scope and sanitized field-by-field on import (`sanitizeSearchConfigs`).

### Backup / restore — `src/lib/backup.ts`

`buildBackup(data, scope)` produces a `BackupFile`; `parseBackup(raw)` validates and **sanitizes field-by-field** (`sanitizeConfigs`, `sanitizeSessions`, `sanitizeSettings`, `sanitizeTemplates`) so a malformed or partial import can't corrupt state. Scopes (`all` / `configs` / `chats`) round-trip only the sections present; absent sections stay `undefined` and are left untouched on import. Prompt and reasoning template libraries travel with the `configs` / `all` scopes.

---

## 8. Domain types — `src/types/index.ts`

The authoritative reference. Summary:

- **`ApiType`** = `'openai' | 'gemini' | 'claude'`.
- **`ApiConfig`** — `{ id, name, baseUrl, apiKey, modelId, type }`.
- **`Message`** — `{ id, parentId?, role, content, reasoning?, attachments?, timestamp, model?, transaction?, isStreaming?, error?, toolRounds? }`. `parentId` links the message to its parent in the conversation tree (see §3.1); root messages have `null`/absent.
- **`Attachment`** — `{ id, kind, name, mimeType, dataUrl, size, text? }`. `kind` ∈ image/audio/video/document. Media + native PDF use `dataUrl`; text/code docs use `text` (and an empty `dataUrl`).
- **`ChatSession`** — `{ id, title, messages, currentLeafId?, createdAt, updatedAt, lastUsedConfigId? }`. `messages` is the flat node pool for all branches; `currentLeafId` is the tip of the visible branch (see §3.1). `lastUsedConfigId` is the config id last used to generate in the chat; opening the chat restores it as the active model (see `openSession`).
- **`HttpTransaction`** — captured request/response (see §4.6).
- **`Settings`** — `{ theme, language, corsProxy, activeConfigId }`.
- **`PromptTemplate`** — `{ id, title, content, createdAt, updatedAt }`. Shared shape for both the system-prompt library and the custom-reasoning-parameter library; stored separately in `promptTemplates` and `reasoningTemplates`.
- **`BackupFile`** — `{ version, exportedAt, scope, configs?, parameters?, settings?, promptTemplates?, reasoningTemplates?, sessions? }`.
- **`StreamCallbacks`** — `{ onContent, onReasoning, onTransaction, onError, onDone }`.

---

## 9. Model parameters reference

Defined in `ModelParameters` (`src/types/index.ts`); defaults in `src/lib/defaults.ts`. A parameter in `ToggleableParam` is only sent when its `enabled[name]` flag is true — the panel renders a checkbox for each. `stream` and `systemPrompt` are not toggleable (`systemPrompt` is sent whenever non-empty).

| Parameter | Type | Default | Enabled by default | Applies to | Meaning |
| --- | --- | --- | --- | --- | --- |
| `stream` | `boolean` | `true` | n/a | all | SSE streaming vs. one non-streaming completion. |
| `systemPrompt` | `string` | `''` | n/a (sent if non-empty) | all | System instruction. |
| `temperature` | `number` | `0.7` | ✅ | all† | Sampling randomness. |
| `maxCompletionTokens` | `number` | `65536` | ✅ | all (required by Claude) | Max output tokens. |
| `topP` | `number` | `0.95` | ✅ | all† | Nucleus sampling. |
| `topK` | `number \| null` | `null` | ❌ | Gemini, Claude† | Top-K sampling. |
| `presencePenalty` | `number` | `0` | ❌ | OpenAI | Penalize tokens already present. |
| `frequencyPenalty` | `number` | `0` | ❌ | OpenAI | Penalize by frequency. |
| `responseFormat` | `'text' \| 'json_object'` | `'text'` | ❌ | OpenAI | Force JSON object output. |
| `stopSequences` | `string[]` | `[]` | ❌ | all | Strings that halt generation. |
| `seed` | `number \| null` | `null` | ❌ | OpenAI | Deterministic sampling seed. |
| `reasoningEffort` | `'minimal'\|'low'\|'medium'\|'high'` | `'medium'` | ❌ | OpenAI | Reasoning-model thinking depth. |
| `reasoningCustomEnabled` | `boolean` | `false` | n/a | OpenAI | Use `reasoningCustom` instead of the enum. |
| `reasoningCustom` | `string` (JSON) | `''` | n/a | OpenAI | Raw JSON fragment merged into the body. |
| `geminiThinkingLevel` | `'minimal'\|'low'\|'medium'\|'high'` | `'medium'` | ❌ | Gemini | Gemini thinking depth. |
| `claudeThinking` (toggle) | `boolean` | — | ❌ | Claude | Enable Claude extended thinking. |
| `claudeEffort` | `'low'\|'medium'\|'high'\|'xhigh'\|'max'` | `'high'` | n/a (used when `claudeThinking`) | Claude | Adaptive-thinking effort (`output_config.effort`). |
| `n` | `number` | `1` | ❌ | OpenAI | Number of completions. |
| `logitBias` | `string` (JSON) | `''` | ❌ | OpenAI | Raw `{ token_id: bias }` JSON. |
| `customParams` | `string` (JSON fragment) | `''` | n/a (sent if non-empty) | all | Raw JSON fragment merged into the request body. |

† **Claude + extended thinking:** when `claudeThinking` is enabled, `temperature` / `top_p` / `top_k` are **omitted** from the Claude request (Anthropic constraint). The Parameter Panel shows a warning for this.

`reasoningCustom` and `logitBias` must be valid JSON; the panel validates them and shows an error rather than sending malformed JSON.

**Custom parameters** (Parameters panel → **Custom** section) is a single free-text `customParams` JSON fragment — same UX as the reasoning **Custom parameter** box, and active whenever non-empty (like `systemPrompt`, no toggle). It accepts either a bare key/value list (`"enable_thinking": true, "min_p": 0.05`) or a full object, with tolerant comma handling. At send time it is merged into the top-level request body of all three providers via `mergeJsonFragment` (`apiClient.ts`), run **last** in each builder so custom keys can override templated parameters. The panel validates it with `isValidJsonFragment` and an invalid fragment is not merged.

---

## 10. Components — `src/components/`

| Component | Role |
| --- | --- |
| `App.tsx` | 3-pane shell (Sidebar / ChatWindow / ParameterPanel), runs `hydrate()`, applies theme + `lang`. |
| `Sidebar.tsx` | Session list, API config list, theme/language toggles, settings + import/export entry points. |
| `ChatWindow.tsx` | Active API selector, message stream, empty state. Auto-scrolls to the newest output while streaming, but a `stickToBottom` flag (driven by the scroll container's `onScroll`) suspends this once the user scrolls up and resumes when they return near the bottom; a floating jump-to-bottom button appears while detached. |
| `MessageComposer.tsx` | Tall textarea above toolbar; `+` menu, attach, web-search Globe toggle, send/stop; attachment chips, drag-drop, clipboard paste. |
| `ParameterPanel.tsx` | Accordion of all model parameters with per-param enable toggles. |
| `ChatMessage.tsx` | One message bubble: content, attachments, reasoning, error, actions (copy/regenerate/edit/inspect/delete), and — for a forked message with siblings — a `‹index/total›` branch switcher (see §3.1). User messages support inline editing (pencil → textarea → save forks a new branch). The header shows the short time (`formatTime`), with a hover tooltip revealing the full date + time (`formatDateTime`, e.g. `Jul 13, 2026, 4:15 PM`). |
| `ReasoningBlock.tsx` | Collapsible thinking display; auto-collapses when the answer starts. |
| `MarkdownRenderer.tsx` | Markdown → HTML with GFM, math (KaTeX), syntax highlighting. |
| `CodeBlock.tsx` | Code fence with copy button. |
| `ImageLightbox.tsx` | Full-screen image viewer. |
| `SettingsDialog.tsx` | Theme, language, CORS proxy, export/import/clear. |
| `ApiEditorDialog.tsx` | Add/edit an API config; quick templates; show/hide key. |
| `ExportDialog.tsx` | Choose backup scope and download. |
| `ConfirmDialog.tsx` | Designed destructive-confirm dialog driven by `useConfirm`; replaces `window.confirm`. |
| `HttpInspectorModal.tsx` | View captured HTTP and copy as `curl`. |
| `ui/` | Vendored shadcn-style Radix primitives (button, dialog, select, slider, switch, tabs, tooltip, accordion, …). Treat as a design-system layer. |

All hover hints on buttons use the shared modern tooltip — wrap the trigger element in `ui/tip.tsx` (`<Tip label={…}>`), a thin wrapper over the Radix `Tooltip` primitives whose `TooltipProvider` is mounted once at the app root in `App.tsx`. Do not use the native HTML `title=` attribute for hover tooltips (it renders the browser's unstyled default); `title=` is reserved for section headings and non-hover uses.

---

## 11. Internationalization — `src/i18n/`

A hand-rolled `t()` hook over flat `en` / `zh` dictionaries in `translations.ts`.

- `useT()` binds to the current `settings.language` and returns `t(key, vars?)`.
- Keys are flat and namespaced by prefix (`app.*`, `chat.*`, `param.*`, `settings.*`, …).
- Interpolation replaces `{placeholder}` tokens: `t('chat.fileTooLarge', { name, size })`.
- `TranslationKey = keyof typeof translations.en` — so **both dictionaries must share an identical key set**, enforced at the type level.

Provider proper nouns (OpenAI / Claude / Gemini) are not translated.

---

## 12. Conventions

- **Path alias:** import from `@/…` (maps to `src/`), configured in `vite.config.ts` and `tsconfig.app.json`.
- **Styling:** Tailwind with `darkMode: 'class'` (the `dark` class is toggled on `<html>` from `settings.theme`); colors are HSL CSS custom properties in `src/index.css`. Use `cn()` from `src/lib/utils.ts` for conditional classes.
- **Strictness:** `noUnusedLocals` / `noUnusedParameters` are on — unused imports/vars fail the build.
- **i18n is required for any UI text** — never hardcode display strings in components.

---

## 13. Developer guides ("notes for future development")

### Add a new provider

1. Add the value to `ApiType` (`src/types/index.ts`).
2. In `src/lib/apiClient.ts`, implement all three layers: a request builder, an SSE handler, and a `parseFinal` branch.
3. Add a template to `API_TEMPLATES` (`src/lib/defaults.ts`).
4. Add any provider-specific UI/labels and i18n keys.

### Add a new parameter

1. Add the field to `ModelParameters`; if it should be optional/sendable-on-demand, add its name to `ToggleableParam`.
2. Add its default to `DEFAULT_PARAMETERS` and (if toggleable) `DEFAULT_ENABLED`.
3. Wire it into the relevant builder(s) in `apiClient.ts` (respect the enable flag and any provider constraints).
4. Add a control + enable toggle in `ParameterPanel.tsx`.
5. Add label/tooltip i18n keys to **both** `en` and `zh`.

### Add a new UI string

Add the `TranslationKey` to **both** `translations.en` and `translations.zh` (identical key sets), then use `t('your.key')` in the component.

### Build / verify

`npm run build` (which runs `tsc -b`) is the only correctness gate; there is **no test runner**. `npm run lint` keeps the repo clean. For UI changes, run `npm run dev` (port `51800`) and exercise the feature in a browser — type-checking verifies code correctness, not feature correctness.

---

## 14. Common gotchas

- **`hydrate()` must run before render** — the store is empty until then; `App.tsx` gates on `hydrated`.
- **Claude thinking strips sampling params** — don't be surprised when `temperature`/`top_p`/`top_k` vanish from a Claude request.
- **OpenAI reasoning strips sampling params** too (unless custom reasoning is used).
- **Think splitter only applies to OpenAI-compatible content** — Claude/Gemini use distinct reasoning events.
- **Session writes are debounced (~600ms)** — a save scheduled just before a hard reload may not flush.
- **`curl` export uses the direct URL**, not the proxied one, and preserves your API key in headers — treat exported commands as secrets.
