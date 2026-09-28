/**
 * Sign in with a personal Microsoft account, build the CV + letter as a PDF in
 * the browser, and send it through Graph /me/sendMail with the PDF attached.
 *
 * Nothing here touches a server. The token lives in the browser session, the PDF
 * is generated client-side, and the mail leaves from the signed-in mailbox — so
 * it lands in that account's Sent Items like anything else.
 *
 * Requires, in career-portal.html before this file:
 *   <script src="https://alcdn.msauthimages.net/browser/2.38.3/js/msal-browser.min.js"></script>
 *   <script src="https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.2/dist/html2pdf.bundle.min.js"></script>
 */

/* ── configuration ───────────────────────────────────────────────
   Replace CLIENT_ID with the Application (client) ID from your own app
   registration. See the "Register the app" steps in DEPLOY.md — it takes
   about two minutes and needs your Microsoft sign-in, so it cannot be
   scripted for you.                                                      */
const CLIENT_ID = "PASTE-YOUR-APPLICATION-CLIENT-ID-HERE";

/** "consumers" = personal Microsoft accounts only (outlook.com, live.de, hotmail). */
const AUTHORITY = "https://login.microsoftonline.com/consumers";
const SCOPES = ["Mail.Send", "User.Read"];
/** Reading replies in the Tracker asks for this on top, from the same registration. */
export const READ_SCOPES = ["Mail.Read"];
export const clientId = () => (configured() ? CLIENT_ID : "");

const REDIRECT_URI = location.origin + location.pathname.replace(/[^/]*$/, "");

const configured = () => /^[0-9a-f-]{36}$/i.test(CLIENT_ID);

let msalApp = null;
let account = null;

function app() {
  if (msalApp) return msalApp;
  if (!window.msal) throw new Error("MSAL did not load. Check the script tag and any ad blocker.");
  msalApp = new msal.PublicClientApplication({
    auth: { clientId: CLIENT_ID, authority: AUTHORITY, redirectUri: REDIRECT_URI },
    cache: { cacheLocation: "sessionStorage", storeAuthStateInCookie: false },
  });
  return msalApp;
}

export async function initMailer() {
  if (!configured()) return { ready: false, reason: "no-client-id" };
  const a = app();
  await a.initialize();
  const res = await a.handleRedirectPromise();      // returning from a redirect sign-in
  if (res?.account) account = res.account;
  else account = a.getAllAccounts()[0] || null;
  return { ready: true, signedIn: !!account, username: account?.username || null };
}

export async function signIn(scopes = SCOPES) {
  if (!configured()) throw new Error("Set CLIENT_ID in mailer.js first.");
  const a = app();
  await a.initialize();
  try {
    const res = await a.loginPopup({ scopes, prompt: "select_account" });
    account = res.account;
  } catch (err) {
    // Popup blockers and embedded webviews are common; fall back rather than dead-end.
    if (/popup_window_error|user_cancelled|BrowserAuthError/i.test(String(err))) {
      await a.loginRedirect({ scopes });
      return null;
    }
    throw err;
  }
  return account.username;
}

/**
 * An access token for whatever scopes the caller needs — sending, or reading.
 * `silent` never opens a window: a check running on a timer must not make one appear.
 */
export async function tokenFor(scopes, { silent = false } = {}) {
  const a = app();
  if (!account) throw new Error("Sign in first.");
  try {
    return (await a.acquireTokenSilent({ scopes, account })).accessToken;
  } catch (err) {
    if (silent) throw new Error("The mailbox sign-in has run out — press Connect Outlook again.");
    return (await a.acquireTokenPopup({ scopes, account })).accessToken;
  }
}

export async function signOut() {
  if (!account) return;
  await app().logoutPopup({ account });
  account = null;
}

export function currentUser() {
  return account?.username || null;
}

async function token() {
  const a = app();
  if (!account) throw new Error("Sign in first.");
  try {
    const r = await a.acquireTokenSilent({ scopes: SCOPES, account });
    return r.accessToken;
  } catch {
    const r = await a.acquireTokenPopup({ scopes: SCOPES, account });
    return r.accessToken;
  }
}

/* ── PDF ─────────────────────────────────────────────────────────── */

/**
 * Render an element to a PDF and return it base64-encoded, which is the form
 * Graph wants for an attachment.
 */
export async function pdfBase64(element, filename) {
  if (!window.html2pdf) throw new Error("html2pdf did not load.");
  const blob = await html2pdf()
    .set({
      margin: 0,
      filename,
      image: { type: "jpeg", quality: 0.96 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak: { mode: ["css", "legacy"] },
    })
    .from(element)
    .outputPdf("blob");

  const buf = await blob.arrayBuffer();
  let bin = "";
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;                       // avoid blowing the call stack on large PDFs
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return { base64: btoa(bin), bytes: bytes.length };
}

/* ── send ────────────────────────────────────────────────────────── */

/**
 * @param {object} m
 * @param {string}   m.to        recipient address
 * @param {string}   m.subject
 * @param {string}   m.html      message body
 * @param {Array}    m.attachments  [{ name, base64 }]
 * @param {boolean}  m.draftOnly   true = create a draft instead of sending
 */
export async function sendMail({ to, subject, html, attachments = [], draftOnly = false }) {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(to || "").trim())) {
    throw new Error("That recipient address is not valid.");
  }
  const at = await token();

  const message = {
    subject,
    body: { contentType: "HTML", content: html },
    toRecipients: [{ emailAddress: { address: to.trim() } }],
    attachments: attachments.map((a) => ({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: a.name,
      contentType: "application/pdf",
      contentBytes: a.base64,
    })),
  };

  // Graph rejects a single request over ~4 MB. Say so plainly rather than
  // letting it fail as an opaque 413.
  const approx = attachments.reduce((n, a) => n + a.base64.length, 0);
  if (approx > 3_500_000) {
    throw new Error("The attachments are too large for a single Graph request (about 4 MB). Reduce the PDF quality or send one document at a time.");
  }

  const url = draftOnly
    ? "https://graph.microsoft.com/v1.0/me/messages"
    : "https://graph.microsoft.com/v1.0/me/sendMail";
  const body = draftOnly ? message : { message, saveToSentItems: true };

  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: "Bearer " + at, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json())?.error?.message || ""; } catch {}
    throw new Error(`Graph ${res.status}: ${detail || res.statusText}`);
  }

  if (draftOnly) {
    const created = await res.json();
    return { draftId: created.id, webLink: created.webLink };
  }
  return { sent: true };
}

export const mailerStatus = () => ({
  configured: configured(),
  clientId: configured() ? CLIENT_ID : null,
  redirectUri: REDIRECT_URI,
  signedIn: !!account,
  username: account?.username || null,
});
