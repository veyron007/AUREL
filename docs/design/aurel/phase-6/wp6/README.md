# WP6: Agent Field Kit

**Branch:** `claude/wp6-agent-field-kit-a183db`, from `main` at `45efecdc` (merged
`main` at `ef0eae9f` for the unit-test runner fix).
**Plan:** [IMPLEMENTATION-PLAN-02.md §3.1.6 and §6 WP6](../../IMPLEMENTATION-PLAN-02.md).

The local MCP server, read-only plus `show_in_gods_eye_view` before this
package, now has tools that act like an analyst. Every result carries a
provenance envelope, and every write needs the owner's per-session
**Allow agent writes** toggle.

## Behaviour

### Provenance envelopes

`src/fieldkit/envelope.js` defines schema `aurel.envelope/1`:

| Field             | Meaning                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| `class`           | `observed`, `modelled`, `derived`, `simulated` or `note`                                          |
| `sources[]`       | `id`, `label`, `licence`, `url` (or null)                                                         |
| `applicable_time` | `{ from, to }` read from the times the tool returned, or `null`; the note then says it is unknown |
| `retrieved_at`    | The tool's own `retrieved_at` when it states one, otherwise the answer time                       |
| `units`, `note`   | Units where recorded; caveats, such as SGP4 propagation or simulated traffic                      |

`envelopeInterceptor()` stamps every read tool's result from
`READ_TOOL_PROVENANCE` (one entry per MCP read tool; a test fails if a tool
offered on MCP has none). `structuredContent` stays exactly the tool's data;
the envelope is a last text block (`Provenance envelope: {...}`) and
`_meta["aurel/envelope"]`. An unlisted tool is `derived` with "provenance not
recorded", never a guessed observation. App-only (`panel_request`) and nested
calls are not stamped.

### Tools

| Tool                   | Writes                  | What it does                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_free_budget`      | no                      | Reads the three Free-only ledgers in `.gev-cache` (Planner field context 10/min, 100/day, 2000/month; Chronicle imagery history, same limits; Research NDVI 4/min, 48/day, 500/month) and reports estimated remaining units per period, plus the providers Free-only pauses. Always says "estimated" and "not a guarantee of free dispatch". An unreadable ledger is reported as unreadable. |
| `fieldbook_add_place`  | yes                     | Saves a point; starts a project when `project_id` is omitted; optional evidence citations become evidence rows on the place.                                                                                                                                                                                                                                                                 |
| `fieldbook_add_note`   | yes                     | Saves plain text about a project, place, route or drawing; citations become evidence rows on the subject and are listed under the note text.                                                                                                                                                                                                                                                 |
| `draw_area`            | yes                     | Saves a polygon or bbox as a drawing. It must be simple (no crossing edges), have area, be in range and fit in 2° × 2°.                                                                                                                                                                                                                                                                      |
| `run_mission_template` | yes, not with `dry_run` | F08 procedures `sunrise_shoot`, `explore_neighborhood`, `plan_half_day_outing`, `watch_my_region`: steps as tool calls with arguments, and the places and a checklist note saved in one write. Never calls a provider. Steps whose tool is not offered (today `horizon_at`) are marked "not offered by this server yet".                                                                     |
| `register_watch`       | yes                     | A NASA FIRMS fire watch on a saved place, saved **stopped**; monitoring starts only when the owner presses Start. Other kinds (`cloud_cover`, `rainfall`, `air_quality`) are refused as `unsupported`.                                                                                                                                                                                       |
| `render_view`          | no                      | A PNG of the globe in the owner's tab (fresh frame only) with a legend under it: one row per visible layer, its class and last refresh time ("time unknown" when none), plus the base map. The legend is also returned as data with the footnote that times are refresh times, not observation times.                                                                                        |

Annotations: writes are `readOnlyHint: false`, `destructiveHint: false`,
`idempotentHint: false`, `openWorldHint: false`; `render_view` and
`get_free_budget` are read-only and closed-world. There is no delete tool.

### How a write reaches the Fieldbook

The Fieldbook and Watchlists live in the tab's IndexedDB and the toggle in
the tab's session, so the MCP process cannot write them. `server/agentDesk/`
adds a relay on the dev and preview servers at `/api/agent-desk`:

1. The MCP tool validates its arguments (closed schemas) and POSTs
   `{ op, args, client }` to `/requests`.
2. The open AUREL tab long-polls `/next`, runs the request through
   `src/fieldkit/executor.js`, and POSTs the answer to `/results`.
3. The executor validates the arguments again, refuses every write while the
   toggle is off, checks `expected_revision` against the stored project, and
   saves through the existing Fieldbook repository, whose IndexedDB
   transaction compares the revision again. A conflict at either point is
   `revision_conflict` with `latest_revision`.
4. The Fieldbook controller refreshes Library (`syncExternalWrite`) without
   touching an owner's unsaved draft; the owner's own next save then reports
   the conflict as before.

Relay rules: local requests only (the `/mcp` checks: loopback address and
Host, no proxy headers, sharing off); submissions must carry no `Origin`, so
no page, AUREL's own included, can submit as an agent; polls and answers must
come from the app's page; only the tab that took a request can answer it;
requests time out (20 s, 30 s for `render_view`) as `timeout`; nothing is
persisted. `panel_request` refuses `/api/agent-desk`, and an embedded app
(`?embed=1`, the MCP Apps panel) never answers.

### The toggle

**Allow agent writes** sits in the workspace tools under Pause feeds (every
destination). Off by default; kept in `sessionStorage` (`aurel.agent-writes.v1`
= `on`), so it survives a reload of that tab and is off in any new browser
session. It shows whether the agent desk is connected and the last five
requests with their outcome and refusal code.

### Author tags and untrusted text

The Fieldbook schema is unchanged. Agent entries (projects, places, notes,
evidence, drawings, watches) get IDs `agent.<client>.<uuid>`; `<client>` is
the MCP client's `clientInfo.name` reduced to `[a-z0-9-]` (Claude Code reports
`claude-code`). Library shows "by agent · claude-code · <local time>" under
each agent entry, and "cited by agent" on agent evidence. A forged tag in an
imported backup only makes content look less trusted. Agent text is stored
verbatim, rendered with text interpolation (never `v-html`) and never parsed
as a command; a test stores JSON command shapes, slash commands and HTML and
checks nothing else changes.

### Typed refusals

Write failures answer `isError: true`, `structuredContent.error: "refused"`
and `structuredContent.details.refusal` = `{ code, message, details }`:
`writes_disabled`, `no_app_session`, `revision_conflict`, `invalid_geometry`,
`not_found`, `limit_reached`, `unsupported`, `storage_unavailable`,
`invalid_request`, `timeout`. Unknown fields are refused by the MCP schema
(`invalid_arguments`) and again in the tab (`invalid_request`).

### `horizon_at` seam

`FIELD_KIT_SLOTS` in `src/fieldkit/slots.js` (re-exported by `src/fieldkit/tools.js`) records the WP1 slot.
`createLocalMcpServer({ horizonAt })` → `localMcpTools({ horizonAt })` →
`createFieldKitTools({ horizonAt })` accepts WP1's tool definition (it must be
named `horizon_at`). Nothing implements it here.

## Files

New: `src/fieldkit/{envelope,author,refusals,schemas,geometry,fieldbookWrites,missionTemplates,legend,budget,executor,slots,tools}.js`,
`server/agentDesk/{relay,plugin,client,freeBudget}.js`,
`src/app/agentDeskTools.js`, `src/ui/{agentDeskController,agentDeskCapture}.js`,
`src/ui/stores/agentDesk.js`, `src/ui/views/panels/AgentWritesToggle.vue`,
`src/testSupport/fieldKitFakes.mjs`, `scripts/qa-aurel-field-kit.mjs`, tests
beside each module.

Registration seams changed: `src/tools/catalog.js` (`refused` error code and
`details`), `src/tools/mcp/protocol.js` (envelope block, `_meta`, error
`details`, `onInitialize`), `server/mcp/{server,services}.js`,
`server/standalone/vite.config.js` (plugin), `src/app/tools.js` (composition),
`src/tools/queries/panelRequest.js` (refused path),
`src/ui/fieldbookController.js` (`syncExternalWrite`),
`src/ui/views/{WorkspaceView,panels/FieldbookPanel}.vue`,
`src/ui/styles/fieldbook.css` (author tag), 11 locale catalogs (12 strings),
`scripts/i18n.mjs` (`src/fieldkit` is agent-facing text, like `src/tools`),
`scripts/package-boundaries.json`, `scripts/format-scope.json`,
`src/tools/localServer.test.mjs`, `docs/MCP_SETUP.md`, `docs/TOOLS.md`.
No theme file and no `.env` was touched.

## Demo: "Prepare a Fieldbook for a Mussoorie sunrise shoot on Sunday"

Run by `scripts/qa-aurel-field-kit.mjs` through the real stdio transport
(`server/mcp/stdio.js`, `clientInfo.name = "claude-code"`) against
`npm run dev` on port 4194, with a fresh browser profile and every non-local
request blocked. Transcript: [evidence/field-kit-checks.json](evidence/field-kit-checks.json).

Writes off:

1. `get_free_budget`: "Estimated remaining free units — field-context: about
   100 upstream requests left today (estimated); … Not a guarantee of free
   dispatch."
2. `fieldbook_add_place`, `run_mission_template`, `fieldbook_add_note`,
   `draw_area`, `register_watch`: each "Refused (writes_disabled): Agent
   writes are off…". Nothing written.
3. `run_mission_template` with `dry_run`: the six-step plan, nothing written.

Writes on (the toggle clicked in the tab):

4. `run_mission_template` `sunrise_shoot` for Lal Tibba on Sunday 2026-11-08
   (Asia/Kolkata): project "Mussoorie sunrise shoot, 2026-11-08", revision 1,
   "by agent · claude-code".
5. `fieldbook_add_place` Gun Hill (revision 2); `fieldbook_add_note` citing
   the `get_free_budget` envelope (revision 3); `draw_area` Lal Tibba
   viewpoint (revision 4).
6. `draw_area` with revision 3: `revision_conflict` ("at revision 4, not 3").
7. `register_watch` `cloud_cover`: `unsupported`; `fires`: saved, stopped.
8. A self-crossing area: `invalid_geometry`.
9. `render_view`: a 960×678 PNG with its legend
   ([evidence/render-view.png](evidence/render-view.png)).
10. Library lists the project and its entries as "by agent · claude-code ·
    time" ([evidence/library-desktop.png](evidence/library-desktop.png)).

`horizon_at` is not offered yet; the mission plan marks its step "not
offered by this server yet".

## Verification

Run on 7 November 2026 on the owner's machine while seven sibling sessions
ran their own suites (load average 32–46).

| Check                            | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New tests                        | 64 across `src/fieldkit/*.test.mjs` (47), `server/agentDesk/relay.test.mjs` (9), `src/ui/agentDeskController.test.mjs` (6), `src/ui/views/panels/agentWritesToggle.test.mjs` (2): all pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `npm test` (full, once)          | 11,490 tests: 11,479 passed, 7 failed, 4 skipped. One failure was this branch's (`src/tooling/viteBuild.test.mjs` pins the plugin order; updated for `aurel-agent-desk`, now 9/9). The other six are timing tests that passed when rerun alone: `nominatimLockOwnership` (2), `cctvPanel` scene summary, `radioPanel` RTL-SDR card, `toolProjectRoot` launcher (7.4 s against its 30 s limit), and `geoFileImport` "repeated incomplete KML roots" (passed once and failed once at its 5 s deadline under load). None touches Field Kit code. The full suite was not rerun. A final targeted run of the 208 tests in every file this branch touches passed except `tool-schema-codepoints` "huge arguments", a timing test that took 420 ms under load and passed at 41 ms on rerun (it also passed in the full run). |
| `npm run format:check`           | Fails on a clean checkout of `main` as well: `scripts/format-scope.json` lists `src/fieldbook/document.test.mjs` and `src/sources/firmsArea.test.mjs`, which exist only untracked in the main checkout and were never committed. Every file this branch changes or adds (51) passes `prettier --check`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `npm run check:boundaries`       | Passes after moving `FIELD_KIT_SLOTS` to `src/fieldkit/slots.js`, so the app does not import the MCP tool definitions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `npm run i18n`                   | 11 catalogs complete, 3,619 messages each.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `scripts/qa-aurel-field-kit.mjs` | 18/18 checks pass on `npm run dev` at port 4194; zero page errors; blocked hosts: `services.arcgisonline.com`, `terrain.reearth.land`, `tile.openstreetmap.org`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| MCP stdio smoke                  | The QA script drives `node server/mcp/stdio.js --api-base http://localhost:4194` (the `npm run mcp` entry) through initialize, `tools/list` and 16 tool calls. Separately, `npm run mcp -- --api-base http://localhost:4194` with no tab open: 37 tools listed, `get_free_budget` answered, `fieldbook_add_place` refused with `no_app_session`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Browser 1440×900                 | [toggle-off-desktop.png](evidence/toggle-off-desktop.png), [library-desktop.png](evidence/library-desktop.png): the toggle in the workspace tools and the Library entries tagged "by agent · claude-code · time". 390×844: [field-kit-mobile.png](evidence/field-kit-mobile.png), no horizontal overflow.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Free-only                        | No request left the machine in the QA run; the Field Kit adds no provider call. `get_free_budget` only reads ledgers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Configuration                    | `.env` was not read, printed or changed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## Limits

- The relay serves one AUREL server at a time; with several tabs open, the
  first tab polling takes a request and applies its own toggle.
- The MCP server over HTTP (`/mcp`) keeps one client name per server
  instance: the last client to initialize tags writes.
- `render_view` needs a visible tab with a fresh frame; a hidden tab answers
  `unsupported`. The legend's time is each layer's last refresh in AUREL,
  not the observation time of each feature. In the QA run no data layer was
  enabled (offline overview, external requests blocked), so the legend shows
  the base map only, "time unknown".
- Budget figures mirror the providers' default limits (a test reads the
  provider sources and fails on drift). They are estimates: other tabs,
  processes and upstream weighting (WP3's weighted units) can spend first.
- Author tags are labels from the client's self-reported name, not
  authentication; the relay is local transport safety, as `/mcp` is.
- At 390 px the toggle is at the end of the horizontally scrolling tool strip
  ([evidence/field-kit-mobile.png](evidence/field-kit-mobile.png)).
- Strings are in the 11 shipped catalogs; Hindi arrives with WP8 and these 12
  strings need `hi` translations at that merge.
- Port 4190 is on the Fetch standard's blocked-port list, so Node's fetch
  refuses it; the QA run used 4194 because 4173 was taken by another session.
