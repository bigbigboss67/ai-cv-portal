/**
 * Outlook sync for the application tracker.
 *
 * The local helper (tools/outlook-sync) hands over the Sent Items and Inbox of classic
 * Outlook on this PC. Each mail goes through tracker-mail.js — the same matching and
 * reading of replies a dropped .eml gets — and what it concludes is written back onto the
 * tracker's own records: Draft ready -> Applied when the sent copy shows up, then
 * Acknowledged / Info requested / Interview / Offer / Rejected / Bounced from the replies.
 * Clear cases apply themselves; unsure ones wait as suggestions to confirm.
 *
 * The adapter (toMailApps / mergeBack) is pure so Node tests cover it; everything that
 * touches the network, storage or the page lives in startOutlookSync().
 */
import { ingest, confirmItem, ignoreItem, undoItem, CLS_LABEL } from "./tracker-mail.js";

export const HELPER = "http://127.0.0.1:47321";
export const ME = ["rassemkadiri@live.de"];
export const SYNC_KEY = "ai_cv_portal_mail_sync_v1";
const DAY = 86400000;
const FOLLOW_UP_MS = 4 * DAY;

/* The tracker's stages and the mail reader's stages, both ways. "screening" has no
   twin, so it reads as "info": an interview invitation still moves it on, an
   acknowledgement does not move it back. */
const TO_MAIL = {
  draft: "prepared", applied: "applied", followed_up: "applied", acknowledged: "ack", info: "info",
  screening: "info", interview: "interview", offer: "offer", rejected: "rejected", bounced: "bounced",
  archived: "withdrawn",
};
const FROM_MAIL = {
  prepared: "draft", applied: "applied", silent: "applied", ack: "acknowledged", info: "info",
  interview: "interview", offer: "offer", rejected: "rejected", bounced: "bounced", withdrawn: "archived",
};
const mailStage = (s) => TO_MAIL[s] || "applied";
const isoDay = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : "");

/** Tracker records (array) -> the {id: app} shape tracker-mail.js reads. */
export function toMailApps(list) {
  const apps = {};
  for (const a of list || []) {
    if (!a || !a.id) continue;
    const draft = a.stage === "draft";
    apps[a.id] = {
      id: a.id,
      stage: mailStage(a.stage),
      subject: a.subject || "",
      to: a.to || "",
      ref: a.ref || "",
      job: { co: a.company || "", r: a.role || "" },
      msgIds: [...(a.msgIds || [])],
      preparedAt: new Date(a.preparedAt || a.appliedAt || Date.now()).toISOString(),
      sentAt: a.sentAt || (draft ? "" : isoDay(a.appliedAt)),
      lastInboundAt: a.lastReplyAt || "",
      openedAt: a.openedAt || "",
      events: [],
    };
  }
  return apps;
}

/**
 * Write what the mail reader concluded back onto the tracker records. Only fields the
 * mail changed are touched, so a stage you set by hand stays unless a newer mail moves it.
 * Returns { list, changed }.
 */
export function mergeBack(list, apps) {
  let changed = false;
  const out = (list || []).map((a) => {
    const m = apps && apps[a.id];
    if (!m) return a;
    const before = toMailApps([a])[a.id];
    const b = { ...a };
    let touched = false;
    if (m.stage !== before.stage && FROM_MAIL[m.stage]) {
      b.stage = FROM_MAIL[m.stage];
      touched = true;
    }
    if (m.sentAt && m.sentAt !== before.sentAt) {
      b.sentAt = m.sentAt;
      // The real send date becomes the applied date, and the follow-up clock starts there.
      const t = Date.parse(m.sentAt);
      if (Number.isFinite(t)) {
        b.appliedAt = t;
        b.targetFollowUpAt = t + FOLLOW_UP_MS;
      }
      touched = true;
    }
    if (m.lastInboundAt && m.lastInboundAt !== before.lastInboundAt) { b.lastReplyAt = m.lastInboundAt; touched = true; }
    if (m.openedAt && m.openedAt !== before.openedAt) { b.openedAt = m.openedAt; touched = true; }
    if ((m.msgIds || []).length !== before.msgIds.length) { b.msgIds = [...m.msgIds]; touched = true; }
    if ((m.events || []).length) {
      const seen = new Set((a.mailLog || []).map((e) => e.item + "|" + e.kind));
      const fresh = m.events.filter((e) => !seen.has(e.item + "|" + e.kind));
      if (fresh.length) { b.mailLog = [...(a.mailLog || []), ...fresh].slice(-20); touched = true; }
    }
    if (touched) changed = true;
    return touched ? b : a;
  });
  return { list: out, changed };
}

/** Drop a taken-back item's log lines from its application. */
export function dropLog(list, itemId) {
  let changed = false;
  const out = (list || []).map((a) => {
    if (!(a.mailLog || []).some((e) => e.item === itemId)) return a;
    changed = true;
    return { ...a, mailLog: a.mailLog.filter((e) => e.item !== itemId) };
  });
  return { list: out, changed };
}

/** The day to read mail back to: a day before the oldest open application, at most 120 days. */
export function sinceDay(list, now = Date.now()) {
  const open = (list || []).filter((a) => !["archived", "rejected", "offer"].includes(a.stage));
  const oldest = Math.min(...open.map((a) => a.preparedAt || a.appliedAt || now), now - 30 * DAY);
  return isoDay(Math.max(oldest - DAY, now - 120 * DAY));
}

/**
 * Read a batch of mail into the stored sync state. Unmatched mail (newsletters, everything
 * that is not about an application) is forgotten again, so it is neither stored nor kept
 * from being matched once a later application makes it relevant.
 */
export function ingestAll(sync, apps, mails, { me = ME, now } = {}) {
  let st = { apps, inbox: sync.inbox || [], seen: sync.seen || [] };
  // Oldest first, so the first sent copy sets the applied date; undated mail goes last.
  const key = (m) => m.date || "9999";
  const sorted = [...(mails || [])].sort((x, y) => key(x).localeCompare(key(y)));
  for (const m of sorted) st = ingest(st, m, { me, now }).state;
  const unmatched = st.inbox.filter((x) => x.status === "unmatched");
  const drop = new Set(unmatched.flatMap((x) => x.keys || [x.key]));
  return {
    apps: st.apps,
    sync: { ...sync, inbox: st.inbox.filter((x) => x.status !== "unmatched"), seen: st.seen.filter((k) => !drop.has(k)) },
  };
}

/* ---------- browser ---------- */

export function startOutlookSync(env) {
  const { getApps, saveApps, toast, esc } = env;
  const load = () => {
    try { return JSON.parse(localStorage.getItem(SYNC_KEY) || "{}"); } catch { return {}; }
  };
  const save = (s) => {
    try { localStorage.setItem(SYNC_KEY, JSON.stringify(s)); } catch {}
  };
  let status = { state: "idle", msg: "" };
  let inflight = null;

  async function helperUp() {
    try {
      const r = await fetch(HELPER + "/health", { cache: "no-store" });
      return r.ok;
    } catch {
      return false;
    }
  }

  /** Apply a stored-state change (confirm / ignore / undo) to the tracker. */
  function commit(sync, apps, takenBack) {
    let { list } = mergeBack(getApps(), apps);
    if (takenBack) list = dropLog(list, takenBack).list;
    save(sync);
    saveApps(list);
    render();
  }

  /** One check at a time: a second call waits for the one already running. */
  function syncNow(opts) {
    if (!inflight) inflight = runSync(opts).finally(() => { inflight = null; });
    return inflight;
  }

  async function runSync({ quiet = false } = {}) {
    status = { state: "syncing", msg: "Reading Outlook…" };
    render();
    try {
      if (!(await helperUp())) {
        status = { state: "off", msg: "Outlook sync is off — start the helper on this PC." };
        return;
      }
      const list = getApps();
      const res = await fetch(`${HELPER}/mail?since=${sinceDay(list)}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || res.status);
      const prev = load();
      const before = new Set((prev.inbox || []).map((x) => x.id));
      const { apps, sync } = ingestAll(prev, toMailApps(list), [...data.sent, ...data.inbox]);
      const merged = mergeBack(getApps(), apps);
      const fresh = sync.inbox.filter((x) => !before.has(x.id));
      save({ ...sync, lastSync: new Date().toISOString(), helperSeenAt: Date.now() });
      if (merged.changed) saveApps(merged.list);
      status = { state: "on", msg: "" };
      const applied = fresh.filter((x) => x.status === "auto").length;
      const suggested = fresh.filter((x) => x.status === "suggested").length;
      if (!quiet || applied || suggested) {
        toast(`Outlook sync: ${applied} update${applied === 1 ? "" : "s"} applied` + (suggested ? `, ${suggested} to confirm` : ""));
      }
    } catch (err) {
      console.warn("Outlook sync:", err);
      status = { state: "error", msg: "Outlook sync failed: " + (err.message || err) };
    } finally {
      render();
    }
  }

  function act(kind, itemId, appId) {
    const prev = load();
    const st = { apps: toMailApps(getApps()), inbox: prev.inbox || [], seen: prev.seen || [] };
    const it = st.inbox.find((x) => x.id === itemId);
    if (!it) return;
    let next;
    if (kind === "confirm") next = confirmItem(st, itemId, appId || it.appId);
    else if (kind === "ignore") next = ignoreItem(st, itemId);
    else next = undoItem(st, itemId);
    commit({ ...prev, inbox: next.inbox, seen: next.seen }, next.apps, kind === "confirm" ? null : itemId);
  }

  function appName(id) {
    const a = getApps().find((x) => x.id === id);
    return a ? `${a.role} — ${a.company}` : "an application";
  }

  function render() {
    const sync = load();
    const inbox = sync.inbox || [];
    const pending = inbox.filter((x) => x.status === "suggested");
    const recent = inbox.filter((x) => x.status === "auto" || x.status === "confirmed").slice(0, 5);
    const dot = { on: "#10b981", syncing: "#f59e0b", off: "#94a3b8", error: "#ef4444", idle: "#94a3b8" }[status.state];
    const when = sync.lastSync ? new Date(sync.lastSync).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "never";
    const label = status.state === "on" || (status.state === "idle" && sync.lastSync)
      ? `Outlook sync on · last check ${when}`
      : status.msg || "Outlook sync";
    const line = (x, buttons) => `
      <div style="display:flex;gap:10px;align-items:flex-start;justify-content:space-between;padding:8px 0;border-top:1px dashed var(--border-subtle);">
        <div style="font-size:12px;line-height:1.5;color:var(--text-secondary);min-width:0;">
          <strong>${esc(x.dir === "out" ? "Sent" : CLS_LABEL[x.cls] || "Reply")}</strong>
          ${x.from && x.dir !== "out" ? ` from ${esc(x.from)}` : ""} · ${esc(String(x.date).slice(0, 10))}
          <div style="color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(x.subject)}</div>
          <div>→ ${esc(appName(x.appId))}</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;">${buttons}</div>
      </div>`;
    const btn = (txt, call, strong) =>
      `<button type="button" class="btn-pill-secondary" style="padding:4px 10px;font-size:11.5px;${strong ? "font-weight:700;border-color:var(--accent-emerald);color:var(--accent-emerald);" : ""}" onclick="${call}">${txt}</button>`;
    const html = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:600;color:var(--text-secondary);">
          <span style="width:8px;height:8px;border-radius:50%;background:${dot};display:inline-block;"></span>
          📬 ${esc(label)}
        </div>
        ${btn(status.state === "syncing" ? "Checking…" : "Check Outlook now", "OutlookSync.syncNow()")}
      </div>
      ${pending.length ? `<div style="margin-top:8px;font-size:11px;font-weight:700;text-transform:uppercase;color:var(--accent-amber);">To confirm (${pending.length})</div>
        ${pending.map((x) => line(x, btn("✓ Confirm", `OutlookSync.act('confirm','${x.id}')`, true) + btn("Ignore", `OutlookSync.act('ignore','${x.id}')`))).join("")}` : ""}
      ${recent.length ? `<div style="margin-top:8px;font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);">Recent updates</div>
        ${recent.map((x) => line(x, btn("Undo", `OutlookSync.act('${x.status === "auto" ? "undo" : "ignore"}','${x.id}')`))).join("")}` : ""}`;
    document.querySelectorAll(".outlook-sync-panel").forEach((el) => { el.innerHTML = html; });
  }

  /** True when the helper answered within the last week: then a click on Send only prepares. */
  const active = () => Date.now() - (load().helperSeenAt || 0) < 7 * DAY;

  window.OutlookSync = { syncNow, act, render, active };
  render();
  setTimeout(() => syncNow({ quiet: true }), 2500);
  setInterval(() => { if (document.visibilityState === "visible") syncNow({ quiet: true }); }, 5 * 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - Date.parse(load().lastSync || 0) > 60 * 1000) syncNow({ quiet: true });
  });
}
