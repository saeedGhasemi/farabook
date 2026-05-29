// App version. Format: MAJOR.MINOR.PATCH (PATCH is zero-padded to 3 digits).
//
// AUTO-BUMP RULE (managed by the AI on every change):
//   • Light change      (~1–5 credits)   → +1 patch   (e.g. 1.0.001 → 1.0.002)
//   • Medium change     (~5–15 credits)  → +2–3 patch
//   • Significant change (~15–25 credits) → +1 minor  (e.g. 1.0.x → 1.1.0)  ← "20 credits = serious"
//   • Breaking / overhaul (50+ credits)   → +1 major  (e.g. 1.x.y → 2.0.0)
// The user may also edit this manually at any time.
export const APP_VERSION = "1.13.002";
export const APP_VERSION_LABEL = `v${APP_VERSION}`;
