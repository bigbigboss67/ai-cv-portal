/**
 * Admin lock.
 *
 * WHAT THIS IS: a doormat. It stops a casual visitor who lands on the URL from
 * reading the portal.
 *
 * WHAT THIS IS NOT: security. This is a static page — anyone who opens
 * view-source or DevTools reads the CV data directly, gate or no gate. Treat the
 * URL as semi-public and never put anything here you would not eventually
 * tolerate being seen.
 *
 * The password is stored as a SHA-256 hash rather than plaintext. That does not
 * make the gate stronger — it means the password itself is not handed to anyone
 * reading the source, which matters if it is reused elsewhere.
 */

const PASS_SHA256 = "43fd432ac0170a9d9593e1ede1cb221d4d534d889e4f1689a05fefcc5b1601ac";
const KEY = "design-cv-gate";

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function unlocked() {
  try { return sessionStorage.getItem(KEY) === PASS_SHA256; } catch { return false; }
}

function paint() {
  const el = document.createElement("div");
  el.id = "cvGate";
  el.innerHTML = `
    <style>
      #cvGate{position:fixed;inset:0;z-index:99999;background:#0b1630;color:#f4f1e8;
        display:grid;place-items:center;font-family:"Space Grotesk",system-ui,sans-serif;padding:24px}
      #cvGate .box{width:min(400px,100%);text-align:center}
      #cvGate h1{font-family:"Cormorant Garamond",Georgia,serif;font-size:32px;font-weight:500;
        text-transform:uppercase;letter-spacing:.04em;margin:0 0 6px}
      #cvGate .rule{height:1px;background:linear-gradient(90deg,rgba(201,162,74,0),#c9a24a,rgba(201,162,74,0));margin:16px 0 20px}
      #cvGate p{margin:0 0 18px;font-size:12.5px;line-height:1.6;color:#9a9686}
      #cvGate input{width:100%;padding:12px 14px;background:#16264a;border:1px solid #2d3a5c;
        border-radius:3px;color:#f4f1e8;font:inherit;font-size:15px;text-align:center;letter-spacing:.1em}
      #cvGate input:focus{outline:none;border-color:#c9a24a}
      #cvGate button{margin-top:10px;width:100%;padding:12px;background:transparent;border:1px solid #c9a24a;
        border-radius:3px;color:#e3c987;font:inherit;font-size:13px;letter-spacing:.06em;cursor:pointer}
      #cvGate button:hover{background:#c9a24a;color:#0b1630}
      #cvGate .err{margin-top:12px;font-size:12px;color:#d98b72;min-height:16px}
      #cvGate .fine{margin-top:22px;font-size:10.5px;color:#5d5a52;line-height:1.6}
    </style>
    <div class="box">
      <h1>Rassem Kadiri</h1>
      <div class="rule"></div>
      <p>Private career portal.</p>
      <input id="cvGatePass" type="password" placeholder="password" autocomplete="current-password" autofocus>
      <button id="cvGateGo" type="button">Unlock</button>
      <div class="err" id="cvGateErr"></div>
      <div class="fine">This gate keeps out casual visitors. It is not encryption — do not treat this URL as confidential.</div>
    </div>`;
  document.documentElement.appendChild(el);

  const input = el.querySelector("#cvGatePass");
  const err = el.querySelector("#cvGateErr");

  const tryPass = async () => {
    const h = await sha256(input.value);
    if (h === PASS_SHA256) {
      try { sessionStorage.setItem(KEY, h); } catch {}
      el.remove();
      return;
    }
    err.textContent = "Not that one.";
    input.select();
  };

  el.querySelector("#cvGateGo").addEventListener("click", tryPass);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") tryPass(); });
  setTimeout(() => input.focus(), 30);
}

if (!unlocked()) paint();
