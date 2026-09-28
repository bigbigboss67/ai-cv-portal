/**
 * Build the application PDF in the browser and download it — no print dialog.
 *
 * The print route needed "Background graphics" left ticked or the navy and gold
 * vanished, and it is easy to dismiss the dialog by accident. This renders the
 * same sheets straight to a file.
 *
 * Requires html2pdf, already loaded in career-portal.html.
 */

/** Hand a blob to the browser's downloader. */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** Letter first, then CV — the order an employer reads them in. */
function collectSheets() {
  const sheets = [...document.querySelectorAll("#pane .sheet")];
  if (!sheets.length) return null;
  return sheets.sort(
    (a, b) => (b.classList.contains("letter") ? 1 : 0) - (a.classList.contains("letter") ? 1 : 0),
  );
}

/**
 * Stage the sheets for capture.
 *
 * The wrapper must stay in normal flow. html2pdf clones it into a container of
 * its own and measures that container — and a `position:fixed` or `absolute`
 * child contributes no height to its parent, so the container measured 0 and
 * every export came out a blank 3 KB PDF. Hiding is the host's job instead: a
 * clipped 0x0 box keeps the wrapper off the screen while it still lays out.
 * html2pdf stages its own clone off-screen anyway, so nothing here needs to.
 *
 * @returns {{wrap: HTMLElement, host: HTMLElement}}
 */
function stage(sheets) {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;z-index:-1";
  const wrap = document.createElement("div");
  wrap.style.cssText = "width:210mm;background:#fff";
  for (const sh of sheets) {
    const c = sh.cloneNode(true);
    c.style.margin = "0";
    c.style.pageBreakAfter = "always";
    wrap.appendChild(c);
  }
  host.appendChild(wrap);
  document.body.appendChild(host);

  /* Only the last sheet may end a page; a forced break after every sheet is what
     turns a 13mm spill into an extra sheet of paper. */
  const kids = [...wrap.children];
  kids.forEach((c, i) => { c.style.pageBreakAfter = i === kids.length - 1 ? "auto" : "always"; });

  /* html2canvas crashes with an IndexSizeError on text-transform:uppercase when
     the transform changes the character count — CSS uppercases ß to SS, so
     "Kaufmann im Groß- und Außenhandel (IHK Hannover)" (48 chars) measures as 50
     and the character ranges run off the end of the node. Bake the uppercase
     into the clone's text and drop the CSS transform, which renders identically
     and leaves html2canvas a 1:1 mapping. Two passes: collect first, because
     clearing a parent's transform changes what its descendants compute. */
  const upper = [...wrap.querySelectorAll("*")]
    .filter((el) => getComputedStyle(el).textTransform === "uppercase");
  for (const el of upper) {
    for (const n of el.childNodes) if (n.nodeType === 3) n.nodeValue = n.nodeValue.toLocaleUpperCase();
    el.style.textTransform = "none";
  }
  fitToWholePages(wrap);
  return { wrap, host };
}

/**
 * Pull the content back onto a whole number of pages when it only just spills.
 *
 * Measured on the real CV: 310mm of content against A4's 297mm. Thirteen
 * millimetres of overflow produced a second page 5% full and cut a role block
 * exactly at the boundary — the blank half-page people report as "the PDF layout
 * is wrong". A CV that genuinely runs to two pages is left alone; only a small
 * spill is worth tightening, and only down to a floor that still reads well.
 *
 * Tightens in order of least visual cost: outer padding, then leading, then type
 * size. Stops as soon as it fits.
 */
/**
 * Scale every element's type down by `f`.
 *
 * Setting font-size on the sheet alone does nothing here: each child carries its
 * own px size, so nothing inherits. Sizes are read for the whole tree before any
 * are written, because writing a parent changes what its children compute and the
 * reduction would otherwise compound down the tree.
 */
function shrinkText(root, f) {
  const els = [root, ...root.querySelectorAll("*")];
  const sizes = els.map((e) => parseFloat(getComputedStyle(e).fontSize));
  els.forEach((e, i) => { if (sizes[i]) e.style.fontSize = sizes[i] * f + "px"; });
}

/**
 * Scale vertical padding and margin by `f`.
 *
 * Aimed at the whole subtree rather than the sheet, because a themed sheet can
 * carry no padding of its own — Blueprint keeps its spacing on the inner header
 * and column blocks, so squeezing only the outer box changed nothing at all.
 */
function squeezeSpace(root, f) {
  const els = [root, ...root.querySelectorAll("*")];
  const box = els.map((e) => {
    const c = getComputedStyle(e);
    return [parseFloat(c.paddingTop), parseFloat(c.paddingBottom),
            parseFloat(c.marginTop), parseFloat(c.marginBottom)];
  });
  els.forEach((e, i) => {
    const [pt, pb, mt, mb] = box[i];
    if (pt) e.style.paddingTop = pt * f + "px";
    if (pb) e.style.paddingBottom = pb * f + "px";
    if (mt) e.style.marginTop = mt * f + "px";
    if (mb) e.style.marginBottom = mb * f + "px";
  });
}

function fitToWholePages(wrap, pageMm = 297) {
  const pxPerMm = wrap.getBoundingClientRect().width / 210;
  const mm = (el) => el.getBoundingClientRect().height / pxPerMm;

  /* Per sheet, not per document. Every sheet but the last forces a page break, so
     each one occupies its own whole pages — measuring the stack as one lump made
     a letter plus a 13mm-over CV look like a 1.55-page document with too big a
     spill to bother with, and it exported as three pages instead of two. */
  const report = [];
  for (const sheet of wrap.children) {
    const from = mm(sheet);
    const over = from % pageMm / pageMm;
    if (from <= pageMm * 1.02 || over === 0 || over > 0.2) { report.push({ from: Math.round(from), fitted: false }); continue; }
    const target = Math.floor(from / pageMm) * pageMm;
    const steps = [
      () => squeezeSpace(sheet, 0.7),
      () => sheet.querySelectorAll("li,p,.sum").forEach((e) => { e.style.lineHeight = "1.38"; }),
      () => shrinkText(sheet, 0.96),
      () => squeezeSpace(sheet, 0.8),
      () => shrinkText(sheet, 0.96),
    ];
    for (const step of steps) {
      step();
      if (mm(sheet) <= target) break;
    }
    report.push({ from: Math.round(from), to: Math.round(mm(sheet)), fitted: mm(sheet) <= target });
  }
  return report;
}

const opts = (filename) => ({
  margin: 0,
  filename,
  image: { type: "jpeg", quality: 0.97 },
  // scrollX/scrollY pinned to 0: html2canvas offsets fixed-position subtrees by
  // the page scroll, so a capture started from the send buttons far down the
  // Draft view shifted the whole CV toward the bottom of the page by exactly
  // the scrolled distance — the top of the PDF was blank, the bottom cut off.
  html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false, scrollX: 0, scrollY: 0 },
  jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
  pagebreak: { mode: ["css", "legacy"] },
});

/**
 * @param {string} filename
 * @param {"all"|"cv"} which  "cv" drops the cover letter sheet
 * @returns {Promise<{pages:number}>}
 */
/**
 * html2canvas paints text one character range at a time, which is exactly what a
 * cursive, joined script cannot survive: measured on 21 September 2026, every
 * Arabic run came back with its letters disconnected and its word order
 * scrambled — السادة rasterised as الإس اد. Its foreignObject mode keeps the
 * shaping and collapses the layout instead. The browser's own print engine gets
 * it right, so the portal sends Arabic there; this is the backstop for any other
 * caller, because a scrambled PDF looks fine until an Arabic reader opens it.
 */
const RTL_SCRIPT = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFC]/;
function refuseUndrawable(sheets) {
  /* Not only an Arabic document: an Arabic name on an English CV came out of the
     fallback attachment reversed and disconnected. */
  if (sheets.some((s) => s.classList.contains("ar") || RTL_SCRIPT.test(s.textContent))) {
    throw new Error("Arabic or Hebrew script cannot be rasterised — print it to PDF instead (File → Print → Save as PDF).");
  }
}

export async function buildApplicationPdf(filename, which = "all") {
  if (!window.html2pdf) throw new Error("The PDF library did not load — check your connection and reload.");
  let sheets = collectSheets();
  if (!sheets) throw new Error("Nothing rendered to export — open the Draft view first.");
  if (which === "cv") sheets = sheets.filter((s) => !s.classList.contains("letter"));
  if (!sheets.length) throw new Error("No CV sheet found on this draft.");
  refuseUndrawable(sheets);

  const { wrap, host } = stage(sheets);
  try {
    // One pass, then hand the same bytes to the browser. Asking for a canvas to
    // sanity-check and then for the file rasterises twice — measured at roughly
    // double the wait. The blank-page check moves to the output size instead:
    // an empty A4 lands around 3 KB, a real page of this CV in the hundreds.
    const blob = await html2pdf().set(opts(filename)).from(wrap).outputPdf("blob");
    if (!blob || blob.size < 8000) {
      throw new Error("The page rendered blank, so nothing was saved.");
    }
    downloadBlob(blob, filename);
    return { pages: sheets.length, kb: Math.round(blob.size / 1024) };
  } finally {
    host.remove();
  }
}

/**
 * The same render, returned as bytes instead of saved.
 *
 * Used to put the CV inside the mail draft, so Outlook opens with the letter in
 * the body and the CV already attached — the manual attach step was the one part
 * of sending that could still be forgotten.
 *
 * @param {"all"|"cv"} which
 * @returns {Promise<{bytes: Uint8Array, pages: number}>}
 */
export async function buildApplicationPdfBytes(which = "cv") {
  if (!window.html2pdf) throw new Error("The PDF library did not load — check your connection and reload.");
  let sheets = collectSheets();
  if (!sheets) throw new Error("Nothing rendered to export — open the Draft view first.");
  if (which === "cv") sheets = sheets.filter((s) => !s.classList.contains("letter"));
  if (!sheets.length) throw new Error("No CV sheet found on this draft.");
  refuseUndrawable(sheets);

  const { wrap, host } = stage(sheets);
  try {
    // One pass. Asking for the canvas and then for the blob runs the whole
    // rasterisation twice, which is most of the wait before a draft appears.
    // A blank page is caught on the way out instead: an empty A4 PDF lands
    // around 3 KB, and a real page of this CV is hundreds.
    const blob = await html2pdf().set(opts("attachment.pdf")).from(wrap).outputPdf("blob");
    if (!blob || blob.size < 8000) {
      throw new Error("The CV rendered to an empty page, so nothing was attached.");
    }
    return { bytes: new Uint8Array(await blob.arrayBuffer()), pages: sheets.length };
  } finally {
    host.remove();
  }
}

/** A filename an employer can file without renaming it. */
export function applicationFilename(name, role, company) {
  const clean = (s) => String(s || "").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_");
  return [clean(name), clean(role).slice(0, 40), clean(company).slice(0, 28)]
    .filter(Boolean).join("__") + ".pdf";
}
