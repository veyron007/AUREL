# Spatial — verification record

**8 November 2026.** Spatial is the visionOS-style direction the owner chose
from the taste round (prototype `taste/spatial.html`). It replaces Lamplight
as the default look. Lamplight's sheet stays in place underneath; Cyber is
unchanged.

## What changed

### Theme

- `src/ui/styles/spatial.css` (tokens and every surface Lamplight styles) and
  `src/ui/styles/spatial-shell.css` (workspace composition, entity card,
  palette, chrome rest, motion). Both are imported after `lamplight.css` and
  before `cyber.css`; `style.css` still holds only `@import` lines and Cyber
  stays last.
- Glass panes: `blur(40px) saturate(1.7)`, a 14% white fill over a dark floor
  for legibility over bright terrain, a 1px 32% white edge, an inset top
  highlight, 28px radius and a deep soft shadow. Panes inside the frosted dock
  (chat, voice settings, dock popovers) use a nearly opaque glass, because the
  dock is their backdrop root and a blur there cannot reach the globe.
- White pill primary actions with dark text; glass secondary actions; sky blue
  (`#7ad7ff`) as the only interactive tint (focus ring, listening voice); warm
  amber only for alerts and the provider chip.
- Plus Jakarta Sans (interface) is bundled locally as four woff2 subsets under
  `public/fonts/`, registered in `fonts.css` and `manifest.json` with
  provenance and checksums, license in `public/fonts/licenses/`. JetBrains Mono
  (data) was already bundled.
- Field and Instrument keep their own colours on the Spatial geometry.
- Every rule keeps the `:root:not([data-ui-theme='cyber'])` guard (zero
  specificity where it re-expresses an existing rule).

### UX owners

| Item                 | Owner                                                                                                                                                              | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| One focus at a time  | Existing: `PanelNavigation.openPanel` collapses the other panels and `sync()` suppresses a second restored panel                                                   | Already present; verified in the browser (one inspector shown)                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Chrome rest and wake | `src/ui/chromeRest.js`, started by `WorkspaceView.vue`                                                                                                             | Done: `body.chrome-resting` after 5 s without input (armed by the first input), cleared on pointer, key, wheel, touch or focus; never while a panel, tray, dialog, rendered popover, focused field, the palette or a live voice turn is open                                                                                                                                                                                                                                         |
| Command palette      | `src/ui/commandPalette.js` (list, keys), `src/app/paletteTools.js` (composition), `src/ui/stores/palette.js`, `views/panels/CommandPalette.vue`                    | Done: ⌘K / Ctrl+K toggle, `/` opens outside fields; places from the location field's suggestion engine (`LocationControls.suggestPlaces` / `chooseSuggestion`), layers from the Data Layers catalog toggled with the same `dataManager.setEnabled(…, { origin: 'user' })` call as the row, destinations through the workspace store, reset through the globe actions, voice through the voice presenter's button. Arrow keys, Ctrl+Home/End, Enter, Esc; focus returns to the opener |
| Entity card          | `LensPanel.vue` restyled; eyebrow (source · age of the newest supplied observation), large title, three stat tiles, label/value lines, primary and secondary pills | Done for every selection that already reaches Lens (search results, map features: verified with a clicked USGS earthquake). No new fetches                                                                                                                                                                                                                                                                                                                                           |
| Motion               | `spatial-shell.css`                                                                                                                                                | Done: panes rise 12px and fade in over 450 ms on `cubic-bezier(.2,.8,.2,1)`; palette opens in 350 ms; hover lift and press settle on buttons; none of it moves the camera; all off under `prefers-reduced-motion`                                                                                                                                                                                                                                                                    |
| Voice pill           | `spatial.css`                                                                                                                                                      | Done: glass mic socket; listening/connecting/executing turns it sky with a halo and lights the existing waveform. Voice logic untouched                                                                                                                                                                                                                                                                                                                                              |
| Top bar              | `WorkspaceView.vue`                                                                                                                                                | Done: no "Explore the globe" placeholder (the chip shows only a real place); the bare map source text became an imagery stamp at the lower left naming the full source; Appearance moved into a Settings disclosure in the tools pane (`.workspace-appearance select` kept)                                                                                                                                                                                                          |

The ornament is two adjacent glass pills (search with the ⌘K hint, then the
four destinations) rather than one element: they are rendered by two existing
views (`CommandDockView` owns the search field's listeners). Voice stays in
the dock as the Spatial voice pill and is also reachable from the palette.

## Checks

| Check                                                                     | Result                                                                           |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `npm test`                                                                | 11,913 tests, 11,909 passed, 0 failed, 4 skipped (Node 26 allocation probes)     |
| New unit tests                                                            | `chromeRest.test.mjs` 7, `commandPalette.test.mjs` 11, `paletteTools.test.mjs` 4 |
| `npm run format:check`                                                    | passed                                                                           |
| `npm run check:boundaries`                                                | passed                                                                           |
| `npm run i18n`                                                            | all 11 locales complete (17 new messages; "Explore the globe" pruned)            |
| `npm run build`                                                           | passed                                                                           |
| Browser (`scripts/qa-aurel-spatial.mjs`, puppeteer, 1440×900 and 390×844) | 19/19 checks, see `qa-results.json`                                              |

Browser checks: ornament row, no placeholder label, imagery stamp names the
source, Plus Jakarta Sans applied; ⌘K opens, typing ranks the Earthquakes
layer first, Enter enables it through its owner; `/` opens, Esc closes; one
side panel at a time; a chosen place and a clicked earthquake both open the
same entity card; chrome rests after a quiet spell and wakes on movement;
reduced motion stops the palette animation; Cyber keeps its own theme; no page
errors on desktop or phone.

## Screenshots

| File                                               | Shows                                           |
| -------------------------------------------------- | ----------------------------------------------- |
| `desktop-ornament.png`                             | Default view: ornament, tools pane, dock, stamp |
| `desktop-palette.png`, `desktop-palette-query.png` | Palette open; typed query                       |
| `desktop-place-card.png`                           | Dehradun in the entity card, place chip         |
| `desktop-entity-card.png`                          | A clicked USGS earthquake in the same card      |
| `desktop-context-card.png`                         | One inspector after switching tools             |
| `desktop-resting.png`                              | Chrome resting                                  |
| `desktop-field.png`                                | Field appearance on the Spatial geometry        |
| `desktop-cyber.png`                                | Cyber layout                                    |
| `phone-explore.png`, `phone-place-card.png`        | 390×844                                         |

## Not verified or not done

- Aircraft and vessel cards were not exercised: no live aircraft or vessel was
  selected in the headless run. They reach the same Lens card through the
  same selection events as the earthquake.
- The map's own canvas-painted selection card (world overlay) keeps its
  existing cyan styling; its colours are constants pinned by overlay tests.
- No capture date is shown on the imagery stamp: the app has no capture date
  for the active base map without a new request.
- The first-run launcher was not captured (the restored session suppresses
  it); it shares the provider-settings dialog treatment, which was checked.
- Phone: the stamp and the ⌘K hint are hidden; the phone keeps its existing
  sheet geometry with the glass treatment.
- Glass contrast over very bright imagery was checked by eye only; no
  automated contrast audit.
- Only Chromium (headless) was used.
