# Browser hardening evidence

The isolated Chromium checks use a fresh browser profile and block all external HTTP requests and every local `/api/` route. No saved keys, user projects, live data, provider quota, or paid services are used. Coordinate parsing and two empty project fixtures exercise the existing application owners.

## Layout and keyboard checks

`node scripts/qa-aurel-hardening.mjs` checks Lens, Fieldbook, Field planner, Chronicle, Research, Watchlists, Offline region, and Local commands at 1440 × 900, 390 × 844, and 667 × 375.

The recorded run passed 73 checks: actual scrollport bounds, horizontal overflow, visible keyboard focus, reduced-motion styles within each panel, enabled bottom-control center and edge hit-testing, and no uncaught page errors. Phone controls measured at least 44 px high. Mobile scrolling belongs to the outer rail; testing the full child-panel height as though it were the scroll viewport would be incorrect.

Screenshot review found a 7 px portrait bottom-navigation overlap. The responsive-shell owner corrected the mobile tab-space calculation. The final layout run also asserts that the actual scrollport ends above the navigation and that the last enabled control is hit-testable at its center and near both vertical edges; all checks pass after the correction.

The Local Commands input now has an explicit 44 px minimum height. The final built CSS also bounds its desktop content inside the allocated rail height.

## Repeated-owner stress check

`node scripts/qa-aurel-hardening.mjs --stress-only` performs two warm-up cycles, then 50 coordinate selections and 50 saved-project switches. The measured time starts when the owner action runs and ends after its UI update plus two animation frames. It excludes external data loading and is **not an FPS measurement**. The run used a quiet browser/CPU window.

| Measure                             |            Observed result |
| ----------------------------------- | -------------------------: |
| Coordinate-selection p95            |                    52.8 ms |
| Saved-project-switch p95            |                    51.9 ms |
| DOM nodes before / after GC samples |              7,979 / 7,979 |
| DOM event listeners before / after  |                  898 / 898 |
| Documents before / after            |                      8 / 8 |
| Cesium data sources before / after  |                      3 / 3 |
| Imagery layers before / after       |                      1 / 1 |
| Scene primitives before / after     |                      1 / 1 |
| Canvas elements before / after      |                      8 / 8 |
| Retained JS heap change             |                  +1.52 MiB |
| Render governor after settling      | Idle, no continuous owners |

All six stress assertions passed. The test budgets allow at most 300 extra DOM nodes, 32 listeners, one document, no accumulated map resources or continuous-render owners, and control p95 below 250 ms. Heap growth is reported without a leak-free claim. Resource timing entries increased as expected for attempted source requests, all intercepted locally; this counter is history rather than a count of live resources.

## Existing performance benchmarks

`npm run test:perf` passed both existing benchmarks: 500 / 2,000 / 5,000 icon updates and the dense continental move-end pipeline. The full timing output is retained in `evidence/hardening-perf.txt`; the dense pipeline's warm CPU slice p95 was 0.965 ms. These are bounded workload benchmarks, not whole-globe rendering-rate claims.

## Artifacts and limits

Machine-readable results are in `evidence/hardening-layout.json` and `evidence/hardening-stress.json`; representative screenshots use the `hardening-` prefix. The harness always closes its own browser in `finally`.

This pass covers fixture-backed interaction and empty/local-source panel states. Populated scientific output, provider failures, saved-comparison restoration, and offline geography have separate functional QA. It is not a complete WCAG audit, screen-reader certification, live-service benchmark, or long-duration memory-leak proof.

The Planner functional harness was updated to reopen the deliberate “Edit plan and reanalyze” disclosure before switching from a completed place analysis to route analysis. This follows the visible user flow; no product logic changed. The rerun passed all 11 functional checks, including saved snapshot reopening without provider refresh.
