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

## Implementation

`src/ui/styles/aurel.css` supplies the visual layer and is imported before Cyber, preserving the existing specialized theme's priority. Core tokens use Manrope for interface copy and JetBrains Mono for telemetry. Main colors:

| Role | Color |
| --- | --- |
| Canvas background | `#101314` |
| Reading surface | `#1a1e1f` |
| Primary text | `#eee9df` |
| Secondary text | `#bbbdb6` |
| Muted text | `#979c96` |
| Active control | `#d7b778` |
| Burgundy accent | `#743d4b` |

Primary, secondary, muted and accent text have calculated contrast ratios of 13.89:1, 8.86:1, 6.01:1 and 8.75:1 respectively against the opaque reading surface. These are token checks, not a claim that every legacy component has undergone a complete WCAG audit.

The first-run choices have larger targets and clearer descriptions. Panel headers, rails, input fields, presets, chat, provider setup and language menus share the new visual treatment. The mobile layer list is constrained within its panel so it cannot paint underneath Utilities/Authoring. Short landscape screens retain a scrollable mission list and reachable footer. Existing keyboard focus indicators remain, with an inset welcome-choice outline that stays visible inside the scroller.

Branding includes original SVG marks, favicon, generated installation icons, document and manifest titles, assistant labels, and localized copy in all 11 supported languages. To regenerate raster icons, run `node scripts/generate-icons.mjs`. Upstream authorship, licensing and repository metadata are retained.

## Verification

Browser checks covered startup, welcome dismissal, landscape mission scrolling, desktop panel disclosure, location/preset trays, mobile Layers/Search switching, assistant empty state and provider setup. No keys were edited or submitted; no paid assistant call was made. Existing camera feed availability varies upstream and is shown honestly. The working map session was restored after the review.

See `evidence/report.json` for screenshots and scoped observations. The report distinguishes unchanged permission workflows from tested UI states. Build and test results are recorded in `evidence/validation.txt`.
