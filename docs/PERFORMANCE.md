# Performance baseline

This page records one hardware-rendered Apple M5 comparison captured on 22
August 2026 in Chrome 150 at 1440 x 900. It is not a minimum hardware
specification and should not be used to predict performance on untested systems.
The original capture artifacts are not included here, so this page records
results rather than defining a runnable benchmark.

## Test context

The baseline was captured on 22 August 2026 with these conditions:

| Setting | Value |
| --- | --- |
| Renderer | Apple M5 Metal through the hardware ANGLE path |
| Browser | Chrome 150 in a fresh isolated profile |
| Viewport | 1440 x 900 at device pixel ratio 1 |
| Focus | Page foregrounded for controlled scenes |
| Scene sample | 5 seconds of scripted motion, then 5 seconds at rest |
| Startup | Browser cache disabled; three samples |

The capture covered three startup samples, 16 cold layer scenarios with 14
measurements, 23 controlled option and stress scenes, and five
hardware-rendered overlay scenes.

## Startup

| Sample | App ready | Initial settle | Load event | Motion / rest | Used JS heap |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 784.980 ms | 2,035.082 ms | 439.5 ms | 60 / 60 FPS | 102.9 MiB |
| 2 | 604.849 ms | 1,855.836 ms | 442.4 ms | 60 / 60 FPS | 111.6 MiB |
| 3 | 558.527 ms | 1,809.592 ms | 438.8 ms | 60 / 60 FPS | 105.1 MiB |
| Median | 604.849 ms | 1,855.836 ms | 439.5 ms | 60 / 60 FPS | 105.1 MiB |

The initial-settle measurement is the more useful launch reference because it
includes the first visual and data settling window. All three samples reached
the display ceiling during both motion and rest.

## Cold layer activation

Cold activation was measured separately from warm option switching. Live object
counts are included so that future runs can compare source populations before
attributing a difference to the client.

| Layer | Activation | Source count | Motion / rest | Used JS heap |
| --- | ---: | ---: | ---: | ---: |
| CCTV city | 19,608.240 ms | 48 | 60 / 60 FPS | 192.7 MiB |
| Space Missions (report label: Rocket missions) | 3,581.066 ms | 26 | 60 / 60 FPS | 131.3 MiB |
| Radio | 3,458.709 ms | 750 | 60 / 60 FPS | 124.8 MiB |
| Bikeshare | 2,069.498 ms | 633 | 60 / 60 FPS | 157.4 MiB |
| Datacenters | 817.693 ms | 4,362 | 59.6 / 60 FPS | 328.2 MiB |
| Flights | 667.671 ms | 247 | 60 / 60 FPS | 118.4 MiB |
| Submarine cables | 614.727 ms | 2,629 | 60 / 60 FPS | 412.0 MiB |
| Military Flights | 557.113 ms | 68 | 60 / 60 FPS | 118.4 MiB |

CCTV had the largest cold activation cost in this capture. Submarine cables
used the most heap, followed by datacenters. Completed single-layer samples
generally reached 60 FPS, so activation time and heap separate these cases more
clearly than steady-state frame rate.

## Aircraft, detection, and Cockpit

| Scene | Motion / rest |
| --- | ---: |
| Idle globe | 60 / 60 FPS |
| Flights, 2D | 60 / 60 FPS |
| Flights, 3D proximity | 60 / 60 FPS |
| Flights, all 3D models | 60 / 60 FPS |
| Military Flights, all 3D models | 60 / 60 FPS |
| Detection at 25% | 39.3 / 41.1 FPS |
| Detection at 50% | 37.4 / 39.8 FPS |
| Detection at 100% | 34.4 / 35.5 FPS |
| Cockpit | 49.6 / 49.2 FPS |

The clean detection scenes processed 8,169 to 8,170 observations. Selected
labels rose from 14 at 25% density to 28 at 50% and 56 at 100%. The aircraft
rows came from an earlier loaded, foreground-controlled pass because the clean
rerun received no live aircraft rows.

## Visual styles and combined stress

| Scene | Motion / rest |
| --- | ---: |
| Normal | 60 / 60 FPS |
| CRT (report label: Retro) | 60 / 60 FPS |
| NVG (report label: Surveillance) | 60 / 60 FPS |
| FLIR (report label: Thermal) | 49 / 60 FPS |
| Anime | 60 / 59.8 FPS |
| Noir | 47 / 56.6 FPS |
| Snow | 42.3 / 45.8 FPS |
| Combined static | 57.6 / 60 FPS |
| Combined operational | 39.9 / 43.1 FPS |

The combined static scene rendered 11,575 objects, used 872.2 MiB of JavaScript
heap, and issued 48,665 text draws during motion and 54,106 at rest. The combined
operational sample contained 3,909 observations and two selected labels, but its
live aircraft and traffic rows were empty, so it remains a limited stress case.

Snow, Noir, dense detection, and text-heavy combined layers are the clearest
controlled comparison points for later optimization work. Snow has since been
retired as a visual preset; its row records the measurement as taken.

## Keyed live sources

NASA FIRMS, AISStream, and TomTom were captured in a separate hardware-rendered
pass. The page was visible but was not the focused window, so these frame rates
must not be compared directly with the foreground-controlled scenes above.

| Source | Point-in-time population | Activation or coverage | Motion / rest |
| --- | ---: | --- | ---: |
| NASA FIRMS | 100,430 detections in 3,557 cells | 30.0 s activation | 32.1 / 55.2 FPS |
| AISStream | 12,000 vessels | 6.4 s activation | 22.1 / 29.8 FPS |
| TomTom Traffic | 4,222 road dots | 70% coverage, 2 decoded tiles | 45.0 / 51.7 FPS |

These populations change continuously. A future comparison must record the
live counts again and match the focus conditions.

## Controls for a future capture

Use the same controls before attributing a difference to the application:

1. Record the exact GPU renderer and reject software-rendered or unavailable GPU
   strings.
2. Use a 1440 x 900 viewport at device pixel ratio 1 and keep the page focused.
3. Measure cache-disabled startup separately from cold layer activation and warm
   option switching.
4. Repeat startup three times and compare medians.
5. Sample each option for 5 seconds in scripted motion and 5 seconds at rest.
6. Record live object counts before attributing a difference to the client.
7. Treat a live-source outage as missing coverage, not as evidence of low client
   rendering cost.
8. Record whether the app is running in Pinokio's embedded view or in an
   external browser. One Pinokio 8.2.0 user reported severe stutter in the
   embedded view that went away when the same local URL was opened in a normal
   browser ([#365](https://github.com/bilawalsidhu/gods-eye-view/issues/365)).
   Do not compare embedded-view and external-browser measurements directly;
   compare the reported GPU renderer and matched scene settings first.

## Running the probe and gates

`npm run perf:probe -- --base http://localhost:4181` applies controls 1 to 4
to every scene in `scripts/perf-scenes.json` against a running app (for example
`npx vite preview --port 4181`). It prints one JSON line per scene with the
medians of three runs, then Markdown tables, including the gaps between the
startup marks named in `src/app/startupMarks.js`. Options: `--scenes`, `--runs`,
`--throttle 50mbps`, `--cpu-slowdown N`, `--dpr N` and `--allow-software`.
The JSON line also carries `motionP95FrameMs` (95th-percentile interval between
motion frames) and `motionTaskMsPerFrame` (main-thread task time per motion
frame), which still separate scenes when both reach the 60 FPS cap. A scene may
name a `setup` run once the app is ready (`annotations-10` places ten pins).

`npm run check:bundle`, after `npm run build`, fails when the entry chunk, its
static imports or the entry CSS exceed `scripts/bundle-budget.json`.
`npm run test:perf` runs the `*.perf.test.mjs` timing budgets.

## 10 November 2026: after the performance plan

These rows come from `npm run perf:probe` (three runs, medians) on an Apple M4 through the hardware Metal path, 1440 x 900 at device pixel ratio 1, cache disabled, against the served build (`npm run serve`). They are a different machine and different scenes from the August capture above, so compare them only with later runs of the same probe. The full plan and its scoreboard are in [docs/design/aurel/PERFORMANCE-PLAN.md](design/aurel/PERFORMANCE-PLAN.md), section 8.

| Scene | Ready | Requests | Transfer | Heap | Long tasks (worst) | Rest / motion FPS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Empty globe over Dehradun | 4.7 s | 292 | 10.8 MB | 67 MB | 0.3 s (125 ms) | 0 / 60 |
| Same, 50 Mbps link | 5.2 s | 292 | 10.8 MB | 66 MB | 0.5 s (168 ms) | 0 / 60 |
| Flights, earthquakes, satellites | 4.5 s | 338 | 11.3 MB | 92 MB | 0.3 s (122 ms) | 60 / 60 |
| Cables, datacenters, fires (world view) | 2.9 s | 212 | 11.0 MB | 122 MB | 1.1 s (223 ms) | 0 / 57 |

The same three scenes on 8 November, before the plan, measured 5.9 s / 6.5 s / 6.6 s ready, 78 / 163 / 488 MB heap and 60 / 60 / 45 FPS in motion. A rest rate of 0 means the render governor drew nothing while nothing changed. About 7 MB of each transfer is remote terrain and imagery.

## What is not established yet

- This report does not establish Windows performance.
- The report does not record machine memory capacity, so it cannot support a
  minimum-memory recommendation.
- The report does not cover other GPU renderers or viewport configurations.
- Military Installations is outside this comparison because it requires close
  camera context.
- The keyed pass has no controlled rerun suitable for comparison with the
  option scenes.

Use this page as a regression baseline for one known hardware and browser
configuration, not as a compatibility guarantee.
