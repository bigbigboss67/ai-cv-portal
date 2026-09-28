/**
 * The CV as a text PDF — the file that is attached and sent.
 *
 * The designed export (pdf.js) photographs the sheet: html2canvas paints it and
 * jsPDF wraps the picture, so an applicant-tracking system that opens it finds
 * no words at all and files the candidate as blank. This writes the same CV as
 * real text in one column, in reading order. The words are read from the
 * rendered sheet itself, so what the candidate sees and edited is exactly what
 * the file says — there is no second copy of the CV to drift.
 *
 * Loaded on first use, versions pinned and hashed: jsPDF (html2pdf bundles one
 * but does not expose it) and Noto Sans, subset into the file, which covers the
 * Latin, Greek and Cyrillic names Helvetica's WinAnsi encoding cannot — jsPDF
 * turns a whole line to noise on one such letter (measured: "Łódź" came out as
 * NUL-separated bytes). Arabic, Hebrew and CJK are refused, not attempted:
 * jsPDF cannot shape them, and a scrambled CV looks fine until someone who
 * reads it opens it. Those go to the print dialog, which keeps real text.
 */

const JSPDF = {
  src: "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js",
  integrity: "sha384-en/ztfPSRkGfME4KIm05joYXynqzUgbsG5nMrj/xEFAHXkeZfO3yMK8QQ+mP7p1/",
};
const FONTS = [
  { file: "NotoSans-Regular.ttf", style: "normal", integrity: "sha384-vGsL7WJCR/ohCuK3cVdWNI2hhL5CFlIIGTkIJfH2SzM29B+6MVXVDU72F6+T/AF5",
    src: "https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-sans@0.4.2/400Regular/NotoSans_400Regular.ttf" },
  { file: "NotoSans-Bold.ttf", style: "bold", integrity: "sha384-DIObf0+zbFhmQJdO1thMYSdf42enWQcfXw1TzQF/HQwQJV8eD5lw54VgeI6l6qxk",
    src: "https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-sans@0.4.2/700Bold/NotoSans_700Bold.ttf" },
];

const MM = 25.4 / 72; // millimetres per point
export const PAGE = Object.freeze({ w: 210, h: 297, ml: 18, mr: 18, mt: 16, mb: 16 });
const SIZE = Object.freeze({ name: 19, head: 10.5, contact: 9, h: 9.5, title: 10.5, date: 9, org: 9.5, body: 9.8, foot: 7.5 });
const IND = 4.2; // bullet text indent, mm

/* Marks the font has no glyph for but CVs use as typography, drawn as their nearest
   equivalent: an arrow as "->", a round or square bullet as "\u2022". Left as they were,
   they came out of the file blank: "20% \u2192 35%" was sent as "20% 35%". */
const TYPO = [[/[\u2192\u21D2\u2794\u279C\u279D\u279E\u27F6\u27A4\u27A2\u21E8\u2B95]/g, "->"], [/[\u2190\u21D0\u27F5\u21E6]/g, "<-"], [/[\u2194\u21D4]/g, "<->"],
  [/\u2265/g, ">="], [/\u2264/g, "<="], [/\u2248/g, "~"],
  [/[\u25CF\u25AA\u25A0\u25C6\u25FE\u25FC\u25BA\u25B8\u25B6\u25E6\u2219\u25CB\u25A1\u25AB\u25C9\u2023\u2043]/g, "\u2022"]];
export const typographic = (s) => TYPO.reduce((t, [re, to]) => t.replace(re, to), String(s));
/* Invisible format characters (zero-width spaces and joiners, soft hyphens, direction
   marks) carried into the text layer as-is and split or merged words for a reader. */
const FORMAT = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFE0E\uFE0F\uFEFF]/g;
const clean = (s) => typographic(String(s == null ? "" : s).normalize("NFC").replace(FORMAT, "")).replace(/\s+/g, " ").trim();
export const cleanText = clean;

/* A list marker typed at the start of a bullet: the PDF draws its own, so the marker
   goes. Check marks, Word's private-use bullets, arrows and shapes are the usual ones;
   '\u2713 Grew revenue' made the whole CV refuse. Only symbols go: "-", "*" and ">" can be
   the candidate's words ("> 20 years", "- 5%"), so they stay, and so does a dash before a
   number. */
const LEAD = /^\s*(?:[\u2022\u25CF\u25AA\u25A0\u25C6\u25FE\u25FC\u25BA\u25B8\u25B6\u25E6\u2219\u25CB\u25A1\u25AB\u25C9\u2756\u2713\u2714\u2705\u2611\u27A4\u27A2\u21E8\u2192\u00B7\u2023\u2043\uF0B7\uF0A7\uF076\uF0D8\uF0FC\uF0A8]\uFE0F?(?:\s+|(?=[^\d\s]))|[\u2013\u2014]\s+(?=\D))/u;
export const bulletText = (s) => clean(String(s == null ? "" : s).replace(FORMAT, "").replace(LEAD, ""));

/* Name each refused character; one that cannot be seen by its code point, or the
   message names nothing the candidate can find. */
export function describeChars(chars) {
  const shown = chars.slice(0, 8).map((c) => (/[\p{Co}\p{Cf}\p{Z}\p{Cc}\p{Cn}\p{M}\uFFFC\uFFFD]/u.test(c) ? "U+" + c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0") : c));
  return shown.join(" ") + (chars.length > 8 ? " and " + (chars.length - 8) + " more" : "");
}

/* ---------- what the file may contain ---------- */

/* What Noto Sans draws, read from the font's own character map (both weights of
   @expo-google-fonts/noto-sans 0.4.2): Latin, Greek, Cyrillic, punctuation and currency.
   Less Devanagari, which it covers but jsPDF cannot shape. A hand-written list let
   arrows and geometric bullets through, and they vanished from the sent file. */
const UNDRAWABLE = /[^\x20-\x7E\u00A0-\u0377\u037A-\u037F\u0384-\u038A\u038C\u038E-\u03A1\u03A3-\u03E1\u03F0-\u052F\u10FB\u1AB0-\u1AC0\u1AC5\u1AC7-\u1ACE\u1C80-\u1C88\u1D00-\u1DF9\u1DFB-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FC4\u1FC6-\u1FD3\u1FD6-\u1FDB\u1FDD-\u1FEF\u1FF2-\u1FF4\u1FF6-\u1FFE\u2000-\u2064\u2066-\u2071\u2074-\u208E\u2090-\u209C\u20A0-\u20C0\u20F0\u2100-\u215F\u2183-\u2184\u2189\u2212\u25CC\u2C60-\u2C7F\u2DE0-\u2E5D\uA640-\uA69F\uA700-\uA7CA\uA7D0-\uA7D1\uA7D3\uA7D5-\uA7D9\uA7F2-\uA7FF\uA92E\uAB30-\uAB6B\uFB00-\uFB06\uFE00\uFE20-\uFE2F\uFEFF]/gu;

/** Characters Noto Sans cannot draw, after the typographic stand-ins above. */
export function undrawable(text) {
  const bad = typographic(String(text).normalize("NFC")).replace(/\s/g, " ").match(UNDRAWABLE);
  return bad ? [...new Set(bad)] : [];
}

/** True when Helvetica's WinAnsi encoding carries every character — the fallback when the font cannot be fetched. */
export function winAnsiOnly(text) {
  return !/[^\u0000-\u00FF\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178]/u.test(String(text));
}

/** Every string the model will print, for the checks above. */
export function modelText(model) {
  const out = [model.name, model.headline, ...model.contact];
  for (const s of model.sections) {
    out.push(s.title);
    for (const j of s.jobs || []) out.push(j.t, j.d, j.c, ...j.bullets);
    out.push(...(s.items || []), ...(s.lines || []).map((l) => l.text));
  }
  return out.filter(Boolean).join("\n");
}

/* ---------- reading the sheet ---------- */

/**
 * The CV sheet as data, in reading order. textContent, not innerText: several
 * styles uppercase the name and job titles in CSS, and the file should carry
 * the words as written. The summary is the exception — innerText keeps the
 * line breaks a candidate typed into it.
 */
export function readSheet(sheet) {
  const txt = (el) => clean(el && el.textContent);
  const hd = sheet.querySelector(".hd");
  const model = {
    name: txt(hd && hd.querySelector("h1")),
    headline: txt(hd && hd.querySelector(".role")),
    contact: hd ? [...hd.querySelectorAll(".meta > div")].map(txt).filter(Boolean) : [],
    sections: [],
  };
  for (const sec of sheet.querySelectorAll("section")) {
    const title = txt(sec.querySelector("h5"));
    const jobs = [...sec.querySelectorAll(".j")];
    const chips = [...sec.querySelectorAll(".chip")];
    if (jobs.length) {
      model.sections.push({ title, jobs: jobs.map((j) => ({
        t: txt(j.querySelector(".t")), d: txt(j.querySelector(".d")), c: txt(j.querySelector(".c")),
        bullets: [...j.querySelectorAll("li")].map((li) => bulletText(li.textContent)).filter(Boolean),
      })) });
    } else if (chips.length) {
      model.sections.push({ title, items: chips.map(txt).filter(Boolean) });
    } else {
      const lines = [];
      for (const el of sec.children) {
        if (el.tagName === "H5") continue;
        if (el.classList.contains("sum")) {
          String(el.innerText || el.textContent || "").split(/\n+/).map(clean).filter(Boolean)
            .forEach((t, k) => lines.push({ text: t, gap: k > 0 }));
          continue;
        }
        // .mini: a <b> is its own line (display:block in every style), the rest follows it.
        let run = "";
        const flush = () => { if (clean(run)) lines.push({ text: clean(run) }); run = ""; };
        for (const n of el.childNodes) {
          if (n.nodeType === 1 && n.tagName === "B") { flush(); if (txt(n)) lines.push({ text: txt(n), bold: true }); }
          else run += n.textContent;
        }
        flush();
      }
      model.sections.push({ title, lines });
    }
  }
  return model;
}

/* ---------- layout (pure: measured by whatever draws it) ---------- */

/**
 * Place the model on A4 pages. `m.width(text, pt, bold)` and
 * `m.split(text, pt, bold, maxMm)` come from the PDF writer, so the layout is
 * measured in the font that draws it. Returns draw operations, one per line.
 *
 * Kept together: a section heading with its first line, a job's title and
 * employer with its first bullet. Page numbers only when there is more than one.
 */
export function layoutCv(model, m, P = PAGE) {
  const ops = [];
  const L = P.ml, R = P.w - P.mr, W = R - L, bottom = P.h - P.mb;
  let p = 0, y = P.mt;
  const lh = (pt, k = 1.32) => pt * MM * k;
  const room = (h) => y + h <= bottom + 1e-6;
  const brk = () => { p += 1; y = P.mt; };
  const put = (text, pt, o = {}) => {
    if (text) ops.push({ k: "t", p, x: o.x == null ? L : o.x, y: y + (o.dy || 0), pt, bold: !!o.bold, tone: o.tone || "ink", text, align: o.align || "left" });
  };
  const rule = (tone, w) => ops.push({ k: "r", p, x1: L, x2: R, y, tone, w });
  const flow = (s, pt, o = {}) => {
    const x = o.x == null ? L : o.x;
    for (const t of m.split(s, pt, !!o.bold, R - x)) {
      if (!room(lh(pt))) brk();
      put(t, pt, { ...o, x });
      y += lh(pt);
    }
  };
  const bullet = (s) => {
    m.split(s, SIZE.body, false, W - IND).forEach((t, k) => {
      if (!room(lh(SIZE.body))) brk();
      if (!k) put("\u2022", SIZE.body, { x: L + 0.6, tone: "ink2" });
      put(t, SIZE.body, { x: L + IND });
      y += lh(SIZE.body);
    });
    y += 0.5;
  };
  const jobHead = (j) => {
    const dW = j.d ? m.width(j.d, SIZE.date, false) : 0;
    const tl = j.t ? m.split(j.t, SIZE.title, true, W - (dW ? dW + 4 : 0)) : [""];
    const cl = j.c ? m.split(j.c, SIZE.org, false, W) : [];
    const b0 = j.bullets.length ? lh(SIZE.body) + 0.8 : 0;
    return { tl, cl, h: tl.length * lh(SIZE.title) + cl.length * lh(SIZE.org) + b0 };
  };

  // Header: name, the candidate's own headline, contact line, rule.
  /* A long name is set smaller, down to 14pt, then wrapped: never past the margin. */
  if (model.name) {
    let pt = SIZE.name;
    while (pt > 14 && m.width(model.name, pt, true) > W) pt -= 1;
    for (const t of m.split(model.name, pt, true, W)) { put(t, pt, { bold: true }); y += lh(pt, 1.2); }
  }
  if (model.headline) flow(model.headline, SIZE.head, { tone: "ink2" });
  if (model.contact.length) { y += 0.8; flow(model.contact.join("  |  "), SIZE.contact, { tone: "mute" }); }
  y += 2; rule("accent", 0.5); y += 3.2;

  let first = true;
  for (const s of model.sections) {
    const jobs = (s.jobs || []).filter((j) => j.t || j.c || j.d || j.bullets.length);
    const items = s.items || [];
    const lines = (s.lines || []).filter((l) => l.text);
    if (!jobs.length && !items.length && !lines.length) continue;

    const headH = lh(SIZE.h) + 2.6;
    const firstH = jobs.length ? jobHead(jobs[0]).h : lh(SIZE.body);
    const gap = first ? 0 : 4;
    if (!room(gap + headH + firstH)) brk(); else y += gap;
    first = false;
    put(clean(s.title).toUpperCase(), SIZE.h, { bold: true });
    y += lh(SIZE.h) + 0.4; rule("line", 0.25); y += 2.2;

    jobs.forEach((j, i) => {
      const H = jobHead(j);
      if (i) { if (!room(2.4 + H.h)) brk(); else y += 2.4; } else if (!room(H.h)) brk();
      H.tl.forEach((t, k) => {
        put(t, SIZE.title, { bold: true });
        if (!k && j.d) put(j.d, SIZE.date, { x: R, align: "right", tone: "mute", dy: (SIZE.title - SIZE.date) * MM * 0.8 });
        y += lh(SIZE.title);
      });
      H.cl.forEach((t) => { put(t, SIZE.org, { tone: "ink2" }); y += lh(SIZE.org); });
      if (j.bullets.length) y += 0.8;
      j.bullets.forEach(bullet);
    });
    if (items.length) flow(items.join("  \u00B7  "), SIZE.body);
    lines.forEach((l) => { if (l.gap) y += 1.6; flow(l.text, SIZE.body, { bold: !!l.bold }); });
  }

  const pages = p + 1;
  if (pages > 1) {
    for (let q = 0; q < pages; q++) {
      ops.push({ k: "t", p: q, x: R, y: bottom + 5, pt: SIZE.foot, bold: false, tone: "mute", foot: true, align: "right",
        text: (model.name && model.name.length <= 60 ? model.name + "  \u00B7  " : "") + (q + 1) + " / " + pages });
    }
  }
  return { ops, pages };
}

/* ---------- loading the writer and the font ---------- */

let writerP = null;
function jsPDFClass() {
  if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (!writerP) {
    writerP = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = JSPDF.src; s.integrity = JSPDF.integrity; s.crossOrigin = "anonymous";
      s.onload = () => (window.jspdf && window.jspdf.jsPDF ? res(window.jspdf.jsPDF) : rej(new Error("The PDF writer loaded without its API.")));
      s.onerror = () => { writerP = null; s.remove(); rej(new Error("The PDF writer could not be downloaded \u2014 check your connection.")); };
      document.head.appendChild(s);
    });
  }
  return writerP;
}

let fontsP = null;
function notoSans() {
  if (!fontsP) {
    fontsP = Promise.all(FONTS.map(async (f) => {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 15000);
      try {
        const r = await fetch(f.src, { integrity: f.integrity, signal: ctl.signal });
        if (!r.ok) throw new Error("font " + r.status);
        const a = new Uint8Array(await r.arrayBuffer());
        let bin = "";
        for (let i = 0; i < a.length; i += 0x8000) bin += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
        return { ...f, b64: btoa(bin) };
      } finally { clearTimeout(t); }
    })).catch((err) => { fontsP = null; throw err; });
  }
  return fontsP;
}

/* ---------- building the file ---------- */

function cvSheet() {
  return document.getElementById("draftCvSheetEl") || [...document.querySelectorAll("#pane .sheet, .cv-sheet")].find((s) => !s.classList.contains("letter")) || null;
}

/**
 * @returns {Promise<{bytes: Uint8Array, pages: number, font: string}>}
 */
export async function buildCvTextPdfBytes() {
  const sheet = cvSheet();
  if (!sheet) throw new Error("No CV sheet on screen \u2014 open the Draft view first.");
  if (sheet.classList.contains("ar")) {
    throw new Error("An Arabic CV needs joined, right-to-left letters this writer cannot shape \u2014 print it to PDF instead.");
  }
  const model = readSheet(sheet);
  if (!model.name && !model.sections.length) throw new Error("The CV sheet is empty.");
  const all = modelText(model);
  const bad = undrawable(all);
  if (bad.length) throw new Error("The CV contains " + describeChars(bad) + ", which this PDF font cannot draw \u2014 change it in the CV, or print it to PDF instead.");

  const J = await jsPDFClass();
  const doc = new J({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  let family = "NotoSans";
  try {
    for (const f of await notoSans()) { doc.addFileToVFS(f.file, f.b64); doc.addFont(f.file, "NotoSans", f.style); }
  } catch (err) {
    // Offline or blocked: Helvetica draws Western European text correctly, and nothing else.
    if (!winAnsiOnly(all)) throw new Error("The font for this CV's characters could not be downloaded \u2014 check your connection, or print it to PDF.");
    family = "helvetica";
  }

  const measure = {
    width(s, pt, bold) { doc.setFont(family, bold ? "bold" : "normal"); doc.setFontSize(pt); return doc.getTextWidth(s); },
    split(s, pt, bold, w) { doc.setFont(family, bold ? "bold" : "normal"); doc.setFontSize(pt); return doc.splitTextToSize(s, w); },
  };
  const { ops, pages } = layoutCv(model, measure);

  const acc = clean(sheet.style.getPropertyValue("--accent"));
  const TONE = { ink: "#1b1b1b", ink2: "#3d3d3d", mute: "#6b6b6b", line: "#d6d3cc", accent: /^#[0-9a-f]{6}$/i.test(acc) ? acc : "#1f3a5f" };
  for (let i = 1; i < pages; i++) doc.addPage();
  for (const o of ops) {
    doc.setPage(o.p + 1);
    if (o.k === "r") { doc.setDrawColor(TONE[o.tone]); doc.setLineWidth(o.w); doc.line(o.x1, o.y, o.x2, o.y); continue; }
    doc.setFont(family, o.bold ? "bold" : "normal"); doc.setFontSize(o.pt); doc.setTextColor(TONE[o.tone]);
    doc.text(o.text, o.x, o.y, { baseline: "top", align: o.align });
  }
  doc.setProperties({ title: (model.name ? model.name + " \u2014 " : "") + "CV", subject: model.headline, author: model.name, creator: "Career Design Master" });
  return { bytes: new Uint8Array(doc.output("arraybuffer")), pages, font: family };
}

/** Build it and hand it to the browser's downloader. */
export async function buildCvTextPdf(filename) {
  const r = await buildCvTextPdfBytes();
  const url = URL.createObjectURL(new Blob([r.bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return r;
}
