#!/usr/bin/env bash
# Downloads the libraries the app needs so the APK works without loading them from the internet.
set -euo pipefail
mkdir -p vendor
FB=10.14.1
curl -fsSL -o vendor/firebase-app-compat.js       https://www.gstatic.com/firebasejs/$FB/firebase-app-compat.js
curl -fsSL -o vendor/firebase-auth-compat.js      https://www.gstatic.com/firebasejs/$FB/firebase-auth-compat.js
curl -fsSL -o vendor/firebase-firestore-compat.js https://www.gstatic.com/firebasejs/$FB/firebase-firestore-compat.js
curl -fsSL -o vendor/xlsx.full.min.js  https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js
curl -fsSL -o vendor/jspdf.umd.min.js  https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js
ls -la vendor
