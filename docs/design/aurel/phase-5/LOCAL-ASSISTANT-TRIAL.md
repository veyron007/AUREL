# Phase 5: deterministic commands and optional local-model trial

The default is an explicit typed command grammar and existing structured evidence summaries. No model is required to operate the app. The optional model trial is **not adopted**: the tested configuration did not meet the quality threshold, and no runtime was added to app startup or configured as a fallback provider.

## Shipped pure command contract

`src/localAssistant/commands.js` exports `parseLocalCommand(text, context)` and `validateLocalCommand(command, context)`. Parsing never executes an action, accesses a model, reads saved keys, or performs a network request. A result has `{status, command, reason, notice}`. A ready command has only `{type, args}`; other outcomes retain a reason code for the UI.

| Typed example               | Owner action                                 | Required current context                            |
| --------------------------- | -------------------------------------------- | --------------------------------------------------- |
| `go to 30.3258, 78.0438`    | Existing `fly_to_location` coordinate action | Valid latitude/longitude                            |
| `find Dehradun, India`      | Place search with explicit result selection  | Never choose an ambiguous first match automatically |
| `open planner`              | Open `planner-panel`                         | Existing panel owner                                |
| `show earthquakes`          | Existing `set_layer_visibility`              | Existing owner and free-provider admission          |
| `save project`              | Fieldbook save                               | Active project                                      |
| `save place` / `save route` | Existing capture/save owner                  | Selected place/current route                        |
| `compare selected dates`    | Existing Chronicle compare                   | Current admitted pair ready for comparison          |
| `brief selected evidence`   | Existing structured briefing                 | Ready or explicitly stale evidence                  |

The free layer subset is `earthquakes`, `satellites`, `local-firms`, and `weather-radar`. Panel IDs are `lens-panel`, `chronicle-panel`, `planner-panel`, `fieldbook-panel`, `research-panel`, and `data-panel`. These lists do not expand when a model supplies a new name. Coordinate and layer arguments reuse the canonical voice action schemas, with additional local-command restrictions.

The root adapter must derive context from current owners, revalidate immediately before dispatch, await completion, and report the owner's actual result. Parser success is not execution success. Imported notes/provider text are never a command source. Arbitrary URLs, shell/code expressions, chained instructions, paid-provider requests and attempts to override instructions cannot produce executable commands. Missing data never becomes a fabricated summary or safety claim. English grammar supports Unicode place names; multilingual command understanding and speech recognition are not advertised.

## Trial environment and provenance

On 2026-11-07 the machine reported Apple M4, 10 physical cores and 17,179,869,184 bytes of unified memory. Existing `llama-cli`/`llama-server` reported llama.cpp 0.6.0, build 11429, commit `d81235049`. No runtime installation or user configuration change was needed. The runtime is MIT licensed. [Official llama.cpp repository](https://github.com/ggml-org/llama.cpp).

The official Qwen3-0.6B Q8_0 GGUF was downloaded at pinned revision `23749fefcc72300e3a2ad315e1317431b06b590a`. Its Apache-2.0 license is separate from the runtime license. The 639,446,688-byte download took 61.95 seconds and matched official LFS SHA-256 `9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031`. The file remains in git-ignored `.gev-cache/local-assistant/`; no model weights were added to source control. [Official Qwen model card and files](https://huggingface.co/Qwen/Qwen3-0.6B-GGUF).

Each test used a fresh process, 2,048 context tokens, at most 128 output tokens, four threads, temperature zero, seed 42, `--offline`, disabled Jinja, built-in ChatML, disabled thinking, and a 45-second process deadline. Synthetic inputs contained no user documents, keys or live provider evidence. Every proposal was graded against a fixed expected action and the independent allowlist; no proposed action was executed.

## Observed result and decision

| Measure                | Initial instruction prompt | Revised few-shot prompt |
| ---------------------- | -------------------------- | ----------------------- |
| Correct exact intents  | 1/8                        | 6/8                     |
| Schema-valid proposals | 8/8                        | 8/8                     |
| App actions executed   | 0                          | 0                       |

The first prompt blocked every request. With examples, the model handled place search, opening Research, a missing route, injected instructions, a free layer and missing evidence. It omitted the expected overview mode for coordinates and classified a route-safety question as missing input instead of unsupported. Valid JSON alone is insufficient quality assurance.

The revised runs took 0.964–3.939 seconds each and peaked at 1,066,450,944 bytes RSS. Later processes benefited from a warm filesystem cache. The preliminary first load took 4.65 seconds. These are small synthetic-task measurements, not general throughput or a guarantee under live rendering.

Across the two eight-case runs, 145 socket observations saw only transient `127.0.0.1` listeners/connections owned by the CLI. This installed CLI uses an internal loopback service even in offline mode. No external endpoint was observed. Polling is not packet capture and can miss short-lived connections; do not describe this as a proof of zero network activity. All trial processes and their listeners were gone after evaluation.

The model fails the adoption gate. Keep deterministic commands and evidence templates as the product behavior. Concurrent Cesium rendering has not been benchmarked; that remains required before any future adoption, together with a broader ambiguity, missing/stale-evidence and injection corpus. Do not silently switch to a paid API or download a larger model after a failure.

## Reproducible evidence

- `local-model-trial-results.json`: sanitized per-case outputs, correctness, latency, memory and socket-observation counts.
- `local-model-trial-prompts.json`: exact two system prompts, proposal schema and CLI flags.
- `src/localAssistant/evaluation.js`: synthetic case inputs and expected outputs.
- `src/localAssistant/proposalEvaluation.js`: independent proposal validation and grading; a passing score does not authorize execution.

Eight grouped parser/evaluation tests cover invalid coordinates, ambiguous and Unicode places, current-state prerequisites, stale evidence, prohibited providers, imported text, injection strings, immutable outputs and invalid model proposals. Scoped coverage measured 100% lines and 95.83% branches before app integration. The app-level adapter and rendered UI are verified separately by their owners.
