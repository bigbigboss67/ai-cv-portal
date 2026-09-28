/**
 * Saved listings: what goes into localStorage and what comes back out.
 * Pure apart from the storage object it is handed, so Node tests pass a fake.
 *
 * Only inputs are stored — the listing as read and as corrected. The verdict is
 * never stored: it is recomputed against whatever CV is loaded, so a new CV
 * re-scores every saved listing. The image or file itself is never stored.
 */

export const INTAKE_KEY = "cdm-intake-v1";

const FIELDS = ["id", "r", "co", "city", "wt", "lang", "posted", "u", "site", "to", "text",
  "duties", "requirements", "instructions", "source", "readAt"];
const STRING_FIELDS = ["id", "r", "co", "city", "wt", "lang", "posted", "u", "site", "to", "text", "readAt"];
const LIST_FIELDS = ["duties", "requirements", "instructions"];
const SOURCE_FIELDS = ["kind", "name", "url", "pages", "truncated"];
const REQ_FIELDS = ["text", "strength", "type", "field", "years", "language", "level", "nationality"];
const REQ_TYPES = ["years", "degree", "language", "nationality", "location", "skill"];
const INSTR_KINDS = ["salary", "start", "reference", "attachments"];

/* Saved listings share the browser's storage quota with every letter edit and
   tracker stage, and a page read through a link can carry a whole site's
   navigation. One record stays small enough never to crowd those out. */
export const CAPS = { text: 20000, entries: 80, entry: 400 };

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v) => typeof v === "string";
const absentOr = (v, test) => v === undefined || test(v);
const isHttp = (v) => { try { return isStr(v) && /^https?:$/.test(new URL(v).protocol); } catch { return false; } };
const isEmail = (v) => isStr(v) && /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[a-z]{2,}$/i.test(v.trim());

const validReq = (q) => isObj(q) && isStr(q.text) && (q.strength === "must" || q.strength === "nice")
  && REQ_TYPES.includes(q.type) && absentOr(q.field, isStr) && absentOr(q.level, isStr)
  && (q.type !== "years" || Number.isFinite(q.years))
  && (q.type !== "language" || isStr(q.language))
  && (q.type !== "nationality" || isStr(q.nationality));
const validInstr = (x) => isObj(x) && INSTR_KINDS.includes(x.kind) && isStr(x.text);
const SOURCE_TYPES = { kind: isStr, name: isStr, url: isHttp, pages: Number.isFinite, truncated: (v) => typeof v === "boolean" };

function capReq(q) {
  const o = {};
  for (const k of REQ_FIELDS) if (q[k] !== undefined) o[k] = q[k];
  o.text = o.text.slice(0, CAPS.entry);
  if (isStr(o.field)) o.field = o.field.slice(0, CAPS.entry);
  return o;
}

/**
 * Whitelist the stored shape and cap its size; anything else (a verdict, a File)
 * is dropped. A link that is not http(s), an address that is not an email and a
 * malformed requirement, duty or instruction are dropped as well, because a saved
 * record reaches href attributes, the To field and the fit engine.
 */
export function toRecord(item) {
  const rec = {};
  for (const k of FIELDS) if (item && item[k] !== undefined) rec[k] = item[k];
  if (rec.u !== undefined) rec.u = isHttp(rec.u) ? rec.u : "";
  if (rec.site !== undefined) rec.site = isHttp(rec.site) ? rec.site : "";
  if (rec.to !== undefined) rec.to = isEmail(rec.to) ? rec.to.trim() : "";
  if (isStr(rec.text)) rec.text = rec.text.slice(0, CAPS.text);
  if (Array.isArray(rec.duties)) rec.duties = rec.duties.filter(isStr).slice(0, CAPS.entries).map((d) => d.slice(0, CAPS.entry));
  if (Array.isArray(rec.requirements)) rec.requirements = rec.requirements.filter(validReq).slice(0, CAPS.entries).map(capReq);
  if (Array.isArray(rec.instructions)) rec.instructions = rec.instructions.filter(validInstr).map((x) => ({ kind: x.kind, text: x.text }));
  if (rec.source) {
    const s = {};
    for (const k of SOURCE_FIELDS) if (rec.source[k] !== undefined && SOURCE_TYPES[k](rec.source[k])) s[k] = rec.source[k];
    rec.source = s;
  }
  return JSON.parse(JSON.stringify(rec));
}

/* An item is kept only whole: its id is one this store made, and every field has
   the type the portal reads it as. Storage and backup files are edited by hand
   and by other code, so nothing is trusted on the way back in. */
const validItem = (x) => isObj(x) && isStr(x.id) && /^u-[0-9a-f]{8}$/.test(x.id)
  && STRING_FIELDS.every((k) => absentOr(x[k], isStr))
  && LIST_FIELDS.every((k) => absentOr(x[k], Array.isArray))
  && absentOr(x.source, isObj);

/** A stored `{v, items}` object (from storage or a backup) → its valid items; null unless version 1. */
export function parseIntake(d) {
  return isObj(d) && d.v === 1 && Array.isArray(d.items) ? d.items.filter(validItem).map(toRecord) : null;
}

export function loadIntake(storage) {
  try {
    return parseIntake(JSON.parse((storage && storage.getItem(INTAKE_KEY)) || "null")) || [];
  } catch {
    return [];
  }
}

/** @returns {boolean} false when the browser is not keeping data (private mode, quota, blocked). */
export function saveIntake(storage, items) {
  try {
    if (!storage) return false;
    storage.setItem(INTAKE_KEY, JSON.stringify({ v: 1, items: items.map(toRecord) }));
    return true;
  } catch {
    return false;
  }
}

const sameKey = (s) => String(s || "").toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/* A title loses only its gender marker: "Sales Manager (Dubai)" and "Sales Manager
   (Riyadh)" are two jobs, "General Manager (m/f/d)" is "General Manager". */
const GENDER = /\((?:m\/f\/d|m\/w\/d|f\/m\/d|w\/m\/d|m\/f\/x|d\/f\/m|all genders)\)/gi;
const titleKey = (s) => String(s || "").toLowerCase().replace(GENDER, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Add, or update the saved copy of the same listing — same id, or the same title
 * at the same named company in the same city, arriving by another route (a
 * screenshot, then the link). An update keeps the original id so edits and
 * tracker state saved under it stay attached. Two listings with no company never
 * merge: they would share one address, one letter and one tracker stage.
 */
export function upsertIntake(items, item) {
  const rec = toRecord(item);
  const i = items.findIndex((x) => x.id === rec.id
    || (titleKey(rec.r) && sameKey(rec.co)
      && titleKey(x.r) === titleKey(rec.r) && sameKey(x.co) === sameKey(rec.co) && sameKey(x.city) === sameKey(rec.city)));
  if (i < 0) return { items: [...items, rec], id: rec.id, updated: false };
  const next = items.slice();
  next[i] = { ...rec, id: items[i].id };
  return { items: next, id: items[i].id, updated: true };
}

export const removeIntake = (items, id) => items.filter((x) => x.id !== id);

/** A saved record as a portal listing (the JOBS shape), flagged own. */
export function toJob(rec) {
  return {
    id: rec.id, own: true,
    r: rec.r || "Untitled listing", co: rec.co || "", city: rec.city || "", wt: rec.wt || "Not stated",
    lang: rec.lang === "DE" ? "DE" : "EN", posted: rec.posted || "", u: rec.u || "", site: rec.site || "",
    to: rec.to || "", text: rec.text || "",
    intake: {
      duties: rec.duties || [], requirements: rec.requirements || [], instructions: rec.instructions || [],
      source: rec.source || {}, readAt: rec.readAt || "",
    },
  };
}
