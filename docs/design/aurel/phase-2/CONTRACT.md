# Phase 2 — places worth keeping

Lens answers what is selected and which source details are actually known. Fieldbook keeps user-authored work in a local library. Both extend the chosen Observatory workspace, including its Field and Instrument appearances, instead of adding another navigation system.

## Interaction contract

- Explore opens Lens. A completed place search or explicit map selection updates the dossier. Feed refreshes never open panels or steal focus.
- Overview, Evidence and Notes share one selected place. Unknown image date, resolution, coverage and uncertainty remain unknown. Feed inventory counts are not local observation counts.
- Save place and Save note persist directly to Fieldbook. Success appears only after a local write. A failure keeps the draft and text.
- Library opens Fieldbook; scene authoring remains a labeled tool in Library and All tools.
- Backup import previews a validated copy before applying it. Existing projects are not overwritten. Local files are included as passive bytes; scene asset references remain references.
- Active work and one protected recovery draft survive refresh. A third unsaved draft cannot silently replace either. Concurrent browser tabs use atomic revision checks.
- Use existing workspace type, spacing, surfaces and focus indicators; preserve 44px controls and a scrollable phone inspector. All views remain mounted while changing destinations.
- No new accounts, paid capabilities, external fonts, provider requests or credentials are needed. Existing scene and share formats stay intact.

Browser evidence is captured from the actual offline application in an isolated profile. Fixture coordinates and notes are explicitly test content. This contract does not assert that the offline overview has street-level imagery, or that saved projects automatically download maps.
