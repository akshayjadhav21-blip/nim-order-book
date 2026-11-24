# New India Motors – Order Book

Android app (APK) for employees and a browser app for the office, sharing live data through Firebase.

- `src/app.html` – the app (same code as the approved prototype)
- `src/platform.js` – connects the app to Firebase (data + sign-in), Google Gemini (photo reading) and file saving
- `src/config.js` – the Firebase project settings
- `build.mjs` – makes `dist/web` (office app + download page) and `dist/phone` (inside the APK)
- `.github/workflows/build.yml` – GitHub builds the APK and publishes everything on GitHub Pages on every change
- `firestore.rules` – database rules (only devices signed in to the shop account)

Setup steps: see the "Order Book – Setup Guide" document.
