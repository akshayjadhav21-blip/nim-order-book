// Builds two copies of the app from src/:
//   dist/web     – office desktop app (browser), also hosts the APK download page
//   dist/phone   – what goes inside the Android APK
import fs from "node:fs";
import path from "node:path";

const SRC = "src", OUT = "dist";
const VENDOR = [
  "vendor/firebase-app-compat.js",
  "vendor/firebase-auth-compat.js",
  "vendor/firebase-firestore-compat.js"
];
const html = fs.readFileSync(path.join(SRC, "app.html"), "utf8");
const version = process.env.APP_VERSION || "dev";
const site = (process.env.PAGES_URL || "").replace(/\/?$/, "/");

function make(mode, dir) {
  let h = html
    .replace(/<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/xlsx\/[^"]+"><\/script>/, '<script src="vendor/xlsx.full.min.js"></script>')
    .replace(/<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf\/[^"]+"><\/script>/, '<script src="vendor/jspdf.umd.min.js"></script>')
    .replace(/<title>[^<]*<\/title>/, `<title>New India Motors – Order Book</title>`);
  const head = `<meta name="nim-version" content="${version}">\n` +
    `<script>window.NIM_MODE=${JSON.stringify(mode)};window.NIM_VERSION=${JSON.stringify(version)};window.NIM_SITE=${JSON.stringify(site==="/"?"":site)};</script>\n` +
    VENDOR.map(v => `<script src="${v}"></script>`).join("\n") +
    `\n<script src="config.js"></script>\n<script src="platform.js"></script>\n`;
  const i = h.indexOf("<script>");
  if (i < 0) throw new Error("app.html has no inline script");
  h = h.slice(0, i) + head + h.slice(i);
  if (mode === "phone" && !/name="viewport"/.test(h)) h = h.replace("<head>", '<head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">');
  h = h.replace(/name="viewport" content="[^"]*"/, 'name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"');
  fs.mkdirSync(path.join(dir, "vendor"), { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), h);
  for (const f of ["config.js", "platform.js"]) fs.copyFileSync(path.join(SRC, f), path.join(dir, f));
  if (fs.existsSync("vendor")) for (const f of fs.readdirSync("vendor")) fs.copyFileSync(path.join("vendor", f), path.join(dir, "vendor", f));
}
fs.rmSync(OUT, { recursive: true, force: true });
make("desk", path.join(OUT, "web"));
make("phone", path.join(OUT, "phone"));
fs.copyFileSync(path.join(SRC, "download.html"), path.join(OUT, "web", "download.html"));
fs.writeFileSync(path.join(OUT, "web", ".nojekyll"), "");
fs.writeFileSync(path.join(OUT, "web", "version.json"), JSON.stringify({ version, built: new Date().toISOString() }));
console.log("Built dist/web and dist/phone, version", version);
