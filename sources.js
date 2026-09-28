/**
 * The Sources tab: the researched list plus the user's own changes.
 *
 * Pure — no DOM, no network, no clock. Every function returns new objects and
 * never mutates its inputs, so the portal can hand it the live `edits.src` and a
 * render can never half-apply a change.
 *
 * Only differences from the researched row are stored, so "Reset to the
 * researched version" is exact and a later correction to the researched list
 * reaches every field the user never touched.
 */

export const SOURCE_FIELDS = ["n", "u", "w", "t"];
export const CONTACT_FIELDS = ["email", "emailFrom", "phone", "phoneFrom", "person", "role", "checked"];

const OWN = /^own-(\d+)$/;
const isObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const copy = (x) => JSON.parse(JSON.stringify(x));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const blankContact = () => Object.fromEntries(CONTACT_FIELDS.map((f) => [f, ""]));
const hasContact = (c) => isObj(c) && CONTACT_FIELDS.some((f) => String(c[f] || "").trim() !== "");

export const emptySrc = () => ({ seq: 0, changed: {}, added: [], hidden: [] });

/* Only plain values become text. An object is never converted: String() on a crafted object can
   throw, and a backup must not be able to take the tab down that way. */
const str = (v) =>
  typeof v === "string" ? v
  : typeof v === "number" || typeof v === "boolean" ? String(v)
  : Array.isArray(v) ? v.map(str).filter(Boolean).join(" ")
  : "";

/** One stored row with every field forced to its declared type. A field that is absent stays absent. */
function coerce(row) {
  const out = {};
  for (const f of SOURCE_FIELDS) {
    if (row[f] === undefined) continue;
    out[f] = f === "t" ? (Array.isArray(row.t) ? row.t.map(str) : []) : str(row[f]);
  }
  // A contact with nothing in it is no contact — the same rule updateSource applies when saving.
  if (isObj(row.contact)) {
    const c = Object.fromEntries(CONTACT_FIELDS.map((f) => [f, str(row.contact[f])]));
    if (hasContact(c)) out.contact = c;
  }
  return out;
}

/**
 * Anything that is not a valid structure — missing, a string, a restored file from elsewhere —
 * becomes one, field types included: a backup written by hand or by another tool must not be able
 * to throw inside a render and take the tab down with it.
 */
export function normaliseSrc(src) {
  const s = isObj(src) ? src : {};
  const changed = {};
  if (isObj(s.changed)) {
    for (const [k, v] of Object.entries(s.changed)) {
      if (!isObj(v)) continue;
      const c = coerce(v);
      if (Object.keys(c).length) changed[k] = c;
    }
  }
  const keys = new Set();
  const added = (Array.isArray(s.added) ? s.added : [])
    .filter((a) => isObj(a) && typeof a.k === "string" && OWN.test(a.k) && !keys.has(a.k) && keys.add(a.k))
    .map((a) => Object.assign({ k: a.k }, coerce(a)));
  const hidden = Array.isArray(s.hidden) ? [...new Set(s.hidden.filter((k) => typeof k === "string"))] : [];
  /* seq must stay above every key in use, or a restored backup could hand out a key twice. Only
     keys that are safe integers count: past that, +1 stops advancing and keys would repeat. */
  const used = added.map((a) => Number(a.k.match(OWN)[1])).filter((n) => Number.isSafeInteger(n));
  const top = used.length ? Math.max(...used) : 0;
  const seq = Math.max(Number.isSafeInteger(s.seq) && s.seq > 0 ? s.seq : 0, top);
  return { seq, changed, added, hidden };
}

/** One list for the tab: researched rows that are not hidden, in order, then the user's own. */
export function mergeSources(base, src) {
  const s = normaliseSrc(src);
  const hidden = new Set(s.hidden);
  const rows = (base || []).filter((b) => !hidden.has(b.k)).map((b) => {
    const ch = s.changed[b.k] || {};
    const row = { k: b.k };
    for (const f of SOURCE_FIELDS) row[f] = ch[f] !== undefined ? ch[f] : b[f];
    row.t = [...(row.t || [])];
    /* Who the source is for — the markets it covers and the language it asks of a
       candidate. Carried from the base row rather than added to SOURCE_FIELDS:
       it describes the channel, so it is not the user's to edit or to store. */
    row.m = [...(b.m || [])];
    row.l = [...(b.l || [])];
    row.contact = { ...blankContact(), ...(ch.contact || {}) };
    row.own = false;
    row.changed = Object.keys(ch).length > 0;
    return row;
  });
  for (const a of s.added) {
    rows.push({ k: a.k, n: a.n || "", u: a.u || "", w: a.w || "", t: [...(a.t || [])], m: [], l: [],
      contact: { ...blankContact(), ...(a.contact || {}) }, own: true, changed: false });
  }
  return rows;
}

/**
 * @param patch  any of n, u, w, t, contact — already cleaned by cleanSource / cleanContact.
 *               A contact with every field empty removes the stored contact.
 */
export function updateSource(src, base, k, patch) {
  const s = normaliseSrc(src);
  const p = isObj(patch) ? patch : {};
  const researched = (base || []).find((b) => b.k === k);
  if (researched) {
    const entry = { ...(s.changed[k] || {}) };
    for (const f of SOURCE_FIELDS) {
      if (p[f] === undefined) continue;
      if (same(p[f], researched[f])) delete entry[f];
      else entry[f] = copy(p[f]);
    }
    if (p.contact !== undefined) {
      if (hasContact(p.contact)) entry.contact = { ...blankContact(), ...copy(p.contact) };
      else delete entry.contact;
    }
    if (Object.keys(entry).length) s.changed[k] = entry;
    else delete s.changed[k];
    return s;
  }
  const i = s.added.findIndex((a) => a.k === k);
  if (i < 0) return s;
  const row = { ...s.added[i] };
  for (const f of SOURCE_FIELDS) if (p[f] !== undefined) row[f] = copy(p[f]);
  if (p.contact !== undefined) {
    if (hasContact(p.contact)) row.contact = { ...blankContact(), ...copy(p.contact) };
    else delete row.contact;
  }
  s.added[i] = row;
  return s;
}

/**
 * Keys are own-1, own-2, … and never reused, even after a removal. A key already in the list is
 * always skipped; only a hand-made backup can push the counter to the largest safe integer, and then
 * it starts again from 1 rather than handing out the same key twice.
 */
export function addSource(src, fields) {
  const s = normaliseSrc(src);
  const f = isObj(fields) ? fields : {};
  const taken = new Set(s.added.map((a) => a.k));
  do s.seq = Number.isSafeInteger(s.seq + 1) ? s.seq + 1 : 1;
  while (taken.has(`own-${s.seq}`));
  const k = `own-${s.seq}`;
  const row = { k, n: f.n || "", u: f.u || "", w: f.w || "", t: copy(f.t || []) };
  if (hasContact(f.contact)) row.contact = { ...blankContact(), ...copy(f.contact) };
  s.added.push(row);
  return { src: s, k };
}

/** A source the user added is deleted; a researched one is hidden, keeping its changes for a restore. */
export function removeSource(src, k) {
  const s = normaliseSrc(src);
  if (OWN.test(String(k))) s.added = s.added.filter((a) => a.k !== k);
  else if (!s.hidden.includes(k)) s.hidden.push(k);
  return s;
}

export function restoreHidden(src) {
  const s = normaliseSrc(src);
  s.hidden = [];
  return s;
}

export function resetSource(src, k) {
  const s = normaliseSrc(src);
  delete s.changed[k];
  return s;
}

/* ---------- validation ---------- */

const httpUrl = (v) => {
  try { const u = new URL(v); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; }
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/;
const PHONE_CHARS = /^\+?[\d\s().\/-]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const trim = (v) => String(v === undefined || v === null ? "" : v).trim();

/** @returns {{ok: boolean, fields: {n, u, w, t: string[]}, errors: Object<string, string>}} */
export function cleanSource(fields) {
  const f = isObj(fields) ? fields : {};
  const errors = {};
  const n = trim(f.n);
  const u = trim(f.u);
  const w = trim(f.w);
  const t = (Array.isArray(f.t) ? f.t : String(f.t || "").split(",")).map(trim).filter(Boolean);
  if (!n) errors.n = "A name is required.";
  else if (n.length > 120) errors.n = "At most 120 characters.";
  if (u && !httpUrl(u)) errors.u = "Use an http or https link.";
  if (w.length > 600) errors.w = "At most 600 characters.";
  if (t.length > 8) errors.t = "At most 8 tags.";
  else if (t.some((x) => x.length > 30)) errors.t = "Each tag at most 30 characters.";
  return { ok: !Object.keys(errors).length, fields: { n, u, w, t }, errors };
}

/** @returns {{ok: boolean, contact: Object<string, string>, errors: Object<string, string>}} */
export function cleanContact(contact) {
  const c = isObj(contact) ? contact : {};
  const out = Object.fromEntries(CONTACT_FIELDS.map((f) => [f, trim(c[f])]));
  // A value's source goes with the value: clearing an email clears where it was found.
  if (!out.email) out.emailFrom = "";
  if (!out.phone) out.phoneFrom = "";
  const errors = {};
  if (out.email && !EMAIL.test(out.email)) errors.email = "That is not a complete email address.";
  const digits = out.phone.replace(/\D/g, "").length;
  if (out.phone && (!PHONE_CHARS.test(out.phone) || digits < 7 || digits > 15)) errors.phone = "Use digits, spaces and + ( ) - . / only, 7 to 15 digits.";
  for (const f of ["emailFrom", "phoneFrom"]) if (out[f] && !httpUrl(out[f])) errors[f] = "Only an http or https page can be the source.";
  for (const f of ["person", "role"]) if (out[f].length > 120) errors[f] = "At most 120 characters.";
  if (out.checked && !DATE.test(out.checked)) errors.checked = "Use YYYY-MM-DD.";
  return { ok: !Object.keys(errors).length, contact: out, errors };
}
