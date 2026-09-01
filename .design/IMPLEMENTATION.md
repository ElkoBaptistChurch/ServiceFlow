# ServiceFlow operator console — implementation brief

The design is settled. Build it from the mockups in this directory, which are the
authoritative source for every colour, size and spacing value.

- `Main.dc.html` — light theme, resting state. **The reference.**
- `SanctuaryDark.dc.html` — dark theme. Structurally identical to `Main.dc.html`
  line for line; only colour tokens differ. Diff the two to read the token map.
- `SearchOpen.dc.html` — light theme with the search/browse popover open.

Read exact values out of those files. Do not round or snap to a 4/8px grid, and do
not substitute a framework default for a value that is written down.

## Themes

Both themes are one stylesheet. Define the light palette on `:root`, redefine only
the changed tokens under `:root[data-theme="dark"]`, and set `data-theme` on the
document element. Do not fork the markup.

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--bg` | `#faf7f2` | `#17140f` | page ground, footer, recessed rows |
| `--surface` | `#ffffff` | `#211d16` | panels, cards, search field |
| `--border` | `#e7e0d5` | `#352e23` | hairlines, card borders |
| `--border-strong` | `#ddd2c0` | `#453c2c` | inputs, pills, popover edge |
| `--rule` | `#f0eae0` | `#2c261d` | dividers inside panels |
| `--chip` | `#f3ede2` | `#2b251b` | badges, inactive pills |
| `--tint` | `#f5efe4` | `#33291a` | live verse / live card fill |
| `--ink` | `#2c2823` | `#f2ece1` | primary text, Blank button fill |
| `--ink-2` | `#45403a` | `#e2d9cb` | card titles |
| `--ink-3` | `#6b6459` | `#b3a794` | body text |
| `--muted` | `#8b8377` | `#968b7a` | inactive nav |
| `--muted-2` | `#9a8f7f` | `#8d8272` | labels, meta |
| `--muted-3` | `#b0a696` | `#6f6558` | verse numbers, hints |
| `--muted-4` | `#c4b9a6` | `#5c5346` | remove icons |
| `--accent` | `#8a5a2b` | `#d09650` | nav underline, live borders, active toggle |
| `--accent-link-hover` | `#6b4420` | `#e3b478` | link hover |
| `--live` | `#2f7d4f` | `#4fae76` | "on the stream" dots and labels |
| `--meta-live` | `#8a7a63` | `#b0a48d` | meta text inside the live card |

Shadows also swap: `rgba(44,40,35,.04)` → `rgba(0,0,0,.4)`,
`rgba(44,40,35,.18)` → `rgba(0,0,0,.5)`, `rgba(138,90,43,.10)` → `rgba(208,150,80,.14)`.

Note the `--ink` / `--bg` pair inverts the Blank button correctly in both themes
(dark fill + light text in light mode, light fill + dark text in dark mode). That is
deliberate — it keeps Blank the strongest control on screen either way.

Fonts are Source Serif 4 (headings, scripture, card titles) and Source Sans 3 (UI),
both with fallback stacks as written in the mockups.

## Theme persistence

`app_settings` is already a plain key/value table, so this follows the existing
translation pattern exactly:

- `src/main/db/settingsRepository.ts` — add `SETTING_THEME = 'theme'` beside
  `SETTING_TRANSLATION`, with a getter defaulting to `'light'`.
- `src/shared/ipcChannels.ts` — add `GetTheme: 'app:get-theme'` and
  `SetTheme: 'app:set-theme'`.
- `src/main/ipc/handlers.ts`, `src/main/preload.ts`, `src/renderer/window.d.ts` —
  wire them through the same way `getActiveTranslation` / `setActiveTranslation` are.

**Read the stored theme before the window paints.** A dark-mode operator must not get
a white flash on launch — that is the whole point of persisting it for a booth.

## Details that are not visible in the markup

- **Item 10 is keyed `0`.** `App.tsx:120` matches `/^[1-9]$/`; widen it to
  `/^[0-9]$/` and map `0` to index 9. The badge on card 10 reads `0` in the mockup.
- **The sidebar list scrolls past 10 items.** Ten fit exactly with no scrollbar.
  Beyond that it scrolls, and the live card stays scrolled into view.
- **Search results are a popover**, not a stacked panel — see `SearchOpen.dc.html`.
  It overlays the service list, dismisses on `Escape`, and `Enter` stages the
  highlighted result. The service list must never be displaced by results.
- **The live card must not change height** when it becomes live. It is marked by a
  2px accent border and tint with compensating padding, so the list never reflows.
- **The theme toggle is inline SVG, not emoji**, and sits far right past a divider,
  deliberately away from Blank the screen.
- Existing behaviour must survive untouched: the sequence-number guards against
  stale async results in `SearchPanel`/`ContentPane`, the `hiddenRef` double-Esc
  guard in `App.tsx`, the arrow keys being bound to the content pane rather than
  `window`, and the `unhandledrejection` error banner.

## Constraints

- Styling and the theme setting only. Do not restructure component boundaries, change
  IPC payload shapes, or alter any existing behaviour beyond the `0` key fix.
- Keep every existing test passing; `npm run typecheck` and `npm test` must be clean.
- Preserve all current `aria-label` / `aria-pressed` / `role` attributes. The mockups
  carry `aria-pressed` on the toggle cells; keep that pattern.
