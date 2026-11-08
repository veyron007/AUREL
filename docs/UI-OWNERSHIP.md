# Application UI ownership

`src/ui/applicationShell.js` constructs controls, connects their explicit inputs
and coordinates shutdown. `shellFacade.js` preserves the methods used by layers,
scene playback and voice. It delegates; new behavior belongs with its owner.

| Owner                                                                                                 | Responsibility                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `navigationController.js`                                                                             | Navigation generation, tracking release and camera authority                                                                                          |
| `locationNavigation.js`                                                                               | Destination lookup/selection, orbit, world jumps and globe-reset completion                                                                           |
| `cockpitCoordinator.js`                                                                               | Cockpit entry/rollback, readouts and the single Display portal                                                                                        |
| `visualSettings.js`                                                                                   | Effects, detection overrides, visual restoration and render-loop lifetime                                                                             |
| `panelChrome.js`                                                                                      | Disclosure, docking, layout and Cockpit panel restoration                                                                                             |
| `panelNavigation.js`                                                                                  | Desktop panel rails: each side's offered panels and the open one                                                                                      |
| `stores/workspace.js` + `views/WorkspaceView.vue`                                                     | AUREL task destinations, appearance preference and inspector size; actions delegate to PanelNavigation and existing panel owners                      |
| `personalWorkspace.js` + `app/personalTools.js`                                                       | Compose Lens and Fieldbook through named existing selection, search, navigation and capture owners; application lifetime owns teardown                |
| `chromeRest.js` (started by `views/WorkspaceView.vue`)                                                | Spatial chrome rest: `body.chrome-resting` after a quiet spell; open panels, trays, dialogs, focused fields, the palette and live voice hold it awake |
| `commandPalette.js` + `app/paletteTools.js` + `stores/palette.js` + `views/panels/CommandPalette.vue` | Command palette list and keys; rows run LocationControls, the data manager toggle, workspace destinations, globe reset and the voice presenter        |
| `lensController.js` + `stores/lens.js` + `views/panels/LensPanel.vue`                                 | Place selection, source evidence and notes; consumes owner publications without provider requests                                                     |
| `fieldbookController.js` + `stores/fieldbook.js` + `views/panels/FieldbookPanel.vue`                  | Local project edits, draft recovery and explicit backup previews; IndexedDB repository owns atomic revision checks                                    |
| `aircraftDisplay.js`                                                                                  | Shared commercial/military 3D display preferences and controls                                                                                        |
| `layerBindings.js`                                                                                    | Data-manager attachment, selected-tracker adoption and camera-entry listeners                                                                         |
| `displayBindings.js`                                                                                  | Keyboard/display subscriptions and frame-rate monitor lifetime                                                                                        |
| `shareRestoration.js`                                                                                 | Initial share/layer restoration and cancellation                                                                                                      |
| `shellFeedback.js`                                                                                    | Loading feedback, notices and toast lifetime                                                                                                          |

Owners that present UI do so through Vue: they publish plain view objects to a
Pinia store in `src/ui/stores/`, views in `src/ui/views/` render them, and user
actions return through the handlers the owner connects to that store. See
[Building UI](../CONTRIBUTING.md#building-ui).

Owners receive named services, elements, operations and readers. They do not
receive the application shell itself. Readers resolve a replaceable collaborator
at use time; operations cross an ownership boundary without copying its state.
The facade exposes existing properties as delegates rather than duplicate state.

Shutdown has two phases. First revoke input, deferred navigation, camera-entry
listeners, lookups, timers and rendering work. Then await Context restoration,
release sensor overrides while the manager is still attached, detach layer
services and destroy scene resources. Late callbacks cannot acquire the camera.
Manager replacement also releases subscriptions and the previous Directions
module even if the replacement does not provide a Directions layer.

Source-contract tests follow both sides of delegated wiring. Lifecycle tests
exercise pending reset cancellation, stale camera callbacks, replacement and
idempotent teardown. Browser acceptance covers the composed application, including
share restoration, scene commands, navigation, Cockpit, display and voice.
