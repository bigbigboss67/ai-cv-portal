/**
 * The Tracker's mailbox connection: the same replies, receipts and sent copies the reader
 * already understands, fetched instead of dropped in.
 *
 * Read-only, and narrow: only mail since the oldest application still open, and only the
 * newest few hundred of those. What comes back is raw RFC 5322 text, handed to
 * tracker-mail.js exactly as a dropped .eml is — nothing here decides anything.
 *
 * Both connections need one free registration, done once by the person whose mailbox it
 * is; until then the panel says so and dropping mail in keeps working.
 */

import { initMailer, signIn, signOut, currentUser, tokenFor, clientId, READ_SCOPES } from "./mailer.js";

/* Paste the Google client id here to offer Gmail; Microsoft's id lives in mailer.js, because
   the same registration sends the mail. Both are walked through in docs/mailbox-setup.md. */
const GOOGLE_CLIENT_ID = "PASTE-YOUR-GOOGLE-CLIENT-ID-HERE.apps.googleusercontent.com";
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const KEY = "cdm-mailbox-v1";
const MAX_PER_CHECK = 40;
const DEFAULT_DAYS = 30;

/* A real one looks like 123456789012-a1b2c3.apps.googleusercontent.com, so the note above
   is not mistaken for a client id. */
const googleConfigured = () => /^\d{6,}-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(GOOGLE_CLIENT_ID);

let state = { provider: "", user: "", checkedAt: "", error: "" };
let gmailToken = "";

function remember(patch) {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify({ provider: state.provider, user: state.user, checkedAt: state.checkedAt }));
  } catch {}
  return state;
}

/* ---------- what to ask for ---------- */

/** The day to read back to: the oldest application still waiting, or a month. */
export function sinceFor(apps, now = new Date(), days = DEFAULT_DAYS) {
  const open = Object.values(apps || {}).filter((a) => a && !["none", "draft", "rejected", "withdrawn"].includes(a.stage));
  const stamps = open.map((a) => Date.parse(a.preparedAt || a.sentAt || "")).filter(Number.isFinite);
  const floor = now.getTime() - days * 86400000;
  const oldest = stamps.length ? Math.min(...stamps) : floor;
  return new Date(Math.max(Math.min(oldest, floor), now.getTime() - 366 * 86400000)).toISOString();
}

export function graphListUrl(folder, sinceIso, max = MAX_PER_CHECK) {
  const field = folder === "sentitems" ? "sentDateTime" : "receivedDateTime";
  return `https://graph.microsoft.com/v1.0/me/mailFolders/${folder}/messages`
    + `?$select=id,${field}&$top=${max}&$orderby=${field} desc`
    + `&$filter=${encodeURIComponent(`${field} ge ${sinceIso}`)}`;
}

/* Only what was received or sent: a label search would sweep in archived and private mail. */
export function gmailListUrl(sinceIso, max = MAX_PER_CHECK) {
  const after = String(sinceIso).slice(0, 10).replace(/-/g, "/");
  return "https://gmail.googleapis.com/gmail/v1/users/me/messages"
    + `?maxResults=${max}&q=${encodeURIComponent(`after:${after} (in:inbox OR in:sent) -in:chats -in:drafts`)}`;
}

/** Gmail hands the whole message back base64url-encoded. */
export function decodeRaw(raw) {
  const b64 = String(raw || "").replace(/-/g, "+").replace(/_/g, "/");
  try {
    return atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  } catch {
    return "";
  }
}

/* ---------- the two mailboxes ---------- */

async function graphText(url, token) {
  const res = await fetch(url, { headers: { authorization: "Bearer " + token } });
  if (!res.ok) throw new Error(`Outlook answered ${res.status}`);
  return res.text();
}

async function outlookCheck(sinceIso, max, interactive) {
  const token = await tokenFor(READ_SCOPES, { silent: !interactive });
  const out = [];
  for (const folder of ["inbox", "sentitems"]) {
    const list = JSON.parse(await graphText(graphListUrl(folder, sinceIso, max), token));
    for (const m of (list.value || []).slice(0, max)) {
      out.push(await graphText(`https://graph.microsoft.com/v1.0/me/messages/${m.id}/$value`, token));
    }
  }
  return out;
}

/** Google's sign-in library, loaded only when Gmail is actually used. */
function gis() {
  if (window.google && window.google.accounts) return Promise.resolve(window.google);
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.onload = () => res(window.google);
    s.onerror = () => rej(new Error("Google's sign-in script did not load."));
    document.head.appendChild(s);
  });
}

async function gmailToken0(prompt) {
  const g = await gis();
  return new Promise((res, rej) => {
    const client = g.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: GOOGLE_SCOPE,
      prompt: prompt ? "consent" : "",
      callback: (r) => (r && r.access_token ? res(r.access_token) : rej(new Error(String((r && r.error) || "Gmail sign-in was refused.")))),
      error_callback: (e) => rej(new Error(String((e && e.message) || "Gmail sign-in was closed."))),
    });
    client.requestAccessToken();
  });
}

/* One sign-in attempt per check at most: a run of messages must never turn into a run of
   consent windows, and a check on the timer asks for nothing at all. */
let gmailAsked = false;

async function gmailFetch(url, interactive) {
  if (!gmailToken) {
    if (!interactive || gmailAsked) throw new Error("Gmail needs signing in again — press Check now.");
    gmailAsked = true;
    gmailToken = await gmailToken0(false);
  }
  const res = await fetch(url, { headers: { authorization: "Bearer " + gmailToken } });
  if (res.status === 401) {                       // an hour is all a browser token lasts
    gmailToken = "";
    throw new Error("Gmail needs signing in again — press Check now.");
  }
  if (!res.ok) throw new Error(`Gmail answered ${res.status}`);
  return res.json();
}

async function gmailCheck(sinceIso, max, interactive) {
  gmailAsked = false;
  const list = await gmailFetch(gmailListUrl(sinceIso, max), interactive);
  const out = [];
  for (const m of (list.messages || []).slice(0, max)) {
    const full = await gmailFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=raw`, interactive);
    const text = decodeRaw(full.raw);
    if (text) out.push(text);
  }
  return out;
}

/* ---------- what the portal calls ---------- */

export function status() {
  return {
    outlook: !!clientId(),
    gmail: googleConfigured(),
    provider: state.provider,
    user: state.user,
    checkedAt: state.checkedAt,
    error: state.error,
    needsSignIn: !!state.needsSignIn,
    connected: !!state.provider,
  };
}

/** Pick up a connection made earlier in this browser (Outlook keeps its own sign-in). */
export async function init() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (saved && saved.provider) state = { ...state, ...saved };
  } catch {}
  if (state.provider === "outlook") {
    const r = await initMailer().catch(() => null);
    if (!r || !r.signedIn) remember({ provider: "", user: "" });
    else remember({ user: currentUser() || state.user });
  }
  // A Gmail token does not survive a reload, and asking for one needs a button press.
  if (state.provider === "gmail") { gmailToken = ""; state.needsSignIn = true; }
  return status();
}

export async function connect(provider) {
  if (provider === "outlook") {
    if (!clientId()) throw new Error("Add the Microsoft application id to mailer.js first.");
    await initMailer();
    const user = await signIn(READ_SCOPES.concat(["User.Read"]));
    return remember({ provider: "outlook", user: user || currentUser() || "", error: "", needsSignIn: false });
  }
  if (provider === "gmail") {
    if (!googleConfigured()) throw new Error("Add the Google client id to mailbox.js first.");
    gmailToken = await gmailToken0(true);
    const me = await gmailFetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", true);
    return remember({ provider: "gmail", user: me.emailAddress || "", error: "", needsSignIn: false });
  }
  throw new Error("Unknown mailbox.");
}

export async function disconnect() {
  if (state.provider === "outlook") await signOut().catch(() => {});
  // Hand the Gmail permission back, not just the token in this tab.
  if (state.provider === "gmail" && gmailToken) {
    try {
      const g = await gis();
      await new Promise((res) => g.accounts.oauth2.revoke(gmailToken, res));
    } catch {}
  }
  gmailToken = "";
  return remember({ provider: "", user: "", error: "", needsSignIn: false });
}

/**
 * One pass over the mailbox. Returns the raw messages for the portal to hand to the
 * reader; it never touches an application itself.
 */
export async function check(apps, { max = MAX_PER_CHECK, now = new Date(), interactive = false } = {}) {
  if (!state.provider) return { messages: [], skipped: "no mailbox connected" };
  if (state.needsSignIn && !interactive) return { messages: [], skipped: "waiting for you to sign in again" };
  // After the first pass only what has arrived since it — with two days of overlap, so
  // nothing is missed — instead of the same weeks of mail, and their attachments, every time.
  const base = sinceFor(apps, now);
  const seenAt = state.checkedAt ? new Date(Date.parse(state.checkedAt) - 2 * 86400000).toISOString() : "";
  const sinceIso = seenAt && seenAt > base ? seenAt : base;
  try {
    const messages = state.provider === "outlook"
      ? await outlookCheck(sinceIso, max, interactive)
      : await gmailCheck(sinceIso, max, interactive);
    remember({ checkedAt: new Date().toISOString(), error: "", needsSignIn: false });
    return { messages, since: sinceIso };
  } catch (err) {
    const message = String((err && err.message) || err);
    // An expired sign-in stops the timer asking again until the person presses a button.
    remember({ error: message, needsSignIn: /sign|token|expired|401|unauthor/i.test(message) });
    return { messages: [], error: message, since: sinceIso };
  }
}
