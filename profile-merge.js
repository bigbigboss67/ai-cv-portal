/**
 * A second source beside the CV — a LinkedIn profile export, a personal site, or
 * pasted profile text — read and merged into the profile the CV produced.
 *
 * Why merge and not replace: the CV is the document the person controls and has
 * checked, so it wins every field it fills. LinkedIn carries what the CV cut for
 * space — older roles, the bullets that did not fit, the skills list — so the
 * second source may only add what is missing. A merged profile therefore holds
 * nothing neither source actually said.
 *
 * Pure: no DOM, no network, no storage. The page reads the file or the link and
 * hands the text in, so Node tests run exactly what ships.
 */

/* ------------------------------------------------------------------ sources */

export const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };

/* Kept here rather than imported from intake-read.js: that module pulls in the
   document and OCR readers, and this one must stay loadable on its own. */
export const isLinkedInHost = (u) => { const h = hostOf(u); return h === "linkedin.com" || h.endsWith(".linkedin.com") || h === "lnkd.in"; };

export const LINKEDIN_HELP =
  "LinkedIn does not let other sites read a profile page. Open your profile on LinkedIn, press More → Save to PDF, and drop that file here instead — or paste the profile text into this box.";

/** A bare domain typed without a scheme is still a link: "rassem.ae/about". */
const BARE_URL = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+(?::\d+)?(?:[/?#]\S*)?$/i;

/**
 * What the one "LinkedIn or website" box was given.
 * @returns {{kind:'empty'}|{kind:'linkedin', url:string}|{kind:'url', url:string}|{kind:'text', text:string}}
 */
export function classifySource(value) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return { kind: "empty" };
  const oneLine = !/\s/.test(raw);
  let url = "";
  if (oneLine && /^https?:\/\//i.test(raw)) url = raw;
  else if (oneLine && BARE_URL.test(raw)) url = "https://" + raw;
  if (url) {
    if (isLinkedInHost(url)) return { kind: "linkedin", url };
    return { kind: "url", url };
  }
  return { kind: "text", text: raw };
}

/** How a source is named back to the person, e.g. "linkedin-profile.pdf" or "rassem.ae". */
export function sourceLabel(src) {
  if (!src) return "";
  if (src.kind === "file") return src.name || "a file";
  if (src.kind === "url") return hostOf(src.url) || src.url;
  if (src.kind === "text") return "pasted text";
  return src.kind;
}

/** A LinkedIn PDF export announces itself; the label should say so rather than "a file". */
export function looksLikeLinkedInExport(text, name) {
  const t = String(text || "").slice(0, 4000);
  return /linkedin\.com\/in\//i.test(t) || /\bwww\.linkedin\.com\b/i.test(t) || /linkedin/i.test(String(name || ""));
}

/* ------------------------------------------------------------------ merging */

/* A merged profile is stored in the browser and re-read on every visit, so it
   stays small enough to sit beside the saved matches and letter edits. */
export const CAPS = { roles: 14, bullets: 12, skills: 48, bulletChars: 400 };

const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const nonEmpty = (s) => typeof s === "string" && s.trim() !== "";

/** The year a role ended: "present" and its translations sort to the top. */
export function endYear(dates) {
  const d = String(dates || "").toLowerCase();
  if (/\b(present|current|now|heute|aktuell|today|ongoing)\b/.test(d)) return 9999;
  const years = d.match(/\b(19|20)\d{2}\b/g);
  return years && years.length ? Math.max(...years.map(Number)) : 0;
}

const bulletText = (b) => (b && typeof b === "object" ? b.x : b) || "";

/* Two tellings of the same duty: the same words, or one wholly inside the other.
   The CV's wording is the one the person checked, so the CV's copy is the one kept. */
function sameBullet(a, b) {
  const x = norm(bulletText(a)), y = norm(bulletText(b));
  if (!x || !y) return false;
  if (x === y) return true;
  return x.length >= 40 && y.length >= 40 && (x.includes(y) || y.includes(x));
}

const roleKey = (e) => norm(e && e.t) + "|" + norm(e && e.c);

/* The portal spreads e.tags and b.tags when it scores a vacancy against the
   profile, so every role and every line must carry one — a merged entry that
   lost its tags would throw there rather than here. */
const safeBullet = (b) => ({ ...(b && typeof b === "object" ? b : {}), x: String(bulletText(b)).slice(0, CAPS.bulletChars), tags: Array.isArray(b && b.tags) ? b.tags : [] });
const safeRole = (e) => ({ ...e, tags: Array.isArray(e.tags) ? e.tags : [], bullets: (e.bullets || []).slice(0, CAPS.bullets).map(safeBullet) });

function mergeRole(base, add) {
  const bullets = (base.bullets || []).map(safeBullet);
  let gained = 0;
  for (const b of add.bullets || []) {
    if (bullets.some((x) => sameBullet(x, b))) continue;
    if (bullets.length >= CAPS.bullets) break;
    const safe = safeBullet(b);
    if (!safe.x.trim()) continue;
    bullets.push(safe);
    gained++;
  }
  /* LinkedIn usually dates a role to the month where a CV gives only years. The
     longer string is the more precise one, and only fills a gap the CV left. */
  const d = nonEmpty(base.d) ? base.d : add.d || "";
  return { role: { ...base, d, bullets }, gained };
}

/**
 * Merge a second source's profile into the CV's.
 *
 * @param {object} base   the profile read from the CV — wins every field it fills
 * @param {object} add    the profile read from the second source
 * @returns {{profile: object, added: {filled: string[], roles: number, bullets: number, skills: number, capped: boolean}}}
 */
export function mergeProfiles(base, add) {
  const out = JSON.parse(JSON.stringify(base || {}));
  const src = add || {};
  const added = { filled: [], roles: 0, bullets: 0, skills: 0, capped: false };
  if (!add) return { profile: out, added };

  for (const k of ["name", "city", "phone", "email", "nationality"]) {
    if (!nonEmpty(out[k]) && nonEmpty(src[k])) { out[k] = src[k]; added.filled.push(k); }
  }
  /* The language line is one string; the longer one names more languages. */
  if (nonEmpty(src.langs) && String(src.langs).length > String(out.langs || "").length) {
    if (!nonEmpty(out.langs)) added.filled.push("langs");
    out.langs = src.langs;
  }

  out.summary = { ...(out.summary || {}) };
  for (const [lang, text] of Object.entries(src.summary || {})) {
    if (!nonEmpty(text)) continue;
    if (String(out.summary[lang] || "").trim().length >= String(text).trim().length) continue;
    if (!nonEmpty(out.summary[lang])) added.filled.push("summary");
    out.summary[lang] = text;
  }

  const title = out.title && nonEmpty(out.title.en) ? out.title : src.title;
  if (title) out.title = title;

  /* Skills: the CV's order is kept and the second source's extras go after it. */
  const comps = (out.competencies || []).slice();
  const seenComp = new Set(comps.map((c) => norm(c[0])));
  for (const c of src.competencies || []) {
    const key = norm(c && c[0]);
    if (!key || seenComp.has(key)) continue;
    if (comps.length >= CAPS.skills) { added.capped = true; break; }
    seenComp.add(key);
    comps.push(c);
    added.skills++;
  }
  out.competencies = comps;

  const roles = (out.experience || []).map(safeRole);
  const byKey = new Map(roles.map((e, i) => [roleKey(e), i]));
  for (const e of src.experience || []) {
    const key = roleKey(e);
    if (!key.replace("|", "").trim()) continue;
    if (byKey.has(key)) {
      const { role, gained } = mergeRole(roles[byKey.get(key)], e);
      roles[byKey.get(key)] = role;
      added.bullets += gained;
      continue;
    }
    if (roles.length >= CAPS.roles) { added.capped = true; break; }
    byKey.set(key, roles.length);
    roles.push({ ...safeRole(e), from: "add" });
    added.roles++;
  }
  /* Newest first, and a role with no date at all keeps its place at the end. */
  out.experience = roles
    .map((e, i) => ({ e, i, y: endYear(e.d) }))
    .sort((a, b) => b.y - a.y || a.i - b.i)
    .map((x) => x.e);

  const edu = (out.education || []).filter((x) => nonEmpty(x.b) || nonEmpty(x.s));
  const seenEdu = new Set(edu.map((x) => norm(x.b) + "|" + norm(x.s)));
  for (const x of src.education || []) {
    const key = norm(x && x.b) + "|" + norm(x && x.s);
    if (key === "|" || seenEdu.has(key)) continue;
    seenEdu.add(key);
    edu.push(x);
  }
  out.education = edu.length ? edu : out.education;

  return { profile: out, added };
}

/** One text for the matcher: both sources, the CV first, capped like the server caps it. */
export function mergeText(cvText, addText, max = 60000) {
  const a = String(cvText || "").trim();
  const b = String(addText || "").trim();
  if (!b) return a.slice(0, max);
  if (!a) return b.slice(0, max);
  return (a + "\n\n" + b).slice(0, max);
}

/** What the second source actually contributed, in one sentence — or why it contributed nothing. */
export function addedSummary(added, label) {
  const parts = [];
  if (added.roles) parts.push(added.roles + (added.roles === 1 ? " role" : " roles"));
  if (added.bullets) parts.push(added.bullets + (added.bullets === 1 ? " line" : " lines") + " under roles you already had");
  if (added.skills) parts.push(added.skills + (added.skills === 1 ? " skill" : " skills"));
  if (added.filled.length) parts.push("your " + added.filled.join(", "));
  const who = label ? String(label) : "the second source";
  if (!parts.length) return `Nothing new from ${who} — everything it holds is already in your CV.`;
  return `Added from ${who}: ${parts.join(", ")}.`;
}
