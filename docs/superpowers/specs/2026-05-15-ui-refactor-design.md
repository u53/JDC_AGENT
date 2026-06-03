# JDCAGNET UI Refactor Design Spec

## Overview

Transform JDCAGNET from a CRT-terminal-style chat client into a professional, quiet, editorial AI workbench. Support light/dark/system themes. Preserve all existing functionality.

**Approach:** Progressive replacement (方案 A) — each component replaced incrementally, build must pass at every step.

**Visual direction:** Quiet, professional, minimal, editorial, workbench feel. No cyber-terminal, no CRT scanlines, no neon green, no chat bubbles. Warm whites, bone whites, deep grays, soft blacks. Serif for headings, sans for UI, mono for code/paths.

---

## 1. Theme System & CSS Tokens

### Mechanism

- `index.css` defines three token sets: `:root` (light), `[data-theme="dark"]`, `[data-theme="system"]` (via `@media prefers-color-scheme`)
- Delete `* { border-radius: 0 !important }` and CRT scanline `body::after`
- Root element: `<html data-theme="light|dark|system">` controlled by settings store

### Token Table

| Token | Light | Dark |
|-------|-------|------|
| `--bg` | `#f7f5ef` | `#111215` |
| `--surface` | `#ffffff` | `#17191d` |
| `--surface-2` | `#fbfaf7` | `#1c1f24` |
| `--surface-3` | `#f4f1ea` | `#22252b` |
| `--text` | `#1e1d1a` | `#f4f0e8` |
| `--muted` | `#757069` | `#a3a095` |
| `--border` | `rgba(30,29,26,0.10)` | `rgba(255,255,255,0.08)` |
| `--border-strong` | `rgba(30,29,26,0.16)` | `rgba(255,255,255,0.14)` |
| `--accent` | `#1f1d1a` | `#f4f0e8` |
| `--accent-soft` | `#ece8dd` | `#262931` |
| `--accent-ink` | `#ffffff` | `#111215` |
| `--good` | `#7e9f7a` | `#9bb693` |
| `--warn` | `#a07c37` | `#d0b57d` |
| `--bad` | `#a35b53` | `#d29b94` |
| `--plan` | `#8b7ec8` | `#a99be0` |
| `--shadow` | `0 1px 0 rgba(30,29,26,0.02)` | `0 1px 0 rgba(0,0,0,0.24)` |
| `--shadow-soft` | `0 8px 28px rgba(30,29,26,0.05)` | `0 12px 32px rgba(0,0,0,0.25)` |

### Font Stacks

- Heading serif: `"Iowan Old Style", "Baskerville", "Georgia", serif`
- UI sans: `"SF Pro Display", "Geist Sans", "Helvetica Neue", sans-serif`
- Code mono: `"Geist Mono", "SF Mono", "JetBrains Mono", monospace`

### Persistence

- `settings-store` gains `theme: 'light' | 'dark' | 'system'` field
- Read/write via existing `ipc.config.get/set` → `~/.jdcagnet/config.json` `theme` key
- On app start: read config, set `document.documentElement.dataset.theme`
- `system` mode: listen to `window.matchMedia('(prefers-color-scheme: dark)')` change event, update tokens in real time

### Theme Switch UI

Segmented control in Topbar: 白天 / 黑夜 / 跟随系统

---

## 2. App Shell Layout

### Grid Structure

```
grid-template-columns: 240px 1fr auto;
grid-template-rows: 48px 1fr;
```

- Row 1: Topbar (spans full width)
- Row 2 col 1: Sidebar (240px)
- Row 2 col 2: Main area (Project Page or Chat Page)
- Row 2 col 3: Inspector (44px rail / 300px expanded)

### Topbar (48px) — app-level, always visible

- Drag region (full width, `-webkit-app-region: drag`)
- Left: project name (serif, 18px)
- Center: status badges (streaming indicator, error count)
- Right: theme segmented control, New session button, Settings button
- Note: this is distinct from Session Header (section 5), which lives inside the Chat Page main area and shows session-specific state

### Routing (state-driven, no router)

- `activeSessionId === null` → Project Page
- `activeSessionId !== null` → Chat Page
- Settings / Help as overlays (z-50)

### Z-index Layers

- `z-40`: Inspector expanded
- `z-50`: Settings overlay, AskUser dialog, Permission dialog
- `z-60`: Destructive confirm dialogs

---

## 3. Sidebar (240px)

### Structure

- Top: 38px drag spacer
- Body: project groups with nested sessions
- Bottom: fixed "New project" button

### Visual

- Background: `var(--surface)`
- Right border: `var(--border)`
- Project header: 12px uppercase tracking muted
- Session row: 13px sans, status dot (streaming=warn, error=bad, done=good)
- Active session: 2px left accent bar + `surface-2` background
- Hover: `surface-3` background
- "New session": muted color, hover → text color
- "New project": bottom-fixed, ghost button style

---

## 4. Project Page

Displayed when `activeSessionId === null`.

### Layout

CSS grid, 2-column card grid. Top card spans full width.

### Cards

1. **Project Info** (full width): project name, path (mono), active model, session count
2. **Recent Sessions**: list of sessions with status dots, click to switch
3. **MCP Health**: connected/total count, server names, status dots
4. **Usage Summary**: total tokens, cache hit rate, context usage
5. **Tasks Summary**: in-progress count, pending count

### Card Style

- `var(--surface)` background, `var(--border)` border, `border-radius: 12px`, padding 18px
- Card title: 12px uppercase tracking muted
- Data values: 14-16px text color

### Empty State

- No projects: "添加项目开始使用" + primary button
- No sessions: "选择项目或新建会话" (one line, no illustrations)

### Data Sources

- Project info: `session-store.projects`
- MCP: `electronAPI.mcpListServers()` IPC
- Usage: `sessionStates[id].usage` from most recent session
- Tasks: `session-store.tasks`

---

## 5. Chat Page (Session Workspace)

### Structure

```
Session Header (40px)
Conversation Timeline (flex-1, scrollable)
Composer (fixed bottom)
```

### Session Header

- Left: project name / session short ID
- Center: model name pill, permission mode badge, thinking/plan status dots
- Right: context usage bar (thin 4px), queue count badge, streaming status

### Turn Model

Each turn = one user message + complete assistant response (including all tool calls).

```
Turn N
├── User input (left accent bar, 14px)
├── Assistant response area
│   ├── Thinking indicator (muted, inline)
│   ├── Tool calls (collapsible cards, inline)
│   ├── Text output (markdown rendered)
│   └── Error / Permission / PlanReview (anchored here)
└── Turn footer (muted: status · duration · tokens)
```

- Turn separator: `border-bottom: 1px solid var(--border)`
- Active turn (streaming): no footer, live indicator at bottom
- Streaming text: directly visible in assistant area (no manual expand needed)
- Thinking: one-line muted status "Thinking... (1.2k chars)"

### Moved Out of Timeline

- `FileChangesPanel` → Inspector
- `TaskPanel` → Inspector
- `QueueIndicator` → Composer chip
- `StatsCard` → Inspector usage section (no longer fake message)

---

## 6. Composer

### Structure

- Fixed at Chat Page bottom, `var(--surface)` background, top border
- Queue chip above textarea (only when queue non-empty)
- Textarea: `surface-2` bg, `border`, `border-radius: 10px`, 14px sans
- Status bar below textarea

### Button Logic

| State | Primary Action | Secondary |
|-------|---------------|-----------|
| Idle, has text | Send (accent) | — |
| Streaming, empty input | Stop (bad outline) | — |
| Streaming, has text | Queue (accent) | Stop (bad outline, small) |

### Status Bar (below textarea)

- Left: permission mode (clickable), thinking dot+label, plan dot+label
- Right: model name (click → Settings Models tab)
- Style: 12px muted, active states use `--good` or `--accent`

### Queue Chip

- Above composer, only when queue non-empty
- Pill style: `surface-3` bg + `warn` dot, "Queue: N messages"
- Click to expand: list with per-item remove (×) + "Clear all"
- This is the primary queue interaction point; Inspector also shows queue as read + remove, both share `session-store.messageQueue`

### Slash Command Menu

- Trigger: type `/`
- Style: command palette — `surface` bg, `border-radius: 12px`, `shadow-soft`
- Items: icon + name + description, hover `surface-2`
- Sections: Commands / Skills, muted section headers

---

## 7. Tool Card System

### ToolCardShell Structure

1. **Header** (always visible = collapsed state): status dot + tool label + detail + status
2. **Preview** (expanded): semantic preview, not raw dump
3. **Actions** (expanded footer): operation buttons
4. **Inspect** (secondary expand): raw JSON / full output

### Visual Rules

- Card: `surface-2` bg, `border`, `border-radius: 8px`
- Status dot: running = `warn` + pulse, done = `muted` (neutral), error = `bad`
- Success is understated; only errors get color emphasis
- Collapsed height: ~36px, scannable
- Running state: collapsible, but header retains live status text

### Detail Format Per Tool

| Tool | Collapsed Detail |
|------|-----------------|
| Read | `filepath (N lines)` |
| Write | `filepath +N lines` |
| Edit | `filepath +N -M` |
| Bash | `$ command_truncated` · exit code |
| MCP | `server::tool` · result summary |
| Agent | `"prompt..."` · N turns · M tools |
| Skill | `skill_name` · source |

### Research Bundle

- 2+ consecutive completed Read/Search/List calls auto-aggregate
- Collapsed: "Research · 4 files read"
- Expand: file list
- Existing `groupToolEvents` logic preserved and enhanced

### Action Buttons

- Ghost button style: `surface-3` bg, `border`, `border-radius: 6px`, 12px
- Natural text labels: Copy, Open, Inspect, Retry, Abort (no brackets)

---

## 8. Inspector (Right Panel)

### Collapsed State (slim rail, 44px)

- Vertical icon column (inline SVG icons)
- Icons: Tasks, Queue, Usage, Files, Session info
- Badge with count when section has content
- Click any icon → expand inspector, scroll to section

### Expanded State (300px)

- Background: `var(--surface)`, left border `var(--border)`
- Sections separated by `border-bottom`
- Section headers: 12px uppercase muted
- Close button top-right

#### Sections

1. **Session**: ID, project, duration
2. **Usage**: tokens, cache hit %, context bar (4px, accent fill, >80% = bad)
3. **Tasks**: status dot + ID + subject + status label
4. **Queue**: message preview + remove button + "Clear all"
5. **Files Changed**: change type indicator + path + Accept/Revert buttons

### Animation

- Expand/collapse: `transform: translateX` + `opacity`, 180ms ease

### Responsive

- Window < 900px: auto-collapse to rail, cannot pin expanded
- Window < 700px: rail hidden, info falls back to session header badges

---

## 9. Settings Overlay

### Structure

- Centered modal, `max-width: 680px`, `max-height: 80vh`
- `surface` bg, `border`, `border-radius: 14px`, `shadow-soft`
- Backdrop: `bg-black/20` (light) / `bg-black/60` (dark)
- Left tab nav: 160px, `surface-2` bg, active tab `accent-soft` bg + `accent` text

### Tabs

#### Appearance
- Theme: segmented control (白天 / 黑夜 / 跟随系统)
- Font size: small / medium / large (future)

#### Models & Providers
- Left: group list (collapsible), name + protocol pill + model count
- Right: selected group edit (base url, api key, models list)
- Add group/model: inline form expand
- Reuses `model-store` logic entirely

#### MCP Servers
- Server list: status dot + name + transport pill + tool count
- Expand: command/url, tools list, error info
- Actions: Enable / Disable / Reconnect / Delete
- Reuses existing MCP IPC logic

#### Shortcuts
- Read-only reference table, two columns: shortcut + description
- Hardcoded data

#### Advanced
- Default permission mode
- Compress threshold
- Extensible later

### Replaces

- `SettingsPanel.tsx` (deleted)
- `ModelManager.tsx` (deleted)
- `McpSettings.tsx` (deleted)

---

## 10. Overlays & Interactive Components

### Permission Dialog

- Anchored in triggering turn
- Card: `surface-2` bg, left `warn` bar (4px), `border-radius: 8px`
- Content: tool name + operation description + file path
- Buttons: Allow (primary), Deny (ghost), Allow all (ghost muted)

### Plan Review Dialog

- Anchored in triggering turn
- Left bar: `var(--plan)` color
- Content: plan file content, mono font, max-height scroll
- Buttons: Approve (primary), Reject (ghost) → expand feedback input on reject

### Ask User Dialog

- Full-screen overlay (requires immediate response)
- Card: `surface`, `border-radius: 14px`, `shadow-soft`, max-width 520px
- Question: 16px text
- Options: clickable rows, hover `surface-2`, selected `accent-soft` bg
- Multi-select: checkbox style
- Bottom: text input for "Other" + Submit

### Error Card

- Anchored in turn
- Left `bad` bar
- Content: error message + category badge
- Retrying: "Retrying in Ns..." + progress indicator
- Buttons: Retry (primary), Dismiss (ghost)

### Toast

- Fixed top-center of window
- `surface` bg, `border`, `border-radius: 8px`, `shadow-soft`
- 2.5s auto-dismiss, `opacity` + `translateY` animation

---

## 11. Component Lifecycle

### Deleted

| Component | Replaced By |
|-----------|-------------|
| `SettingsPanel.tsx` | Settings overlay Appearance/Advanced |
| `ModelManager.tsx` | Settings overlay Models tab |
| `McpSettings.tsx` | Settings overlay MCP tab |
| `UsageHUD.tsx` | Inspector usage + Session Header |
| `StatsCard.tsx` | Inspector usage (no fake messages) |
| `ModelSwitcher.tsx` | Composer status bar model click |

### Refactored

| Component | Change |
|-----------|--------|
| `MessageBubble.tsx` | → `ConversationTurn.tsx` (turn model) |
| `ChatView.tsx` | → session header + timeline + composer |
| `ToolCardShell.tsx` | Visual redo, props interface preserved |
| `QueueIndicator.tsx` | → Composer chip + Inspector section |
| `TaskPanel.tsx` | → Inspector section |
| `FileChangesPanel.tsx` | → Inspector section |
| `SlashCommandMenu.tsx` | → Command palette visual |

### New Components

| Component | Purpose |
|-----------|---------|
| `Topbar.tsx` | Top bar: drag region, project name, theme switch, actions |
| `ProjectPage.tsx` | Project overview page |
| `ConversationTurn.tsx` | Turn container (replaces MessageBubble) |
| `SessionHeader.tsx` | Chat page top status bar |
| `Inspector.tsx` | Right panel (rail + expanded) |
| `SettingsOverlay.tsx` | Unified settings (tabbed) |
| `ThemeSegmented.tsx` | Theme switch segmented control |

### Store Changes

- `settings-store.ts`: add `theme` field, `setTheme` action, `activeTab` for overlay
- `session-store.ts`: unchanged (tasks filtered by activeSessionId in UI layer)
- `model-store.ts`: unchanged

---

## 12. Implementation Order

1. Theme system + CSS tokens (index.css rewrite, settings-store theme field)
2. App shell: Topbar + grid layout + Sidebar visual redo
3. Project Page
4. Chat Page: Session Header + ConversationTurn + Composer
5. Tool Card system (ToolCardShell + per-type cards)
6. Inspector (rail + expanded + sections)
7. Settings Overlay (tabs, absorb ModelManager + McpSettings)
8. Clean up deleted components, remove dead code
9. Responsive, empty states, hover/focus, keyboard accessibility

Each step must pass `pnpm --filter @jdcagnet/ui build`.

---

## 13. Constraints

- No existing functionality deleted
- No large UI framework additions (Radix already available for primitives)
- No over-abstraction
- No marketing-style pages or hero illustrations
- Icons: inline SVG (no icon library dependency)
- All text readable, no overlap, no truncation by buttons
- Animations: only opacity + transform, restrained
- Build must pass after each implementation step
