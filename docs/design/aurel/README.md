# AUREL — personal interface identity

Adaptive Unified Reconnaissance & Exploration Lens. A short, speakable name for a personal spatial intelligence console. This is a creative identity, not a claim of trademark availability.

## Design contract

The globe remains the primary workspace. The redesign makes dense controls easier to read, introduces a consistent instrument-panel hierarchy, and preserves existing actions, map rendering, data feeds, provider configuration, storage keys and share-link formats. This is presentation work, not a new assistant backend.

Audience: the owner using a large-screen personal console, with usable phone access. Tone: precise, futuristic and restrained. Memorable detail: an original orbital lens mark paired with warm brass selection seams and ivory typography.

The palette draws from the porcelain, ochre/brass, burgundy and dark interiors in [Disney's official VisionQuest artwork](https://www.disneyplus.com/en-nz/explore/articles/marvel-visionquest). No Marvel artwork is shipped in the application.

## Iterations

[Exploration sheet](explorations.html) compares three static interface specimens, rendered in `evidence/explorations.jpg`:

- **Ivory Synth:** strongest light/dark separation, but bright panels compete with the globe.
- **Mindspace — selected:** graphite, ivory, brass and restrained burgundy. Warm chrome stays separate from cyan/geospatial data and the existing alert colors.
- **Signal Glass:** crisp teal/silver, but visually too close to the previous cyan identity.

The selected design was refined against the live app at 1440×900, 1280×720, 390×844 and 667×375. Iteration corrected the square logo proportions, welcome focus clipping, mobile layer-list overflow and old assistant/install branding.

## Iteration 02 — Lamplight

[Exploration sheet 02](explorations-02.html) records a judged design tournament run on 2026-11-07 over a palette sampled from Marvel Television's VisionQuest key art (oxblood and near-black interiors, the mustard-ochre armchair, porcelain-white Vision, petrol-teal wallpaper, amber honeycomb stained glass). Method: six directions, scored by four judging lenses; two finalists, three variants each, re-scored by the same lenses; a final synthesis.

- **Round 1:** Westview Mindspace (6.5), Parlor (5.75), HONEYCOMB (5.25), Porcelain Vigil (4.75), Westview Console and VISION TODAY Masthead (the judging pass returned no score for these two). Westview Mindspace won because it evolved the selected Mindspace instead of replacing it: its talk-vs-act idea (petrol tint behind information, graphite behind commands) and its brass restraint kept chrome apart from map data. Parlor advanced as the second finalist for its oxblood room, despite surfaces that read as one flat slab.
- **Round 2:** Westview Parlor (6.88), Parlor Quiet (6.75), Parlor Noir (6.25), Parlor Ledger (6.0), Westview Parlor (Quiet) (5.0), Westview Instrument (5.0). Westview Parlor won because it made petrol a real `--surface-info` token, reduced the accent to a single mustard seam, removed teal from all chrome text and held every text token above AA on every surface. The quieter variants lost their surface step over daylight imagery; Noir's oxblood slabs lost their edges over night space.
- **Synthesis:** the judges' fixes were applied to Westview Parlor: command glass tinted toward oxblood so the split reads as carpet against wallpaper, a deeper petrol info surface (info/glass 1.19, was 1.10), a calmer brass `#d6ab55`, menus moved to the top of the ladder, and the `attr(data-text)` title echo deleted so only a static 1px scanline remains. From **Parlor Noir** it grafts the measured L* surface ladder and the three-state rule (focus, selection and hover never share a colour). From **Westview Instrument** it grafts the dense telemetry grid (24px tabular-nums rows) and the mobile-sheet spec (petrol sheet, brass-dim grab handle, 44px dock targets, safe-area padding).

The result is "the parlor with one lamp lit": the globe is the only bright thing, command surfaces are warm oxblood lacquer, information surfaces are petrol wallpaper, and the only thing that glows is whatever you can press.

## Implementation

The Lamplight theme lives in `src/ui/styles/lamplight.css`, scoped to `:root:not([data-ui-theme='cyber'])` and imported before Cyber, preserving the specialized theme's priority; `aurel.css` now keeps only the workspace sheet imports. Base sheets consume the tokens as `var(--name, <previous value>)`, so Cyber keeps its old fallbacks unchanged. Core tokens use Manrope for interface copy and JetBrains Mono for telemetry. Main colors:

| Role | Color |
| --- | --- |
| Canvas background | `#141011` |
| Command glass (dock, rails, headers, dialogs) | `rgba(34, 21, 19, 0.94)` ≈ `#211513` |
| Information surface (lists, inspector, workspaces, telemetry) | `rgba(20, 44, 50, 0.94)` ≈ `#142a30` |
| Raised (cards, inputs, chips) | `#2f2a2a` |
| Menu (popovers, selects) | `#3a3435` |
| Primary text | `#f2ebdd` |
| Secondary text | `#c7c1b5` |
| Muted text | `#a7a39b` |
| Active control (brass) | `#d6ab55` |
| Focus ring and scroll thumb (petrol teal) | `#6fa7b1` |
| Oxblood (shadow and undertone only) | `#5a2016` |

Computed contrast ratios on command glass / information surface: primary text 14.99 / 12.61, secondary 9.92 / 8.35, muted 7.07 / 5.95 (4.85 on menu, so captions inside menus and cards use secondary text), brass 8.31 / 6.99, ink `#141011` on brass primary buttons 8.83, danger 6.69, warning 7.01, success 8.86 (on glass). These are token checks, not a claim that every legacy component has undergone a complete WCAG audit.

The first-run choices have larger targets and clearer descriptions. Panel headers, rails, input fields, presets, chat, provider setup and language menus share the new visual treatment. The mobile layer list is constrained within its panel so it cannot paint underneath Utilities/Authoring. Short landscape screens retain a scrollable mission list and reachable footer. Existing keyboard focus indicators remain, with an inset welcome-choice outline that stays visible inside the scroller.

Branding includes original SVG marks, favicon, generated installation icons, document and manifest titles, assistant labels, and localized copy in all 11 supported languages. To regenerate raster icons, run `node scripts/generate-icons.mjs`. Upstream authorship, licensing and repository metadata are retained.

## Verification

Browser checks covered startup, welcome dismissal, landscape mission scrolling, desktop panel disclosure, location/preset trays, mobile Layers/Search switching, assistant empty state and provider setup. No keys were edited or submitted; no paid assistant call was made. Existing camera feed availability varies upstream and is shown honestly. The working map session was restored after the review.

See `evidence/report.json` for screenshots and scoped observations. The report distinguishes unchanged permission workflows from tested UI states. Build and test results are recorded in `evidence/validation.txt`.

Lamplight's verification is recorded separately from the iteration 01 evidence above.
