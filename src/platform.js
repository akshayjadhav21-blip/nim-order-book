/* New India Motors – Order Book: platform layer for the real apps.
   Replaces the prototype's built-in services with Firebase (sync), Google Gemini (photo reading)
   and normal file saving. Loaded before the app code. */
(function(){
  "use strict";
  const MODE = window.NIM_MODE || "desk";                 // "phone" (APK) or "desk" (office web app)
  window.NIM_REAL = true;
  document.documentElement.classList.add("nim-real", "mode-"+MODE);
  const CFG = window.NIM_FIREBASE_CONFIG || {};
  const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

  /* ---------- Firebase ---------- */
  let fs = null, auth = null, readyResolve, ready = new Promise(r => readyResolve = r);
  const configured = !!(CFG.apiKey && CFG.projectId && window.firebase);
  if (configured) {
    firebase.initializeApp(CFG);
    auth = firebase.auth();
    fs = firebase.firestore();
    try { fs.enablePersistence({ synchronizeTabs: true }).catch(() => {}); } catch (e) {}
  }

  /* writes: resolve once saved on the device (Firestore keeps it and syncs when online) */
  function softWrite(p) {
    p.catch(e => { console.error(e); window.NIM_writeError && window.NIM_writeError(e); });
    return Promise.race([p, new Promise(r => setTimeout(r, 1500))]);
  }
  const wrapSnap = s => ({ exists: s.exists, id: s.id, data: () => s.data(), metadata: { fromCache: s.metadata.fromCache } });
  const wrapQSnap = q => ({ size: q.size, docs: q.docs.map(wrapSnap), metadata: { fromCache: q.metadata.fromCache } });
  const errCode = e => ({ code: e && e.code === "permission-denied" ? "revoked" : (e && e.code) || "error", message: e && e.message });

  const db = {
    doc(path) {
      const ref = fs.doc(path);
      return {
        get: async () => wrapSnap(await ref.get()),
        set: data => softWrite(ref.set(JSON.parse(JSON.stringify(data)))),
        update: data => softWrite(ref.update(JSON.parse(JSON.stringify(data)))),
        delete: () => softWrite(ref.delete()),
        onSnapshot: (fn, err) => ref.onSnapshot({ includeMetadataChanges: false }, s => fn(wrapSnap(s)), e => err && err(errCode(e))),
        acquire: async () => ({ acquired: true })
      };
    },
    collection(path) {
      const ref = fs.collection(path);
      return { onSnapshot: (fn, err) => ref.onSnapshot(q => fn(wrapQSnap(q)), e => err && err(errCode(e))) };
    },
    /* safe running numbers (PO / claim numbers): a transaction, needs internet */
    async increment(path, extra) {
      if (!navigator.onLine) throw new Error("Go online to get the next number.");
      const ref = fs.doc(path);
      return await fs.runTransaction(async tx => {
        const s = await tx.get(ref);
        const n = (s.exists ? Number(s.data().last || 0) : 0) + 1;
        tx.set(ref, Object.assign({}, extra || {}, { last: n, updated: new Date().toISOString() }));
        return n;
      });
    }
  };

  /* app settings (Gemini key) kept in Firestore so every phone gets them */
  window.NIM_SETTINGS = {};
  function watchSettings() {
    fs.doc("master/settings").onSnapshot(s => {
      window.NIM_SETTINGS = s.exists ? s.data() : {};
      try { if (typeof S !== "undefined" && S.desk && S.desk.tab === "emps" && typeof renderDeskBody === "function") renderDeskBody(); } catch (e) {}
    }, () => {});
  }

  /* ---------- Gemini (photo reading) ---------- */
  const blobToB64 = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(b); });
  const DEFAULT_MODEL = "gemini-flash-latest", BACKUP_MODEL = "gemini-flash-lite-latest";
  async function geminiOnce(model, key, parts) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseMimeType: "application/json", temperature: 0 } })
    });
    const j = await r.json().catch(() => ({}));
    return { r, j };
  }
  async function gemini(prompt, images) {
    const st = window.NIM_SETTINGS || {};
    const key = st.geminiKey;
    let model = String(st.geminiModel || "").trim();
    if (!/^[a-z0-9][a-z0-9.\-]*$/i.test(model)) model = DEFAULT_MODEL;     // empty or not a model name
    if (!key) throw { code: "nokey" };
    if (!navigator.onLine) throw { code: "offline", message: "No internet connection." };
    const parts = [{ text: prompt }];
    for (const b of images || []) parts.push({ inline_data: { mime_type: b.type || "image/jpeg", data: await blobToB64(b) } });
    // busy (503/500/429) → wait and retry, then try the lighter backup model
    const plan = [[model, 0], [model, 2500], [model === BACKUP_MODEL ? DEFAULT_MODEL : BACKUP_MODEL, 1000]];
    let last = null;
    for (const [m, wait] of plan) {
      if (wait) await new Promise(res => setTimeout(res, wait));
      const { r, j } = await geminiOnce(m, key, parts);
      if (r.ok) {
        const txt = ((((j.candidates || [])[0] || {}).content || {}).parts || []).map(p => p.text || "").join("");
        try { return JSON.parse(txt.replace(/^```(json)?|```$/g, "").trim()); } catch (e) { throw { code: "error", message: "Unreadable reply" }; }
      }
      last = { r, j };
      if (![429, 500, 503].includes(r.status)) break;
    }
    const { r, j } = last;
    if (r.status === 429) throw { code: "rate_limited" };
    if (r.status === 503 || r.status === 500) throw { code: "busy", message: "Google's photo reading is busy right now. Try again in a minute." };
    throw { code: r.status === 400 || r.status === 403 ? "badkey" : "error", message: (j.error && j.error.message) || ("Error " + r.status) };
  }
  const sample = { limits: async () => ({ images: true }), json: (prompt, opt) => gemini(prompt, (opt && opt.images) || []) };
  window.NIM_testAI = async () => {
    try { const r = await gemini('Reply with JSON only: {"ok":true}', []); return r && r.ok ? "✓ Photo reading works." : "Got a reply, but not the expected one."; }
    catch (e) { if (e.code === "nokey") return "Save a key first."; if (e.code === "rate_limited") return "Key works, but the free limit is used up for now.";
      if (e.code === "busy") return "Key works ✓ – Google is busy right now, so scanning may need a retry."; throw new Error(e.message || "Test failed."); }
  };

  /* ---------- saving files (backup, CSV, claim PDF) ---------- */
  async function saveFile({ filename, data }) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: /\.csv$/i.test(filename) ? "text/csv" : /\.json$/i.test(filename) ? "application/json" : "application/octet-stream" });
    const P = window.Capacitor && window.Capacitor.Plugins;
    if (isNative() && P && P.Filesystem && P.Share) {
      const b64 = await blobToB64(blob);
      const w = await P.Filesystem.writeFile({ path: filename, data: b64, directory: "CACHE" });
      await P.Share.share({ title: filename, files: [w.uri], dialogTitle: "Share or save " + filename });
      return;
    }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  /* ---------- the service lookup the app uses ---------- */
  window.claude = {
    use: async name => {
      if (name === "db") { if (!configured) return null; await ready; return db; }
      if (name === "sample") return configured ? sample : null;
      if (name === "downloads") return { save: saveFile };
      return null;
    }
  };

  /* ---------- sign-in to the shop account ---------- */
  function signInScreen(msg) {
    let el = document.getElementById("nim-login");
    if (!el) { el = document.createElement("div"); el.id = "nim-login"; document.body.appendChild(el); }
    el.innerHTML = `<div class="nl-card"><h1>New India Motors</h1><p class="nl-sub">Order Book · ${MODE === "phone" ? "Employee app" : "Office"}</p>
      <p>Sign in once with the <b>shop account</b> (the owner has it). After that only your PIN is needed.</p>
      <label>Shop email<input id="nl-email" type="email" autocomplete="username" inputmode="email"></label>
      <label>Password<input id="nl-pass" type="password" autocomplete="current-password"></label>
      ${msg ? `<p class="nl-err">${msg}</p>` : ""}
      <button id="nl-go">Sign in</button></div>`;
    const go = async () => {
      const b = document.getElementById("nl-go"); b.disabled = true; b.textContent = "Signing in…";
      try { await auth.signInWithEmailAndPassword(document.getElementById("nl-email").value.trim(), document.getElementById("nl-pass").value); }
      catch (e) { signInScreen(/network/i.test(e.code || "") ? "No internet. Connect and try again." : "Email or password is wrong."); }
    };
    document.getElementById("nl-go").onclick = go;
    document.getElementById("nl-pass").onkeydown = e => { if (e.key === "Enter") go(); };
  }
  function notConfigured() {
    const el = document.createElement("div"); el.id = "nim-login";
    el.innerHTML = `<div class="nl-card"><h1>Setup needed</h1><p>${window.firebase ? "The Firebase settings are missing in <b>src/config.js</b>." : "The app files could not load. Check the internet connection and open the app again."}</p></div>`;
    document.body.appendChild(el);
  }
  window.NIM_signOut = async () => { try { await auth.signOut(); } catch (e) {} location.reload(); };

  const css = document.createElement("style");
  css.textContent = `#nim-login{position:fixed;inset:0;z-index:999;background:#13202c;display:flex;align-items:center;justify-content:center;padding:20px;font-family:system-ui,sans-serif}
  .nl-card{background:#fff;color:#13202c;border-radius:16px;padding:24px;width:min(380px,100%);display:flex;flex-direction:column;gap:10px}
  .nl-card h1{margin:0;font-size:26px}.nl-sub{margin:-6px 0 4px;color:#5b6b7a;font-weight:600}
  .nl-card label{display:flex;flex-direction:column;gap:4px;font-weight:600;font-size:14px}
  .nl-card input{padding:12px;border:1px solid #c9d3dc;border-radius:10px;font-size:17px}
  .nl-card button{margin-top:6px;padding:14px;border:0;border-radius:10px;background:#1f7a3f;color:#fff;font-size:18px;font-weight:700}
  .nl-err{color:#c0392b;font-weight:600;margin:0}`;
  document.head.appendChild(css);

  document.addEventListener("DOMContentLoaded", () => {
    if (!configured) { notConfigured(); return; }
    let first = true;
    auth.onAuthStateChanged(u => {
      if (u) {
        window.NIM_ACCOUNT = u.email || "";
        const el = document.getElementById("nim-login"); if (el) el.remove();
        if (first) { first = false; watchSettings(); readyResolve(); }
      } else {
        if (!first) { location.reload(); return; }
        signInScreen("");
      }
    });
  });

  /* ---------- real offline detection (phone) ---------- */
  function syncOnline() {
    try {
      if (typeof S === "undefined" || !S.phone || typeof ACT === "undefined") return;
      const off = !navigator.onLine;
      if (off !== !!S.phone.offline) ACT.poffline();
    } catch (e) {}
  }
  window.addEventListener("online", syncOnline);
  window.addEventListener("offline", syncOnline);
  setInterval(syncOnline, 5000);
  window.NIM_writeError = e => { try { (MODE === "phone" ? ptoast : dtoast)("Could not save to the cloud: " + (e.code || e.message || "error")); } catch (x) {} };

  /* Android back button */
  document.addEventListener("DOMContentLoaded", () => {
    const App = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (!App || !App.addListener) return;
    App.addListener("backButton", () => {
      const b = document.querySelector("#phone .p-head .back");
      if (document.querySelector("#phone .drawer")) { const bg = document.querySelector("#phone .drawer-bg"); if (bg) bg.click(); return; }
      if (b) b.click(); else App.minimizeApp();
    });
  });
})();

/* ---------- "new version available" on phones ---------- */
(function(){
  if (window.NIM_MODE !== "phone" || !window.NIM_SITE || !window.NIM_VERSION || window.NIM_VERSION === "dev") return;
  async function check() {
    try {
      const r = await fetch(window.NIM_SITE + "version.json?t=" + Date.now(), { cache: "no-store" });
      const v = (await r.json()).version;
      if (!v || v === window.NIM_VERSION || document.getElementById("nim-upd")) return;
      const b = document.createElement("a");
      b.id = "nim-upd"; b.href = window.NIM_SITE + "download.html"; b.target = "_blank"; b.rel = "noopener";
      b.textContent = "⬇ New version " + v + " available – tap to download";
      b.style.cssText = "position:fixed;left:10px;right:10px;bottom:calc(10px + env(safe-area-inset-bottom));z-index:900;background:#1f7a3f;color:#fff;padding:12px 14px;border-radius:12px;font-weight:700;text-align:center;text-decoration:none;box-shadow:0 6px 18px rgba(0,0,0,.3)";
      document.body.appendChild(b);
    } catch (e) {}
  }
  setTimeout(check, 4000); setInterval(check, 6 * 3600 * 1000);
})();
