# Android background sync settings

Mode: Operate. Target: `components/background-sync-settings.tsx` and its rules in `app/globals.css`. Documented from note 0.2.10 on 2026-09-11.

## Direction contract

**THESIS:** Let the owner understand silent closed-app sync and resolve only restrictions actually present on this Android device.

**OWN-WORLD:** Inherit note's neutral dark settings, local Pretendard, restrained borders and existing scrolling settings container. Preserve the incumbent visual system.

**STORY:** Read scheduling and recent outcome, address an unmet setting with its explanation, and return to a refreshed status.

**FIRST VIEWPORT:** The background section contains a 15px heading, 13px explanatory text and outcome, then only relevant explanation/action pairs. A 12px closing note describes returning from settings and force stop. Existing connection and account controls remain below it.

**FORM:** Code-led refinement of existing settings; no new form selection or seed key applies. Bordered buttons have 48px minimum height, 8px corners and visible keyboard focus. Text wraps within the phone/tablet container.

**FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Behavior to preserve

- This Android-only surface uses actual native battery, background execution, data saver and unused-app status. Already allowed settings have no action. Unknown unused-app status is not described as allowed. Returning from system settings refreshes status; failure to read or open settings produces an alert.
- Report current scheduling/outcome and last successful time independently of restriction readiness. Keep waiting, running, retry, reauthentication and foreground handoff understandable without technical controls.
- Authenticated background work shares the app's local store and embedded Tailscale engine. WorkManager runs roughly every 15 minutes and after leaving the app, without sync notifications or a foreground service. Power/manufacturer restrictions can delay it; force stop requires reopening. Native setup can defer automatic requests for one day; settings remain available. See `README.md` for runtime details.
- Existing local-first editing, conflict copies, server connection controls and logout behavior remain authoritative. Background work never opens authentication; the user handles reauthentication in the foreground.

## Finish evidence

Finish review disposition: ship, no material fixes, as handed off by the finish reviewer. Native evidence is stored in the sibling calendar workspace at `C:/code/caldav/.impeccable/review/background/note-phone.png`, `note-tablet.png`, and `note-allowed.png`. The last capture verifies that the battery action disappears after exemption while the unmet unused-app action remains; it is not an all-settings-allowed capture. Documentation compared the component, stylesheet and README. Missing root PRODUCT/DESIGN does not authorize a new visual system; no system or sidecar was created. Runtime validation limits remain in `docs/VERIFICATION.md`.
