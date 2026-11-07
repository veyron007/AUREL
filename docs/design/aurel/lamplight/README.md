# Lamplight — verification record

**7 November 2026.** Lamplight is the VisionQuest-derived theme selected by the
judged tournament recorded in [explorations-02.html](../explorations-02.html).
It lives in `src/ui/styles/lamplight.css`; `aurel.css` keeps only the workspace
sheet imports; base sheets consume tokens with Cyber-safe fallbacks.

## What changed

- One token root on `:root:not([data-ui-theme='cyber'])`: oxblood command glass,
  petrol information surfaces, a measured L* ladder (ink → glass/info → raised →
  menu), brass `#d6ab55` as the only interactive colour, petrol-teal confined to
  the focus ring and scroll thumb.
- The workspace appearance remap (Observatory) now distinguishes chrome from
  information surfaces: top bar, task rail, tools, dock and dialogs are oxblood;
  panel bodies, lists, popovers, inspector and sheets are petrol. Field and
  Instrument keep their own palettes.
- Base sheets (scenes, controls, cockpit, layers, status, slider, radio, weather,
  cctv, street-level, foundation, overlays, dock, chat, voice, first-run,
  provider settings, locale picker, mobile shell, workspace feature panels)
  replaced legacy cyan literals with `var(--token, <old value>)`, so the Cyber
  theme resolves to its own tokens or the old values.
- Four pinned-literal tests were updated to accept the tokenised declarations:
  `panelStackLayout`, `cockpitMarkup`, `radioMarkup` (slider track).
- Data Layers rows: the workspace sheet's explicit `min-height` removed the flex
  content minimum, so rows shrank to 36px and painted their source line over
  the next row. Rows no longer shrink (`flex-shrink: 0`); the list scrolls.
- Brand colour `#141011` in `index.html`, `manifest.webmanifest` and the
  regenerated `public/icons/*.png`.

## Checks

| Check | Result |
| --- | --- |
| `npm test` | 11,446 tests, 11,442 passed, 0 failed, 4 skipped (Node 26 allocation probes) |
| `npm run format:check` | passed, 2,007 files |
| `npm run check:boundaries` | passed |
| Browser, 1440×900 | main view, Data Layers, Context, Location tray, Visual Presets, provider settings, chat panel, Cyber layout, Field and Instrument appearances |
| Browser, 390×844 | Explore shell |

Screenshots: [before](before/) and [after](after/). The first-run launcher was
not re-captured after the change because the restored session suppresses it;
its styling shares the provider-settings dialog treatment, which was captured.

## Not claimed

No accessibility certification; data-colour overlays (tracks, fires, vessels,
detection, provider brands) are intentionally unchanged; the Cyber layout was
checked once at desktop size only.
