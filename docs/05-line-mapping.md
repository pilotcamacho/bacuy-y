# 05 — Line ↔ Activity mapping

How a line of text becomes an `Activity` row and back. Everything here runs on the device, with
no network. Code: `src/services/marks/` (parse, serialize, keywords), `src/services/editor/`
(line operations), `src/services/lifecycle/` (tick, status).

---

## 1. Fields owned by the text

| Line | Activity field |
|---|---|
| The whole line, as typed | `rawInput` |
| The line without recognized marks, whitespace collapsed, trimmed | `title` |
| `#flag` marks | `ActivityFlag` rows (one per resolved flag) |
| `!type` mark | `activityType` |
| `@date` mark | `deadline`, `eventDate` or `expirationDate` (depends on the type, see §3.3) |
| `~frequency` mark | `frequency` |

Every other field (`description`, `cron`, `targetCount`, `targetStreak`, `affirmation`,
`proficiencyLevel`, `learningResources`, `recipient`, `renewalLeadDays`, `documentRef`,
`renewalUrl`, `status`, feedback…) is edited **only in the side panel** and never appears in the
text.

**The text is authoritative** for the fields in the table. After every save, and after every
pull (reconcile, `docs/02-backend-architecture.md`), these fields are re-derived from `rawInput`.
The panel edits them by **rewriting the mark in the text** (add, replace or remove it), so the
two can never disagree.

`title` is required in the schema and may be the empty string (an empty line).

---

## 2. Mark grammar

A mark is a sigil (`#`, `!`, `@`, `~`) at the start of the line or right after whitespace,
followed by one or more non-whitespace characters. It ends at the next whitespace.

```
mark     := sigil body
sigil    := "#" | "!" | "@" | "~"
body     := 1*( any char except whitespace )
```

- Matching is **case-insensitive and accent-insensitive** (`!Hábito` = `!habito` = `!HABITO`).
- Keywords are accepted in **Spanish and English** whatever the UI language
  (`src/services/marks/keywords.ts`).
- A sigil in the middle of a word is plain text (`a#b`, `correo@x.com`).
- `\#`, `\!`, `\@`, `\~` escape a sigil: the backslash is hidden in `title` and the mark is not
  parsed.
- A trailing `.`, `,`, `;`, `:` after a mark is not part of it (`ir al médico @viernes.`).
- **Recognized** marks are removed from `title` and highlighted in the editor (a colored chip
  style, same text). **Unrecognized** marks stay in `title` as normal text, underlined with a
  dotted warning line and a tooltip (`marks.unknownFlag`, `marks.unknownType`…).
- If a single-value mark appears twice (`!habit … !skill`), the **last one wins**. The
  earlier ones are status `duplicate`: removed from `title` (they are valid marks) and
  highlighted with the warning style. A valid mark the type cannot use (`@date` on a habit,
  `~frequency` on an action) is status `notApplicable` and treated the same way. Only truly
  unknown or ambiguous marks stay in `title`. (Changed in Phase 4: a valid keyword left in
  the title read like noise.)

### 2.1 `#flag`

- Resolves to a flag by name, normalized (lowercase, no accents, spaces → `-`).
  `#salud`, `#Salud`, `#health` → the system flag `health`.
- System flags match their key **and** their translated names in every locale
  (`personal`, `familia/family`, `ingresos/income`, `salario/salary`, `proyecto/project`,
  `renta/rent`, `espiritual/spiritual`, `salud/health`, `recados/errand`, `diversion/fun`).
- A child flag can be written with its path: `#ingresos/salario`. Just the leaf (`#salario`)
  also works when the name is unique; if two flags share the name, the leaf alone is ambiguous
  and shown as unrecognized until the path is used.
- Several `#flag` marks are allowed: each resolved flag gets one `ActivityFlag`.
- An unknown flag name stays as an unrecognized mark. The panel offers "create flag `<name>`".
  When a flag is created or renamed, every line is re-parsed, so the mark resolves by itself.
- Renaming a flag does **not** rewrite existing lines (the old name stops resolving and is
  shown as unrecognized). (assumption — a "rename everywhere" action can come later.)

### 2.2 `!type`

| Type | Spanish | English |
|---|---|---|
| `ACTION` | `!accion`, `!tarea` | `!action`, `!task` |
| `REPETITIVE_ACTION` | `!repetitiva`, `!repetir` | `!repeat`, `!repetitive` |
| `HABIT` | `!habito` | `!habit` |
| `ATTITUDE` | `!actitud` | `!attitude` |
| `SKILL` | `!habilidad` | `!skill` |
| `MOMENTO` | `!momento` | `!moment` |
| `GRATITUDE` | `!gratitud` | `!gratitude` |
| `EXPIRATION` | `!vence`, `!vencimiento` | `!expires`, `!expiration` |

No `!type` mark → `ACTION`, except a line with a `~frequency` mark and no `!type`, which is
`REPETITIVE_ACTION`. Changing the type in the panel writes the Spanish or English keyword
according to the UI language.

### 2.3 `@date`

| Form | Meaning |
|---|---|
| `@hoy` / `@today` | today |
| `@mañana` / `@manana` / `@tomorrow` | tomorrow |
| `@lunes` … `@domingo` / `@monday` … `@sunday` | the next such day (today excluded) |
| `@2026-12-31` | that date (canonical form) |
| `@31/12` , `@31/12/2026` | day/month, day/month/year (assumption: always day-first) |

- A date without a year is the next occurrence of that day (today included).
- **Relative forms are resolved when the line is committed** (the cursor leaves the line,
  Enter, or the page is hidden), not on every keystroke, and are **rewritten in the text to the
  canonical ISO form** (`@viernes` → `@2026-11-20`). That way the line means the same date
  tomorrow and on every device. (assumption)
- The value is stored as the start of that day in local time, as an ISO datetime. A time of day
  is set in the panel only.

Which field it fills depends on the type:

| Type | `@date` fills |
|---|---|
| `ACTION`, `REPETITIVE_ACTION` | `deadline` |
| `MOMENTO` | `eventDate` |
| `EXPIRATION` | `expirationDate` |
| `HABIT`, `ATTITUDE`, `SKILL`, `GRATITUDE` | nothing (`notApplicable`, warning style) |

The text owns all three date fields: on every derive the type's own field gets the `@date`
value and the other two are cleared, so changing the type never leaves a stale date behind.
(Phase 6)

### 2.4 `~frequency`

| Value | Spanish | English |
|---|---|---|
| `DAILY` | `~diario` | `~daily` |
| `WEEKLY` | `~semanal` | `~weekly` |
| `MONTHLY` | `~mensual` | `~monthly` |

`CUSTOM` has no mark: it is set in the panel together with `cron`. Meaningful for
`REPETITIVE_ACTION` and `HABIT`; on other types it is `notApplicable` (warning style).

### 2.5 Examples

| Line typed | title | type | flags | other |
|---|---|---|---|---|
| `comprar pan` | comprar pan | ACTION | — | DRAFT |
| `comprar pan #recados` | comprar pan | ACTION | errand | ACTIVE |
| `meditar 10 min !hábito ~diario #espiritual` | meditar 10 min | HABIT | spiritual | frequency DAILY |
| `regar plantas ~semanal #personal` | regar plantas | REPETITIVE_ACTION | personal | frequency WEEKLY |
| `pasaporte !vence @2027-03-01 #personal` | pasaporte | EXPIRATION | personal | expirationDate 2027-03-01 |
| `informe @viernes #ingresos/proyecto` | informe | ACTION | income › project | deadline (rewritten to ISO on commit) |
| `revisar #xyz` | revisar #xyz | ACTION | — (`#xyz` unknown, underlined) | DRAFT |

---

## 3. Editing operations

All are pure functions in `src/services/editor/` over `{ lines, cursor }`, unit-tested without
a DOM. The store applies the result to `LocalDb`.

| Action | Result |
|---|---|
| Type | Update `rawInput` of that activity (debounced ≈300 ms, plus on blur / page hidden). |
| Enter at end of line | New activity below (`ACTION`, `DRAFT`, empty), focused. |
| Enter in the middle | Split: current keeps text before the cursor; new activity below gets the rest. Marks travel with the text they are in. |
| Enter at start of a non-empty line | New empty activity **above**; the line keeps its row (type, panel fields, history) and the caret, as in a text editor (confirmed 2026-11-17). |
| Backspace at start of a non-empty line | Merge into the line above: its `rawInput` += a space (only when neither side already has whitespace at the joint, so Enter then Backspace restores the line) + current text; current is soft-deleted (its `ActivityFlag`s and feedback are soft-deleted too). The line above keeps its id and fields; its marks are re-parsed. Exception: when the line above is empty, that empty row is soft-deleted instead and the current line keeps its row (undoes Enter at the start). |
| Backspace on an empty line | Soft-delete it, focus the end of the line above. |
| Delete at end of line | Merge the line below into this one (same rule). |
| Paste with newlines | First pasted line goes into the current line at the cursor; each following line becomes a new activity below, in order. Empty pasted lines are skipped. |
| ↑ / ↓ | Move focus to the line above / below, keeping the caret column when possible. |
| Alt+↑ / Alt+↓ | Move the line one place (new `position` between its new neighbours). |
| Drag handle | Same as Alt+arrow, any distance. @dnd-kit with pointer, touch (long-press 250 ms) and keyboard sensors. |
| Tick / Ctrl+Enter | Type-specific (see §4). |
| Ctrl+. / ⋯ | Open the side panel for the line. |
| Esc (panel open) | Close the panel, focus returns to the line. |

- Only one row changes when a line moves: `position = generateKeyBetween(prev?.position, next?.position)`.
- New lines also get a position between their neighbours.
- Undo (Ctrl+Z) inside a line is the browser's native undo for that input. Structural undo
  (restore a deleted or merged line) is out of scope for v1; a short "line deleted — undo" toast
  restores the last soft-deleted line within 5 s. (assumption)
- **Autocomplete** (confirmed 2026-11-17; `services/marks/suggest.ts`, `hooks/useLineSuggestions`,
  `components/SuggestionList`). A list under the line, only after typing in it (not on a click
  into it); Esc or blur closes it.
  - *Marks:* the word at the caret starting with `#`, `!`, `@` or `~` (the sigil alone lists
    everything) → flags (system ones by either language's name, subflags by name or
    `padre/hijo`, shown with their path), types, dates (hoy/mañana/weekdays, with the actual date)
    and frequencies. Both languages match; the UI language's word is written, unless the typed
    word only matches, or exactly is, the other language's. The first suggestion is preselected:
    Enter or Tab replaces the word and adds a space; ↑/↓ choose. A mark already typed in full
    (in either language) is left alone and nothing is preselected, so Enter still makes a new
    line (longer ones, e.g. `#salud-mental`, stay listed).
  - *Rows:* with the caret at the end and ≥ 2 characters typed, page lines and completed lines
    (newest 500, read from IndexedDB) whose text starts the same, or has a word that does
    (accents and case ignored), newest first, one per text, at most 5. Nothing is preselected,
    so Enter still makes a new line; ↓ then Enter, Tab, or a tap copies the text (marks included)
    into this line. The suggested row is not changed (a completed one stays completed).
  - A tap or click on a suggestion keeps the focus in the line. The textarea carries
    `aria-autocomplete="list"`, `aria-controls` and `aria-activedescendant`.
- Rendering: each line is its own input, not one big `contenteditable`. Because an `<input>`
  cannot color marks, the line is a transparent auto-growing `<textarea>` (Enter intercepted, so
  it never holds a newline) layered over a mirror `<div>` that draws the mark highlights.
  Long lines wrap visually. (assumption — confirmed or replaced in Phase 5.)

---

## 4. Tick and lifecycle per type

Status machine from bacuy-x (`bacuy-x/docs/05-activity-lifecycles.md`). The tick column is the
square at the start of the line.

| Type | Tick shows | Tick does | Completing / ending |
|---|---|---|---|
| `ACTION` | ☐ | Status → `COMPLETED`, `completedAt` = now; the line **leaves the page** for the Completed page (toast: undo, rate). Unticking it there → back to `ACTIVE` (or `DRAFT` if it has no flags) at its old place, `completedAt` cleared. | — |
| `REPETITIVE_ACTION` | ↻ + `count/target` | `completionCount += 1`, stays `ACTIVE`, and the line is **hidden until its next occurrence** (`hiddenUntil`, see below). If it reaches `targetCount` → `COMPLETED` instead (`completedAt` set; it moves to the Completed page). | Panel: complete or archive the series. |
| `HABIT` | ↻ + streak 🔥n | `streak += 1`, stays `ACTIVE`, hidden until its next occurrence. Reaching `targetStreak` shows a hint "mark as formed?" (panel → `COMPLETED`). | Panel. |
| `ATTITUDE` | ◇ (not clickable) | Nothing. Ctrl+Enter opens the feedback section of the panel. | Panel: completed (internalized) or archive. |
| `SKILL` | level badge | Nothing; level changed in the panel. | Panel. |
| `MOMENTO` | ★ (not clickable) | Nothing. | Archive only (never `COMPLETED`). |
| `GRATITUDE` | ☐ | Opens the panel with the notes field focused. "Save & complete" requires non-empty `description` → `COMPLETED`. | — |
| `EXPIRATION` | days-left badge (red when overdue) | Opens the panel: "Renewed → new date" (rewrites the `@date` mark, `isRenewed` stays false) or "Archive" (`isRenewed = true`, `ARCHIVED`). | — |

**Done for this time** (`REPETITIVE_ACTION`, `HABIT`; confirmed 2026-11-15). The tick sets
`hiddenUntil` to the next occurrence (`services/lifecycle/nextShow.ts`):

- `cron` set and valid → its next fire time;
- otherwise by `frequency`, at 00:00 local: `~diario` (or no frequency, or `CUSTOM` without a
  cron) → tomorrow; `~semanal` → same weekday next week; `~mensual` → same day next month
  (its last day if shorter).

Counted from the tick, so a line done late drifts to the day it was done. To pin the day, the
panel's **schedule picker** (confirmed 2026-11-17; `components/SchedulePicker`,
`services/lifecycle/schedule.ts`) writes a plain `cron` (no schema change), which then wins:
`~semanal` → weekdays (several allowed) `m h * * 1,4`; `~mensual` → day 1–28 or "último día"
`m h D * *` / `m h L * *` (29–31 are not offered: cron would skip shorter months); `~diario` →
a time `m h * * *`. The time is optional (00:00). Only these shapes are read back into the
picker; any other cron is "custom", shown with a note, and edited under *Avanzado*. Changing the
frequency (panel or mark) clears a picked cron of the other kind; a custom cron, and a switch to
`CUSTOM`, keep it.

The line leaves the page and the priority view until then, and comes back by itself at that
time, in the same place (the page keeps a timer to the soonest one; offline too). A toast
"Hecho por ahora. Vuelve el …" offers *Deshacer* (counter and visibility as before) and
*Valorar* for 6 s. The **Ocultas** tab lists them with when each returns, *Mostrar ahora*
(`hiddenUntil = null`) and *Cambiar*. `hiddenUntil` syncs, so a line done on one device is
hidden on the others. The focus moves to the line taking its place.

**Hide by hand** (bacuy-x's snooze; confirmed 2026-11-17). Panel → *Ocultar*: quick choices
(3 horas, mañana 8:00, lunes 8:00 — never today —, en un mes, same day clamped), a date and
time (`datetime-local`, must be in the future), or *Hasta que la muestre*. A date sets
`hiddenUntil` (and `isHidden = false`); "until shown" sets `isHidden = true` and clears
`hiddenUntil`. A line is hidden when `isHidden` or `hiddenUntil` is in the future
(`isHiddenNow`). The panel closes, the focus moves on, and a toast "Oculta hasta el …" /
"Oculta hasta que la muestres." offers *Deshacer* (no *Valorar*: nothing was done). On a
hidden line the panel shows when it returns and *Mostrar ahora* instead.

Shared rules:

- A tick works on a `DRAFT` line too (it is a to-do page; it does not need flags first).
- A tick that takes the line off the page (completed, or done for this time) shows a toast
  for 6 s: "Completada." / "Hecho por ahora. Vuelve el …", with **Deshacer** (restores the
  status, `completedAt`, counters and `hiddenUntil`) and **Valorar** (the feedback form).
  Ignoring it does nothing. The focus moves to the line taking its place.
- `completedAt` is set whenever a line becomes `COMPLETED` (tick or panel) and cleared when it
  leaves `COMPLETED` (untick, reactivate, pause).
- `DRAFT ↔ ACTIVE` follows the flags: first resolved `#flag` → `ACTIVE`; last one removed →
  `DRAFT` (only if the status was `ACTIVE`).
- `INACTIVE` (pause) is set in the panel. The line stays on the page in italics, without tick.
- `ARCHIVED` (panel) removes the line from the page. The Archived view restores it (to
  `ACTIVE` or `DRAFT` by the flag rule, at the end of the page).
- Habit streak reset on a missed cycle is **not** automatic, as in bacuy-x.
- Two offline devices ticking the same habit keep one increment (row-level last edit wins).
  Accepted for v1.

---

## 5. Side panel

Right-hand drawer (≥ 768 px) or bottom sheet (phones). `data-testid="line-panel"`. Sections:

1. **Text**: the line (same input as the page) for convenience.
2. **Type** (select) and **status** (pause / reactivate / complete / archive, per type rules).
   **Ocultar** (not for completed or archived lines): see "Hide by hand" in §4.
3. **Flags**: chips of the resolved flags; add from the tree; remove. Writes `#flag` marks.
4. **Type fields**: only those for the current type (§1 list). Date fields with a mark write
   the mark; the others are plain inputs.
5. **Description** (multiline; for `GRATITUDE` this is the journal notes).
6. **Schedule**: frequency; for daily / weekly / monthly lines the day / date / time picker
   (see §4), with the raw `cron` under *Avanzado*; other lines show the raw `cron` (with a
   human-readable preview through `cron-parser` + i18n).
7. **Feedback**: list of feedback entries for the activity + "add" (rating 1–5, valence −1..1,
   arousal 0..1, notes).
8. **Delete line** (soft delete, same as Backspace on an empty line).

Every change in the panel is a structural write (immediate, no debounce).

---

## 6. Views derived from the same rows

| View | Rows | Order | Editable |
|---|---|---|---|
| Page | not deleted, status ≠ `ARCHIVED` / `COMPLETED`, not hidden (`isHidden`, or `hiddenUntil` in the future) | `position` | yes |
| Hidden | the page's rows that are hidden now | `hiddenUntil` asc, then "until shown" (`isHidden`) by `position` | show now, change (same choices as the panel), panel |
| Priority | `status = ACTIVE`, not `isHidden`, `hiddenUntil` passed, expiration within `renewalLeadDays` | score desc (`services/priority/score.ts`) | tick and panel only; no text editing, no drag. Click → go to that line on the page. |
| Journal | `GRATITUDE` + `COMPLETED` | `updatedAt`/`editedAt` desc | via panel |
| Completed | `status = COMPLETED`, not `GRATITUDE` (the journal's) | `completedAt` desc (falls back to `editedAt` for lines completed before the field existed), grouped by day, 50 at a time | untick (back to its place), panel, delete |
| Archived | `status = ARCHIVED` | `editedAt` desc | restore, delete |

**Manual** (`/help`, `routes/Help.tsx`; top menu "Manual" / "Guide"; confirmed 2026-11-17).
A user-facing summary of this document, bundled with the app (works offline), all text in
`help.*` locale keys: writing lines, marks, each type (what it is for, an example, its `!mark`,
what the tick does, what `@date` fills, whether `~frequency` applies, its own panel fields),
statuses, tabs and screens, keyboard. The panel's Type field links to `/help#type-<TYPE>`
(closes the panel, scrolls to and focuses that type). **When a type's behaviour or fields
change, update the `TYPES` table in `Help.tsx` and the `help.*` texts too.**

Page, Hidden (with its count), Completed and Archived are tabs of the "Página" section
(`components/LineTabs`); the main navigation keeps "Página" active on all of them.

**Filter by flag** (Pendientes tab; confirmed 2026-11-17; `services/editor/flagFilter.ts`,
`components/FlagFilter`). "Filtrar por bandera" opens the flag tree as checkboxes plus
"Sin bandera". A line is shown when any of its `#flag` marks is a chosen flag **or a
descendant** of one (a parent includes its children), or it has no flag and "Sin bandera" is
chosen. While a filter is on, chips under the tabs name it (× removes one, "Quitar filtro"
clears all). The choice is kept on this device (`bacuyy_pageFilter`); deleted flags drop out of
it. Editing works on the visible lines:

- A new line (Enter, split, paste, typing on an empty filtered page) gets the filter's first
  flag mark (` #salud`), unless it already matches; a filter of only "Sin bandera" adds nothing.
- New and moved lines are placed in the **whole** page right after their visible predecessor
  (before whatever hidden-by-filter line follows it), so turning the filter off shows them where
  they were typed.
- A line shown under the current filter stays in view until the filter changes, even if an edit
  removes its mark, so the line being edited never vanishes.
- Undo restore and lines from other tabs go back to the end of the whole page as before.

**Memory:** the page store loads every row except completed tasks (completed gratitude
entries stay: the journal needs them). The Completed page reads completed rows from IndexedDB
(`status` index) only while it is open, so a long history does not slow the page. A row
opened from there (panel) is added to memory for that session.

Priority score (ported from bacuy-x, adapted):

```
pathScore(flag)  = Π over flag → root of ( weight / sum(weights of its siblings) )
flagScore        = max pathScore over the activity's flags            (0 if none)
cronBoost        = 0.3 if the next cron occurrence is within 60 min, else 0
score            = flagScore × (1 + cronBoost)
EXPIRATION       = flagScore / max(daysUntil(expirationDate), 1) × (1 + cronBoost)
```

`daysUntil` counts calendar days (as the line's badge does). Ties keep the page order. The view
re-scores every minute. Restoring from Archived puts the line after the last page line, with
the status from the flag rule (an `EXPIRATION` also gets `isRenewed: false` back); deleting
from Archived asks for confirmation and soft-deletes the row, its links and its feedback.

Differences from bacuy-x: weights normalized by the real sibling sum (rule 11, tolerates drift
after a merge), **no neglect multiplier** (needs the timer) and **no environment boost** (needs
location). Both come back when those features are ported.
