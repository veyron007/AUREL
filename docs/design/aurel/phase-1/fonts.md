# Local typography

AUREL's standalone entry loads its font faces from `src/ui/styles/fonts.css`,
which `style.css` imports first, and preloads the Latin Plus Jakarta Sans and
JetBrains Mono files. Its text and icon faces are bundled in `public/fonts`; opening the application no longer asks Google
Fonts for stylesheets or font binaries. The local server still needs to be
running. This does not turn remotely supplied map or data content into offline
content.

The existing family names, weight ranges and icon ligatures are preserved:

| Family                    | Bundled weights                    | License                   |
| ------------------------- | ---------------------------------- | ------------------------- |
| Manrope                   | 400–700, variable                  | SIL Open Font License 1.1 |
| Inter                     | 300–600, variable                  | SIL Open Font License 1.1 |
| JetBrains Mono            | 300–700, variable                  | SIL Open Font License 1.1 |
| Noto Sans Arabic          | 400–700, variable                  | SIL Open Font License 1.1 |
| Material Symbols Outlined | 400, optical size 20, fill/grade 0 | Apache License 2.0        |

Unmodified distributions were obtained from Google's official Fonts CSS API
and `fonts.gstatic.com` on 6 November 2026. Text fonts retain Google's Unicode
subsets, including the supplied Cyrillic, Greek, Vietnamese and Arabic subsets.
The browser fetches only the faces/ranges a page uses. East Asian scripts retain
the operating-system fallbacks used by the application; this change does not
claim to bundle every script.

There are 25 WOFF2 files, totaling 639,596 bytes. That is the total installed
asset size, not the bytes required for an English first paint. Text faces use
`font-display: swap`. Icons use `block` to avoid briefly displaying ligature
names in place of glyphs.

## Provenance and maintenance

`public/fonts/manifest.json` records each binary's original official URL,
SHA-256 digest and size, plus the Material Symbols glyph inventory and original
CSS request. License notices are retained in `public/fonts/licenses/`.

Text-font license sources:

- <https://raw.githubusercontent.com/google/fonts/main/ofl/manrope/OFL.txt>
- <https://raw.githubusercontent.com/google/fonts/main/ofl/inter/OFL.txt>
- <https://raw.githubusercontent.com/google/fonts/main/ofl/jetbrainsmono/OFL.txt>
- <https://raw.githubusercontent.com/google/fonts/main/ofl/notosansarabic/OFL.txt>

Icon license source:
<https://raw.githubusercontent.com/google/material-design-icons/master/LICENSE>

The text CSS request used was:

```text
https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300..700&family=Inter:wght@300..600&family=Manrope:wght@400..700&family=Noto+Sans+Arabic:wght@400..700&display=swap
```

Use a modern Chrome user agent when refreshing the CSS so Google returns WOFF2
variable faces and Unicode ranges. Download every referenced face, retain its
Unicode range and weight descriptors, and rewrite the URLs to local filenames.
Do not replace the local stylesheet with the remote request URL.

For new Material Symbols names, regenerate the subset using the sorted union
of `manifest.icons.glyphs` and the new names. Download the returned WOFF2 and
update its source URL, digest, size and inventory together. Updating only the
inventory does not add glyphs to the binary. The new workspace names included
here are `bookmarks`, `compare`, `explore` and `route`.

Run `node --test src/materialSymbolsSubset.test.mjs`. It checks all referenced
source glyphs against the inventory, verifies the icon binary digest/signature,
and confirms local font references, files and license notices. Browser QA should
also wait for `document.fonts.ready` with external requests blocked and inspect
actual glyph rendering.
