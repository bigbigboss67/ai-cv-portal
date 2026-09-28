/**
 * LinkedIn's own data export → the portal's profile.
 *
 * LinkedIn does not let another site read a profile page, but it hands every member
 * a copy of their own data: Settings & Privacy → Data privacy → Get a copy of your
 * data. That arrives as a ZIP of CSV files, and it is the complete, compliant source
 * for what a CV needs — every role with its month dates, the full descriptions, the
 * skills and the languages with the level the member chose.
 *
 * The one rule holds here as everywhere: every field comes from a cell the member
 * filled in. Nothing is generated, translated, estimated or filled in. Birth date,
 * address, maiden name, messages and connections are never read into the profile,
 * and a language keeps the level the member picked on LinkedIn — it is never
 * upgraded to "fluent" or "native".
 *
 * Pure: no DOM, no network, no storage. The ZIP is inflated with the platform's own
 * DecompressionStream, so Node tests run exactly what ships and no library is added.
 */
import { mergeProfiles, CAPS } from "./profile-merge.js";

export const EXPORT_HELP =
  "LinkedIn → Settings & Privacy → Data privacy → Get a copy of your data, then drop the ZIP it emails you here.";

/* ------------------------------------------------------------------ ZIP */

const SIG_EOCD = 0x06054b50, SIG_CEN = 0x02014b50, SIG_LOC = 0x04034b50, SIG_Z64_LOC = 0x07064b50;

export class ExportError extends Error {}

async function inflateRaw(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Read a ZIP archive: its central directory, then each entry, stored or deflated.
 *
 * @param {ArrayBuffer|Uint8Array} bytes
 * @param {{filter?: (name: string) => boolean}} [opts]  entries the filter rejects are listed, not inflated
 * @returns {Promise<Array<{name: string, data: Uint8Array|null}>>}  data is null for a filtered-out entry
 */
export async function readZip(bytes, opts = {}) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const filter = typeof opts.filter === "function" ? opts.filter : () => true;
  let end = -1;
  for (let i = u8.length - 22; i >= 0 && i >= u8.length - 65557; i--) {
    if (dv.getUint32(i, true) === SIG_EOCD) { end = i; break; }
  }
  if (end < 0) throw new ExportError("This is not a ZIP file, or it is damaged. Download the export from LinkedIn again.");
  if (end >= 20 && dv.getUint32(end - 20, true) === SIG_Z64_LOC) throw new ExportError("This ZIP uses the ZIP64 format, which this reader does not open. Unzip it and drop the CSV files instead.");
  const count = dv.getUint16(end + 10, true), size = dv.getUint32(end + 12, true), at0 = dv.getUint32(end + 16, true);
  if (count === 0xffff || size === 0xffffffff || at0 === 0xffffffff) throw new ExportError("This ZIP uses the ZIP64 format, which this reader does not open. Unzip it and drop the CSV files instead.");
  const out = [];
  let at = at0;
  for (let k = 0; k < count; k++) {
    if (at + 46 > u8.length || dv.getUint32(at, true) !== SIG_CEN) throw new ExportError("The ZIP's table of contents is damaged. Download the export from LinkedIn again.");
    const flags = dv.getUint16(at + 8, true), method = dv.getUint16(at + 10, true);
    const csize = dv.getUint32(at + 20, true), usize = dv.getUint32(at + 24, true);
    const nameLen = dv.getUint16(at + 28, true), extraLen = dv.getUint16(at + 30, true), commentLen = dv.getUint16(at + 32, true);
    const local = dv.getUint32(at + 42, true);
    const name = new TextDecoder().decode(u8.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    if (flags & 1) throw new ExportError("This ZIP is password-protected. Unzip it on your computer and drop the CSV files instead.");
    if (csize === 0xffffffff || usize === 0xffffffff || local === 0xffffffff) throw new ExportError("This ZIP uses the ZIP64 format, which this reader does not open. Unzip it and drop the CSV files instead.");
    if (!filter(name)) { out.push({ name, data: null }); continue; }
    if (local + 30 > u8.length || dv.getUint32(local, true) !== SIG_LOC) throw new ExportError(`The ZIP entry ${name} is damaged.`);
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const raw = u8.subarray(start, start + csize);
    if (method === 0) out.push({ name, data: raw.slice() });
    else if (method === 8) out.push({ name, data: await inflateRaw(raw) });
    else throw new ExportError(`The ZIP entry ${name} uses compression method ${method}, which this reader does not open. Unzip it and drop the CSV files instead.`);
  }
  return out;
}

/* ------------------------------------------------------------------ CSV */

/**
 * RFC 4180 CSV: quoted fields with embedded commas, doubled quotes and line breaks;
 * CRLF or LF; a leading byte-order mark dropped.
 * @returns {string[][]}
 */
export function parseCsv(text) {
  let s = String(text == null ? "" : text);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const rows = [];
  let row = [], field = "", q = false, i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        q = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === "") { q = true; i++; continue; }
    if (ch === ",") { row.push(field); field = ""; i++; continue; }
    if (ch === "\r" || ch === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
      i += ch === "\r" && s[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += ch; i++;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/* ------------------------------------------------------------------ files */

const hnorm = (h) => String(h || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const clean = (v) => String(v == null ? "" : v).replace(/\r\n?/g, "\n").trim();
const oneLine = (v) => clean(v).replace(/\s+/g, " ");

/* The columns each file is read for, as LinkedIn has named them over the years.
   A column absent from the file is simply empty; an extra column is ignored. */
const COLS = {
  profile: { first: ["first name", "firstname", "given name"], last: ["last name", "lastname", "surname", "family name"],
    headline: ["headline"], summary: ["summary", "about"], geo: ["geo location", "geolocation", "location"] },
  positions: { company: ["company name", "company", "organization name", "organization"], title: ["title", "job title", "position"],
    description: ["description"], location: ["location"], start: ["started on", "start date"], end: ["finished on", "end date"] },
  education: { school: ["school name", "school", "institution"], degree: ["degree name", "degree"], start: ["start date", "started on"],
    end: ["end date", "finished on"], notes: ["notes"], activities: ["activities"] },
  skills: { name: ["name", "skill name", "skill"] },
  languages: { name: ["name", "language"], level: ["proficiency", "level"] },
  certifications: { name: ["name", "certification name"], authority: ["authority", "issuing organization", "issuer"], url: ["url"],
    start: ["started on", "start date", "issued on"], end: ["finished on", "end date", "expires on"] },
  email: { address: ["email address", "email"], confirmed: ["confirmed"], primary: ["primary"] },
  phone: { number: ["number", "phone number"], type: ["type"] },
};

/* Profile.csv columns that exist but are never read into a CV. Named in the report so
   the member sees they were left out on purpose; their values are never touched. */
const PROFILE_NEVER = [["birth date", "Birth Date"], ["address", "Address"], ["maiden name", "Maiden Name"], ["zip code", "Zip Code"],
  ["twitter handles", "Twitter Handles"], ["websites", "Websites"], ["instant messengers", "Instant Messengers"], ["industry", "Industry"]];

/* Files that are personal correspondence or other people's data, never inflated. */
const NEVER_FILES = /messages|connections|invitations|contacts|inbox/i;
/* Files LinkedIn fills in itself (its inferences, ad targeting, job-seeker settings,
   activity logs) or that hold other people's words about the member. None of it is
   text the member wrote for a CV, and a header like "Degrees, Member Schools" must
   never be mistaken for their education, so these are never inflated either. */
const LINKEDIN_OWN = /ad[\s_-]*targeting|ads[\s_-]*clicked|inference|job[\s_-]*seeker|job[\s_-]*applications?|saved[\s_-]*jobs|learning|search[\s_-]*quer|logins?\b|registration|receipts|security|follows|reactions|votes|endorse|recommend|guide|coach|hashtag|saved[\s_-]*items|private[\s_-]*identity|causes/i;
/* The Jobs/ folder of the export is LinkedIn's record of job-site activity. */
const inJobsFolder = (name) => String(name).split("/").slice(0, -1).some((d) => /^jobs$/i.test(d.trim()));
const neverFile = (name) => {
  const base = String(name).split("/").pop();
  return NEVER_FILES.test(base) || LINKEDIN_OWN.test(base) || inJobsFolder(name);
};
/* Archive clutter, not a file of the export: a Mac re-zip adds __MACOSX/ with an
   AppleDouble "._Positions.csv" beside every real file. Skipped without a word. */
const junkEntry = (name) => {
  const n = String(name).replace(/\\/g, "/");
  return /(^|\/)__MACOSX\//i.test(n) || /^\._/.test(n.split("/").pop());
};

function kindByName(name) {
  const n = hnorm(String(name).split("/").pop().replace(/\.csv$/i, ""));
  if (/endorse|recommend/.test(n)) return "";
  if (/^profile\b/.test(n) && !/summary|photo/.test(n)) return "profile";
  if (/position/.test(n)) return "positions";
  if (/education/.test(n)) return "education";
  if (/^skills?\b/.test(n)) return "skills";
  if (/^languages?\b/.test(n)) return "languages";
  if (/certification/.test(n)) return "certifications";
  if (/email/.test(n)) return "email";
  if (/phone/.test(n)) return "phone";
  return "";
}

/* Which column of the header answers each field: an exact name first, then a column
   whose name contains it ("Started On (MM/YY)") for names long enough not to collide. */
function columnsOf(header, kind, exact = false) {
  const H = header.map(hnorm), map = {};
  for (const [field, aliases] of Object.entries(COLS[kind])) {
    let idx = -1;
    for (const a of aliases) { idx = H.indexOf(a); if (idx >= 0) break; }
    if (idx < 0 && !exact) for (const a of aliases) { if (a.length < 5) continue; idx = H.findIndex((h) => h.includes(a)); if (idx >= 0) break; }
    if (idx >= 0) map[field] = idx;
  }
  return map;
}

/* Some files open with a note before the header row. The header is the first row
   that names enough of the file's columns. */
function headerRow(rows, kind) {
  const need = Math.min(2, Object.keys(COLS[kind]).length);
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    if (Object.keys(columnsOf(rows[i], kind)).length >= need) return i;
  }
  return -1;
}

/* A renamed file still says what it is in its header row. Only for the record files:
   a header with first and last names or email addresses is as likely a list of other
   people, so the member's own name and contact come only from files named for them.
   Exact column names only: a contains-match would read "Member Schools" as a school
   and "Degrees" as a degree. */
const SIGNATURE = [["positions", ["company", "title", "start"]], ["education", ["school", "degree"]], ["languages", ["name", "level"]],
  ["certifications", ["name", "authority"]]];
function kindByHeader(rows) {
  for (const [kind, fields] of SIGNATURE) {
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const m = columnsOf(rows[i], kind, true);
      if (fields.every((f) => m[f] !== undefined)) return kind;
    }
  }
  return "";
}

function records(rows, kind) {
  const h = headerRow(rows, kind);
  if (h < 0) return { recs: [], header: [] };
  const cols = columnsOf(rows[h], kind);
  const recs = rows.slice(h + 1)
    .filter((r) => r.some((c) => String(c).trim()))
    .map((r) => Object.fromEntries(Object.entries(cols).map(([f, i]) => [f, r[i] == null ? "" : String(r[i])])));
  return { recs, header: rows[h] };
}

const decodeText = (data) => {
  const t = new TextDecoder("utf-8").decode(data);
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t;
};

/**
 * What was dropped → the export's CSV files as text. A ZIP is opened; a CSV is read
 * as it is; anything else is left to the CV reader.
 *
 * @param {Array<{name: string, bytes: ArrayBuffer|Uint8Array}>} uploads
 * @returns {Promise<{files: Array<{name: string, text: string}>, unread: string[]}>}
 */
export async function readExportFiles(uploads) {
  const files = [], unread = [];
  for (const u of uploads || []) {
    const name = String(u && u.name || "");
    if (/\.zip$/i.test(name) || isZip(u.bytes)) {
      const entries = await readZip(u.bytes, { filter: (n) => /\.csv$/i.test(n) && !neverFile(n) && !junkEntry(n) });
      for (const e of entries) {
        if (junkEntry(e.name)) continue;
        if (e.data) files.push({ name: e.name, text: decodeText(e.data) });
        else unread.push(e.name);
      }
    } else if (junkEntry(name)) {
      continue;
    } else if (/\.csv$/i.test(name)) {
      if (neverFile(name)) unread.push(name);
      else files.push({ name, text: decodeText(u.bytes instanceof Uint8Array ? u.bytes : new Uint8Array(u.bytes)) });
    } else unread.push(name);
  }
  return { files, unread };
}

function isZip(bytes) {
  if (!bytes) return false;
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return u8.length > 4 && u8[0] === 0x50 && u8[1] === 0x4b && u8[2] === 3 && u8[3] === 4;
}

/** Is this drop a LinkedIn data export (a ZIP or its CSV files) rather than a CV document? */
export const isExportUpload = (names) => (names || []).some((n) => /\.(zip|csv)$/i.test(String(n)));

/* ------------------------------------------------------------------ dates */

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_WORDS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
function monthOf(w) {
  const l = String(w).toLowerCase().replace(/\.$/, "");
  if (l.length < 3) return -1;
  return MONTH_WORDS.findIndex((m) => m.startsWith(l) || (l === "sept" && m === "september"));
}

/**
 * One LinkedIn date as the portal writes it: "Jan 2019", "2019". "2019-01" and
 * "01/2019" become "Jan 2019"; anything else is kept exactly as LinkedIn wrote it.
 */
export function fmtDate(raw) {
  const s = oneLine(raw);
  if (!s) return "";
  let m;
  if ((m = s.match(/^([A-Za-z]{3,9}\.?)\s+((?:19|20)\d{2})$/))) { const i = monthOf(m[1]); return i >= 0 ? MON[i] + " " + m[2] : s; }
  if (/^(?:19|20)\d{2}$/.test(s)) return s;
  if ((m = s.match(/^((?:19|20)\d{2})-(\d{1,2})(?:-\d{1,2})?$/)) && +m[2] >= 1 && +m[2] <= 12) return MON[+m[2] - 1] + " " + m[1];
  if ((m = s.match(/^(\d{1,2})\/((?:19|20)\d{2})$/)) && +m[1] >= 1 && +m[1] <= 12) return MON[+m[1] - 1] + " " + m[2];
  return s;
}

/** A role's dates: "Jan 2019 – Mar 2021", or "Jan 2019 – Present" when LinkedIn has no end. */
export function roleDates(start, end) {
  const a = fmtDate(start), b = fmtDate(end);
  if (a) return a + " – " + (b || "Present");
  return b;
}

/* ------------------------------------------------------------------ profile */

/* A description splits only where the member broke it: their own line breaks and
   their own bullet marks. A paragraph of several sentences stays one line. */
const MARK_START = /^\s*(?:[•▪●◦‣·*]|[-–—](?=\s))\s*/;
export function descriptionLines(text) {
  return clean(text)
    .split(/\n|\s[•▪●◦‣]\s/)
    .map((l) => l.replace(MARK_START, "").replace(/\s+/g, " ").trim())
    .filter((l) => l && /[\p{L}\p{N}]/u.test(l));
}

const pickFirst = (recs, pred) => recs.find(pred) || recs[0] || null;
const yes = (v) => /^(yes|true|1|ja|oui|s[ií])$/i.test(oneLine(v));

/**
 * The export's CSV files → a profile in the portal's shape, and a report of what was
 * imported and what was left out.
 *
 * @param {Array<{name: string, text: string}>|Object<string,string>} files
 * @param {{tags?: (text: string) => string[], unread?: string[]}} [opts]
 *   tags: the page's own skill tagger, so roles and lines score like a parsed CV's
 * @returns {{profile: object, report: {imported: string[], skipped: string[], files: {used: string[], ignored: string[]}}}}
 */
export function exportToProfile(files, opts = {}) {
  const list = Array.isArray(files) ? files : Object.entries(files || {}).map(([name, text]) => ({ name, text }));
  const tagsOf = typeof opts.tags === "function" ? (t) => { try { return (opts.tags(t) || []).slice(); } catch { return []; } } : () => [];
  const byKind = {}, used = [], ignored = [...(opts.unread || [])];
  /* Files named for what they hold first, so a renamed copy recognised by its header
     never displaces the real one. */
  const parsed = list.filter((f) => !junkEntry(f.name))
    .map((f) => ({ f, rows: parseCsv(f.text), named: neverFile(f.name) ? null : kindByName(f.name) }));
  /* A file claims its kind only when it has a header row and at least one record, so
     an empty or unreadable file of that name never keeps the real one out. A file
     with a header and no rows still fills a kind nothing else filled. */
  const pending = [];
  const take = (x, kind) => {
    if (!kind || byKind[kind]) { ignored.push(x.f.name); return; }
    const r = records(x.rows, kind);
    if (!r.header.length || !r.recs.length) { pending.push({ x, kind, r }); return; }
    byKind[kind] = r;
    used.push(x.f.name);
  };
  for (const x of parsed) if (x.named) take(x, x.named);
  for (const x of parsed) if (x.named === "") take(x, kindByHeader(x.rows));
  for (const { x, kind, r } of pending) {
    if (byKind[kind] || !r.header.length) { ignored.push(x.f.name); continue; }
    byKind[kind] = r;
    used.push(x.f.name);
  }
  for (const x of parsed) if (x.named === null) ignored.push(x.f.name);
  const imported = [], skipped = [];
  const recs = (k) => (byKind[k] ? byKind[k].recs : []);

  /* Profile.csv: name, headline, summary, where they are. */
  const pr = recs("profile")[0] || {};
  const name = [oneLine(pr.first), oneLine(pr.last)].filter(Boolean).join(" ");
  if (name) imported.push("name");
  if (byKind.profile) {
    const H = byKind.profile.header.map(hnorm);
    const left = PROFILE_NEVER.filter(([k]) => H.includes(k)).map(([, label]) => label);
    if (left.length) skipped.push(left.join(", ") + " — not part of a CV, never imported");
  }

  /* Positions.csv: every role, as dated and worded on LinkedIn. */
  const experience = recs("positions").map((p) => {
    const t = oneLine(p.title), co = oneLine(p.company), loc = oneLine(p.location);
    const d = roleDates(p.start, p.end);
    const lines = descriptionLines(p.description);
    const bullets = lines.map((x) => ({ x, tags: tagsOf(x) }));
    const tags = [...new Set([...tagsOf([t, co].join(" ")), ...bullets.flatMap((b) => b.tags)])];
    /* The place joins the employer the way the CV Builder writes it ("Employer — Place",
       with p beside it), so it prints and round-trips. With no employer the place is
       not put in the employer's field. */
    const role = { t, c: co && loc ? co + " — " + loc : co, d, tags, bullets };
    if (loc) role.p = loc;
    return role;
  }).filter((e) => e.t || e.c || e.d || e.p);
  if (experience.length) imported.push(experience.length + (experience.length === 1 ? " role" : " roles"));
  experience.forEach((e, i) => {
    const miss = [!e.t && "title", !e.c && "employer", !e.d && "dates"].filter(Boolean);
    if (miss.length) skipped.push(`Role ${i + 1} (${e.t || e.c || e.d}) has no ${miss.join(" or ")} on LinkedIn — left empty for you to fill in`);
  });

  /* Education.csv: the qualification as named, the school and the years. */
  const education = recs("education").map((x) => {
    const deg = oneLine(x.degree), school = oneLine(x.school);
    const a = fmtDate(x.start), b = fmtDate(x.end);
    const years = a && b ? a + " – " + b : b || (a ? a + " –" : "");
    return { b: deg || school, s: [deg ? school : "", years].filter(Boolean).join(" — ") };
  }).filter((x) => x.b || x.s);
  if (education.length) imported.push(education.length + (education.length === 1 ? " school" : " schools"));
  if (recs("education").some((x) => oneLine(x.notes) || oneLine(x.activities))) skipped.push("Education notes and activities — kept out of the one-line education entry");

  /* Skills.csv: the member's own skills, in their order. */
  const seen = new Set(), competencies = [];
  let overCap = 0;
  for (const s of recs("skills")) {
    const n = oneLine(s.name);
    if (!n || seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    if (competencies.length >= CAPS.skills) { overCap++; continue; }
    competencies.push([n, n.toLowerCase()]);
  }
  if (competencies.length) imported.push(competencies.length + (competencies.length === 1 ? " skill" : " skills"));
  if (overCap) skipped.push(`${overCap} more skills — the profile keeps the first ${CAPS.skills}, in your LinkedIn order`);

  /* Languages.csv: the level exactly as chosen on LinkedIn. "Full professional
     proficiency" is not rewritten as "fluent", nor anything as "native". */
  const langList = recs("languages").map((l) => {
    const n = oneLine(l.name), lv = oneLine(l.level).toLowerCase();
    return n ? n + (lv ? " (" + lv + ")" : "") : "";
  }).filter(Boolean);
  const langs = [...new Set(langList)].join(" · ");
  if (langList.length) imported.push(langList.length + (langList.length === 1 ? " language" : " languages"));

  /* Certifications.csv: name, issuer and dates in the member's words. */
  const certifications = recs("certifications").map((c) => ({
    name: oneLine(c.name), authority: oneLine(c.authority), d: roleDates(c.start, c.end).replace(/ – Present$/, ""), url: oneLine(c.url),
  })).filter((c) => c.name);
  if (certifications.length) imported.push(certifications.length + (certifications.length === 1 ? " certification" : " certifications"));
  if (byKind.certifications && byKind.certifications.header.map(hnorm).includes("license number")) skipped.push("Certification licence numbers — not printed on a CV");

  /* Contact: the primary email, a mobile number before any other. */
  const em = pickFirst(recs("email").filter((e) => oneLine(e.address)), (e) => yes(e.primary));
  const email = em ? oneLine(em.address) : "";
  const ph = pickFirst(recs("phone").filter((p) => oneLine(p.number)), (p) => /mobile|cell/i.test(oneLine(p.type)));
  const phone = ph ? oneLine(ph.number) : "";
  if (email) imported.push("email");
  if (phone) imported.push("phone");
  const city = oneLine(pr.geo);
  if (city) imported.push("location");

  const headline = oneLine(pr.headline);
  const title = headline || (experience[0] && experience[0].t) || "";
  if (headline) imported.push("headline");
  const summaryText = oneLine(pr.summary);
  if (summaryText) imported.push("summary");

  if (!list.length || !used.length) skipped.push("No LinkedIn export file was recognised — expected Profile.csv, Positions.csv and the rest");
  const profile = {
    name, title: { en: title }, city, phone, email, langs,
    summary: { en: summaryText },
    competencies, experience,
    education: education.length ? education : [{ b: "", s: "" }],
    certifications,
    source: "linkedin-export",
  };
  if (ignored.length) skipped.push(`${ignored.length} other ${ignored.length === 1 ? "file" : "files"} not needed for a CV (${ignored.slice(0, 5).map((n) => String(n).split("/").pop()).join(", ")}${ignored.length > 5 ? ", …" : ""})`);
  return { profile, report: { imported, skipped, files: { used, ignored } } };
}

/** The profile as plain text, for the vacancy matcher — nothing in it the profile does not hold. */
export function profileText(P) {
  const p = P || {}, out = [];
  if (p.name) out.push(p.name);
  if (p.title && p.title.en) out.push(p.title.en);
  const contact = [p.city, p.email, p.phone].filter(Boolean).join(" · ");
  if (contact) out.push(contact);
  if (p.summary && p.summary.en) out.push("", "Summary", p.summary.en);
  if ((p.experience || []).length) {
    out.push("", "Experience");
    for (const e of p.experience) {
      out.push("", [e.t, e.c].filter(Boolean).join(" — "));
      if (e.d) out.push(e.d);
      for (const b of e.bullets || []) out.push("• " + (b && typeof b === "object" ? b.x : b));
    }
  }
  const edu = (p.education || []).filter((x) => x.b || x.s);
  if (edu.length) { out.push("", "Education"); for (const x of edu) out.push([x.b, x.s].filter(Boolean).join(" — ")); }
  if ((p.competencies || []).length) out.push("", "Skills", p.competencies.map((c) => c[0]).join(" · "));
  if (p.langs) out.push("", "Languages", p.langs);
  if ((p.certifications || []).length) {
    out.push("", "Certifications");
    for (const c of p.certifications) out.push([c.name, c.authority, c.d].filter(Boolean).join(" — "));
  }
  return out.join("\n").trim();
}

/** The report in one line for the page. */
export function reportLine(report) {
  const r = report || { imported: [], skipped: [] };
  const got = r.imported.length ? "Read from your LinkedIn export: " + r.imported.join(", ") + "." : "Nothing could be read from that LinkedIn export.";
  return r.skipped.length ? got + " Left out: " + r.skipped.join("; ") + "." : got;
}

/* ------------------------------------------------------------------ merging */

const LEGAL = /\b(llc|l l c|fz llc|fzllc|fze|fzco|ltd|limited|inc|corp|corporation|plc|gmbh|co kg|kg|ag|sa|sarl|bv|nv|pte|pty|group|holding|holdings)\b/g;
const employerKey = (c) => hnorm(String(c || "").split(" — ")[0]).replace(LEGAL, " ").replace(/\s+/g, " ").trim();
const startYear = (d) => { const m = String(d || "").match(/\b(?:19|20)\d{2}\b/); return m ? m[0] : ""; };

function sameRole(a, b) {
  const x = employerKey(a.c), y = employerKey(b.c);
  if (!x || !y) return false;
  const emp = x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x)));
  if (!emp) return false;
  const ya = startYear(a.d), yb = startYear(b.d);
  return ya && yb ? ya === yb : hnorm(a.t) === hnorm(b.t);
}

/**
 * The export and a CV together. The export is the source with the highest
 * precedence for titles, employers and dates: a CV role that is the same job (same
 * employer, same start year) takes the export's title, employer and dates, and keeps
 * its own lines beside the export's. Everything else merges the way profile-merge.js
 * merges any second source — the export first, the CV adding only what is missing.
 *
 * @returns {{profile: object, added: object}}
 */
export function withExport(cvProfile, exportProfile) {
  const none = { filled: [], roles: 0, bullets: 0, skills: 0, capped: false };
  if (!exportProfile) return { profile: JSON.parse(JSON.stringify(cvProfile || {})), added: none };
  if (!cvProfile) return { profile: JSON.parse(JSON.stringify(exportProfile)), added: none };
  const cv = JSON.parse(JSON.stringify(cvProfile));
  const li = exportProfile.experience || [];
  const cvRoles = cv.experience || [];
  /* One export role to at most one CV role. A promotion at the same employer in the
     same year gives two export roles that sameRole cannot tell apart, so the title
     decides first; a CV role with no title match takes an export role only when it is
     the one role at that employer that year. Otherwise it is left as the CV wrote it,
     so a line is never filed under another job's title. */
  const match = new Array(cvRoles.length).fill(-1), taken = new Set();
  cvRoles.forEach((e, i) => {
    const t = hnorm(e.t);
    if (!t) return;
    const j = li.findIndex((r, k) => !taken.has(k) && sameRole(r, e) && hnorm(r.t) === t);
    if (j >= 0) { match[i] = j; taken.add(j); }
  });
  cvRoles.forEach((e, i) => {
    if (match[i] >= 0) return;
    const cand = li.map((r, k) => k).filter((k) => sameRole(li[k], e));
    if (cand.length === 1 && !taken.has(cand[0])) { match[i] = cand[0]; taken.add(cand[0]); }
  });
  cv.experience = cvRoles.map((e, i) => {
    const m = match[i] >= 0 ? li[match[i]] : null;
    return m ? { ...e, t: m.t, c: m.c, d: m.d } : e;
  });
  return mergeProfiles(exportProfile, cv);
}
