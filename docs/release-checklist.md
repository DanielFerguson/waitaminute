# Release checklist

1. Run `npm ci`, `npm run full`, `npm audit --omit=dev`, `npm run assets`, and `npm run package`. If the managed Playwright browser is unavailable locally, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to a Chrome for Testing binary; CI uses Playwright's managed Chromium.
2. Load the ZIP in a clean Chrome profile. Complete onboarding; test countdown, maths, a hard block, an overnight schedule, export/import, reset, keyboard navigation, 320px popup, and reduced motion.
3. Repeat the core manual journey in Edge.
4. Confirm `https://danielferguson.github.io/waitaminute/privacy/` is live, current, and entered in the Chrome Web Store privacy-policy field.
5. Upload the generated 128px icon, current 1280×800 screenshots, and `assets/promo-440x280.png`. Use the copy in `docs/store-listing.md`.
6. Publish first to trusted testers; review permissions, privacy-practice declarations, and the installed release before public rollout.
