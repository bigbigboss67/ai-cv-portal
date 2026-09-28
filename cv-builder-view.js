/**
 * The CV Builder tab: the view and event handling around cv-builder.js.
 *
 * career-portal.html only wires this in. vBuild() returns render(ctx), and one
 * delegated click / input / change listener on #pane hands every event inside
 * #cvb to handle(event, ctx). Everything the page owns arrives in ctx:
 *
 *   ctx = { P, edits, source (P_SOURCE: the seed, or the upload as parsed),
 *           real (HAS_REAL_PROFILE), cvbOn (the page applied edits.cvb at load),
 *           key (EDITS_KEY), now, docLangs ['EN',...], cvLang, appLangs,
 *           letterLang, jobs [{r, co}], match(text, needle), vocab {VOCAB, SYN},
 *           save(), render(), setProf(k, v), applyStore() (the page's inline
 *           applyCvbStore), applyAchievements(), backup(), go(tab), confirm(msg),
 *           dom? (tests pass a fake; the browser uses the document) }
 *
 * The one rule holds here as in the core: the view prints the candidate's own
 * text, the core's outputs and fixed labels. It never writes a line, a figure or a
 * translation. Answers to questions are stored and shown back, never printed.
 * The preview is a real '.sheet', so cv-text-pdf.js and pdf.js read it unchanged.
 *
 * View state (step, preview language, market, undo/redo) lives in this module;
 * the built CV itself lives in edits.cvb and in P.
 */
import * as CVB from "./cv-builder.js";
import { defaultMarket } from "./cv-review.js";

/* ------------------------------------------------------------------ helpers */

const S = (v) => (v == null ? "" : String(v));
const esc = (s) => S(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const uniq = (a) => [...new Set(a)];
const STEP_IDS = CVB.STEPS.map((s) => s.id);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LANG_EN = { en: "English", de: "German", ar: "Arabic", fr: "French", es: "Spanish" };
const MARKET_LABEL = { gcc: "UAE / GCC", dach: "DACH", uk: "UK" };
const HDR_TOP = ["name", "email", "phone", "city"];
/* Shortened at a word boundary, so a label never shows half a word the candidate did not write. */
const trunc = (s, n) => { const t = S(s); if (t.length <= n) return t; const cut = t.slice(0, n - 1), sp = cut.lastIndexOf(" "); return (sp > n / 2 ? cut.slice(0, sp) : cut).replace(/[\s,;:.–—-]+$/, "") + "…"; };
/* The id of the element that carries one field's hint. */
export const hid = (path) => "cvbh-" + CVB.fnv1a(S(path));

/* ------------------------------------------------------------------ view state */

const fresh = () => ({ state: null, from: undefined, edits: null, step: null, undo: [], redo: [], typing: null,
  msg: "", focus: null, note: null, hlCode: null, sumCode: null, showEv: -1, showDiff: false, pend: {} });
const VS = fresh();
export function resetView() { Object.assign(VS, fresh()); }
export function viewState() { return VS; }

/* ------------------------------------------------------------------ context */

const built = (ctx) => !!(ctx.edits && ctx.edits.cvb) && ctx.cvbOn !== false;
const codesOf = (ctx) => uniq((ctx.docLangs && ctx.docLangs.length ? ctx.docLangs : ["EN"]).map((c) => S(c).toLowerCase()));

/* The page's workRights(): the candidate's line, or for the built-in profile the
   line it keeps in the nationality field. */
const workRightsOf = (ctx) => S((ctx.P || {}).workRights || (!ctx.real ? (ctx.P || {}).nationality : "") || "").trim();

/* A header value as the candidate last typed it: a quarantined (blocked) value, a
   Draft-sheet override of name/email/phone/city, or the profile's own. */
function hdrValue(ctx, k) {
  const e = ctx.edits || {}, pr = e.prof || {};
  if (typeof pr["blocked." + k] === "string") return pr["blocked." + k];
  if (HDR_TOP.includes(k) && typeof e[k] === "string") return e[k];
  if (k === "workRights") return S((ctx.P || {}).workRights);
  return S((ctx.P || {})[k]);
}

/* What the header prints: blocked values never reach it (previewModel also refuses them). */
function header(ctx) {
  const P = ctx.P || {}, e = ctx.edits || {};
  const eff = (k) => (typeof e[k] === "string" ? e[k] : S(P[k]));
  return {
    name: eff("name"), city: eff("city"), phone: eff("phone"), email: eff("email"),
    workRights: workRightsOf(ctx), availability: S(P.availability), links: S(P.links).split(/[\s,]+/).filter(Boolean),
    nationality: S(P.nationality),
  };
}

function market(ctx) {
  const m = S((ctx.edits || {}).cvbMarket);
  if (MARKET_LABEL[m]) return m;
  try { return defaultMarket(ctx.P || {}, ctx.edits || {}); } catch { return "gcc"; }
}

/* The context the core's checks read. */
export function bctx(ctx) {
  return {
    now: ctx.now || new Date(), docLangs: ctx.docLangs || ["EN"], cvLang: ctx.cvLang || "en", jobs: ctx.jobs || [],
    match: ctx.match, vocab: ctx.vocab, source: ctx.source, real: !!ctx.real, market: market(ctx), header: header(ctx),
    sumOverrides: Object.keys(ctx.edits || {}).filter((k) => /^sum_/.test(k)).length,
  };
}

/** The builder state: the saved build, or the profile as it stands when nothing is built yet. */
export function getState(ctx) {
  const store = ctx.edits && ctx.edits.cvb;
  if (store && VS.state && VS.from === store && VS.edits === ctx.edits) return VS.state;
  if (VS.edits !== ctx.edits) { VS.undo = []; VS.redo = []; VS.typing = null; }
  let st = store && ctx.cvbOn !== false ? CVB.deserialize(store) : null;
  if (!st) st = CVB.fromProfile(ctx.P || {}, bctx(ctx));
  VS.state = st; VS.from = store || undefined; VS.edits = ctx.edits;
  return st;
}

function step(ctx) {
  if (VS.step && STEP_IDS.includes(VS.step)) return VS.step;
  const s = S((ctx.edits || {}).cvbStep);
  return (VS.step = STEP_IDS.includes(s) ? s : "header");
}

function plang(ctx) {
  const codes = codesOf(ctx);
  const saved = S((ctx.edits || {}).cvbLang);
  if (codes.includes(saved)) return saved;
  const st = getState(ctx);
  return codes.includes(st.lang) ? st.lang : codes[0];
}

/* ------------------------------------------------------------------ DOM (browser or test fake) */

const docDom = {
  html(id, h) { const el = typeof document !== "undefined" && document.getElementById(id); if (el) el.innerHTML = h; },
  text(id, t) { const el = typeof document !== "undefined" && document.getElementById(id); if (el) el.textContent = t; },
  prop(id, k, v) { const el = typeof document !== "undefined" && document.getElementById(id); if (el) el[k] = v; },
  el(sel) { return typeof document !== "undefined" ? document.querySelector(sel) : null; },
  caret(sel) { const el = this.el(sel); return el && typeof el.selectionStart === "number" ? el.selectionStart : null; },
  value(sel) { const el = this.el(sel); return el ? S(el.value) : ""; },
  /* Scroll with behavior "auto": smooth scrolling never animates in the app's browser pane. */
  focus(sel, caret) {
    const el = this.el(sel);
    if (!el) return false;
    try { el.scrollIntoView({ behavior: "auto", block: "center" }); } catch { /* old engines */ }
    try { el.focus({ preventScroll: true }); } catch { el.focus(); }
    if (caret != null && typeof el.setSelectionRange === "function") { try { el.setSelectionRange(caret, caret); } catch { /* not a text field */ } }
    el.classList.add("cvb-flash");
    setTimeout(() => el.classList.remove("cvb-flash"), 2000);
    return true;
  },
};
const dom = (ctx) => ctx.dom || docDom;

/* ------------------------------------------------------------------ committing */

function setMsg(ctx, m) { VS.msg = S(m); dom(ctx).html("cvbMsg", esc(VS.msg)); }

/* The first change to the built CV: the index-based Profile edits are folded away
   (they are already in the state, which was read from P), and the Draft-sheet
   overrides of name/email/phone/city move into edits.prof. */
function createFold(ctx) {
  const e = ctx.edits;
  const plan = CVB.creationPlan(e);
  /* A reset's backup (a v:1 store) is kept: only Reset and Undo reset write it. */
  if (!(e.cvbPrev && e.cvbPrev.v === 1)) e.cvbPrev = plan.cvbPrev;
  delete e.xp; delete e.comps;
  if (e.prof) for (const k of plan.deleteProf) delete e.prof[k];
  if (plan.deleteTop.length) {
    e.prof = Object.assign({}, e.prof);
    for (const k of plan.deleteTop) { e.prof[k] = plan.foldToProf[k]; if (ctx.P) ctx.P[k] = plan.foldToProf[k]; delete e[k]; }
  }
}

/* The store applied to P: through the page's own inline applier when there is one,
   so the tab and a reload can never disagree. */
function applyToP(ctx) {
  if (typeof ctx.applyStore === "function") ctx.applyStore();
  else {
    const r = CVB.applyStore(ctx.P, ctx.edits.cvb, {});
    if (r.applied) for (const k of CVB.OWNED) { if (k in r.P) ctx.P[k] = r.P[k]; else delete ctx.P[k]; }
  }
  if (typeof ctx.applyAchievements === "function") ctx.applyAchievements();
}

/* Undo entries whose step also cleared an achievement answer ("Make this my line"):
   entry -> {k, v}, so Undo puts the figure back and Redo clears it again. */
const ACH_STEP = new WeakMap();

/**
 * One change to the built CV. Structural changes re-render the tab; a field edit
 * refreshes only the preview, the step rail and that field's hint, so the caret stays.
 */
export function commit(next, ctx, opt = {}) {
  const prev = getState(ctx);
  if (!opt.noUndo && (!opt.field || VS.typing !== opt.field)) {
    VS.undo.push(prev);
    if (opt.ach) ACH_STEP.set(prev, opt.ach);
    if (VS.undo.length > 50) VS.undo.shift();
    VS.redo = [];
  }
  VS.typing = opt.field || null;
  const e = ctx.edits;
  if (!e.cvb || ctx.cvbOn === false) createFold(ctx);
  const now = ctx.now || new Date();
  e.cvb = CVB.serialize(next, { at: now.toISOString(), src: CVB.sourceHash(ctx.source), owner: CVB.ownerStamp(ctx.source, ctx.real, ctx.key || "") });
  VS.state = CVB.deserialize(e.cvb) || next; VS.from = e.cvb; VS.edits = e;
  ctx.cvbOn = true;
  applyToP(ctx);
  if (typeof ctx.save === "function") ctx.save();
  if (opt.structural) { if (typeof ctx.render === "function") ctx.render(); }
  else refresh(ctx, opt.field);
  return VS.state;
}

/* Only the preview, the rail and one field's hint. */
function refresh(ctx, path) {
  const st = getState(ctx), b = bctx(ctx), V = CVB.validateAll(st, b);
  const d = dom(ctx);
  d.html("cvbPreview", previewHtml(ctx, st, b));
  d.html("cvbRail", railHtml(st, V, ctx));
  if (path) d.html(hid(path), fieldHint(path, st, V));
  if (d.prop) { d.prop("cvbUndo", "disabled", !VS.undo.length); d.prop("cvbRedo", "disabled", !VS.redo.length); d.prop("cvbReset", "disabled", !built(ctx)); }
}

/* An operation result: an error is shown, never forced; "confirm" asks first. */
function run(ctx, fn, opt = { structural: true }) {
  let r = fn(false);
  if (r && r.error === "confirm") {
    if (!(typeof ctx.confirm === "function" && ctx.confirm(r.msg))) return false;
    r = fn(true);
  }
  if (!r || r.error) { setMsg(ctx, (r && r.msg) || "That did not work."); if (opt.structural && typeof ctx.render === "function") ctx.render(); return false; }
  if (r.noop) return false;
  VS.msg = "";
  commit(r.state, ctx, opt);
  return r;
}

/* ------------------------------------------------------------------ hints */

function itemsFor(path, V) {
  const out = [];
  for (const [k, list] of [["e", V.errors], ["w", V.warnings], ["i", V.info]]) for (const it of list) if (it.path === path) out.push({ k, msg: it.msg });
  return out;
}

function findBullet(st, path) {
  const m = /^bullet:([^:]+):(.+)$/.exec(path);
  if (!m) return null;
  const r = st.roles.find((x) => x.id === m[1]);
  return r ? r.bullets.find((x) => x.id === m[2]) || null : null;
}

/** One field's hint: the core's findings for that path, plus the line rules for a bullet. */
export function fieldHint(path, st, V) {
  const h = itemsFor(path, V).map((it) => `<span class="cvb-${it.k}">${esc(it.msg)}</span>`);
  const bl = findBullet(st, path);
  if (bl) for (const x of CVB.bulletHints(bl.x, { origin: bl.orig, lang: st.lang })) h.push(`<span class="cvb-t">${esc(x.msg)}</span>`);
  let m;
  if ((m = /^headline\.([a-z]{2})$/.exec(path)) && S(st.headline[m[1]]).trim()) h.push(`<span class="cvb-t">${S(st.headline[m[1]]).length} characters</span>`);
  if ((m = /^summary\.([a-z]{2})$/.exec(path)) && S(st.summary[m[1]]).trim()) {
    const s = CVB.summaryStats(st.summary[m[1]]);
    h.push(`<span class="cvb-t">${s.words} words · ${s.sentences} sentence${s.sentences === 1 ? "" : "s"}</span>`);
  }
  return h.join("");
}
const hintEl = (path, st, V) => `<span class="cvb-h" id="${hid(path)}">${fieldHint(path, st, V)}</span>`;

/* ------------------------------------------------------------------ rail and preview */

function railHtml(st, V, ctx) {
  const cur = step(ctx);
  return CVB.STEPS.map((s) => {
    const e = V.errors.filter((i) => i.step === s.id).length, w = V.warnings.filter((i) => i.step === s.id).length;
    return `<button class="cvb-step" data-cvb-step="${s.id}" aria-current="${cur === s.id}" aria-label="${esc(s.title)}${e ? ", " + e + " to fix" : ""}${w ? ", " + w + " to check" : ""}"><span>${esc(s.title)}</span>${e ? `<i class="cvb-ne">${e}</i>` : ""}${w ? `<i class="cvb-nw">${w}</i>` : ""}</button>`;
  }).join("");
}

function sectionHtml(sec, L) {
  const h5 = `<h5>${esc(sec.title)}</h5>`;
  if (sec.jobs) return `<section>${h5}${sec.jobs.map((j) => `<div class="j"><div class="top"><div class="t">${esc(j.t)}</div><div class="d">${esc(j.d)}</div></div><div class="c">${esc(j.c)}</div>${j.bullets.length ? `<ul>${j.bullets.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</div>`).join("")}</section>`;
  if (sec.items) return `<section>${h5}<div class="chips">${sec.items.map((x) => `<span class="chip">${esc(x)}</span>`).join("")}</div></section>`;
  const lines = sec.lines || [];
  if (sec.title === L.profile) return `<section>${h5}${lines.map((l) => `<p class="sum">${esc(l.text)}</p>`).join("")}</section>`;
  /* A bold line opens an entry (education); the lines after it belong to it. */
  const blocks = [];
  for (const l of lines) { if (l.bold || !blocks.length) blocks.push([]); blocks[blocks.length - 1].push(l); }
  return `<section>${h5}${blocks.map((b) => `<div class="mini">${b.map((l) => (l.bold ? `<b>${esc(l.text)}</b>` : esc(l.text))).join(" ")}</div>`).join("")}</section>`;
}

/** The live preview: previewModel as a Plain '.sheet', with missing-field markers outside it. */
export function previewHtml(ctx, st = getState(ctx), b = bctx(ctx)) {
  const lang = plang(ctx), mk = market(ctx);
  const m = CVB.previewModel(st, b.header, lang, mk, b);
  const L = CVB.LABELS[lang] || CVB.LABELS.en;
  const pages = CVB.estimatePages(m);
  const years = CVB.careerYears(st, b.now);
  const pageWarn = pages > 2 || (pages > 1 && years && years < 8);
  const ar = lang === "ar";
  const miss = m.missing.length ? `<div class="cvb-miss">${m.missing.map((x) => `<button class="cvb-missb" data-cvb-jump="${esc(x.step)}|${esc(x.for)}">${esc(x.msg)}</button>`).join("")}</div>` : "";
  const info = `<div class="hint cvb-pinfo">${pages ? `About ${pages} page${pages === 1 ? "" : "s"}` : ""}${pageWarn ? ` — ${years && years < 8 ? "one page suits under 8 years" : "two pages is the ceiling"}` : ""}${m.foreign ? ` · ${m.foreign}% of this preview is still in your CV's own language` : ""}${ar ? " · an Arabic CV needs a native speaker's read before it goes out" : ""}</div>`;
  const sheet = `<div class="sheet ivory cvb${ar ? " ar" : ""}"${ar ? ' dir="rtl"' : ""} style="--accent:#1f3a5f">
<div class="hd nophoto"><div><h1>${esc(m.name)}</h1><div class="role">${esc(m.headline)}</div></div><div class="meta">${m.contact.map((c) => `<div>${esc(c)}</div>`).join("")}</div></div>
<div class="body">${m.sections.map((s) => sectionHtml(s, L)).join("")}</div></div>`;
  return miss + info + sheet;
}

/* ------------------------------------------------------------------ step forms */

const btn = (label, attrs, cls = "btn sm") => `<button class="${cls}" ${attrs}>${label}</button>`;
const op = (name, extra = "") => `data-cvb-op="${name}"${extra ? " " + extra : ""}`;

function fld(label, path, value, st, V, { area = false, ph = "", dir = "auto", rows = 2 } = {}) {
  const input = area
    ? `<textarea class="f" data-cvb-f="${esc(path)}" dir="${dir}" rows="${rows}"${ph ? ` placeholder="${esc(ph)}"` : ""}>${esc(value)}</textarea>`
    : `<input class="f" data-cvb-f="${esc(path)}" dir="${dir}" value="${esc(value)}"${ph ? ` placeholder="${esc(ph)}"` : ""} autocomplete="off">`;
  return `<label class="cvb-fld"><span class="lbl">${label}</span>${input}${hintEl(path, st, V)}</label>`;
}

function stepItems(st, V, id) {
  const list = [["e", V.errors], ["w", V.warnings], ["i", V.info]].flatMap(([k, l]) => l.filter((i) => i.step === id).map((i) => ({ ...i, k })));
  if (!list.length) return `<div class="hint cvb-ok">Nothing to fix in this step.</div>`;
  return `<ul class="cvb-items">${list.map(itemLi).join("")}</ul>`;
}
/* A must-fix that may be a false positive (a demonym, a bare date) says so in the
   candidate's words; a label ("Nationality:", "DOB") has no such button. */
const ackBtn = (i) => (i.dismissable && i.hint ? btn(esc(i.ack), op("dismiss", `data-hint="${esc(i.hint)}"`)) : "");
const itemLi = (i) => `<li class="cvb-${i.k}"><button class="cvb-jump" data-cvb-jump="${esc(i.step)}|${esc(i.path)}">${esc(i.msg)}</button>${ackBtn(i)}</li>`;
/* A header value's guard, with the dismissals, the stored nationality and the employers the checks use. */
const hdrGuard = (ctx, k, v) => CVB.guardOf(getState(ctx), { header: header(ctx) })(k, v);

function fHeader(ctx, st, V) {
  const guard = (k) => { const g = hdrGuard(ctx, k, hdrValue(ctx, k)); return g.blocked || g.warn ? `<span class="cvb-${g.blocked ? "e" : "w"}">${esc(g.msg)}</span>${g.blocked ? ackBtn(g) : ""}` : ""; };
  const row = (k, label, ph = "") => `<label class="cvb-fld"><span class="lbl">${label}</span><input class="f" data-cvb-hdr="${k}" value="${esc(hdrValue(ctx, k))}"${ph ? ` placeholder="${esc(ph)}"` : ""} autocomplete="off"><span class="cvb-h" id="${hid("hdr." + k)}">${guard(k)}${fieldHint("hdr." + k, st, V)}</span></label>`;
  const mk = market(ctx);
  const guide = { gcc: "UAE / GCC: mobile with its country code, your work rights or visa line, a driving licence only if you confirm it.",
    dach: "DACH: no nationality, date of birth or marital status on the CV.", uk: "UK: no nationality, date of birth or photo; a right-to-work line only if you confirm it." }[mk];
  const P = ctx.P || {};
  const nat = S(P.nationality).trim();
  return `<div class="hint">${esc(guide)} Header fields are saved to your profile, the same fields Profile edits.</div>
${row("name", "Name")}${row("city", "City, country")}${row("phone", "Phone")}${row("email", "Email")}
${row("workRights", "Work rights (printed)", !ctx.real && nat ? nat : "e.g. EU passport · UAE residence visa")}
${!ctx.real && nat && !S(P.workRights).trim() ? `<div class="hint">Empty, so the built-in line “${esc(nat)}” prints.</div>` : ""}
${row("availability", "Notice period or start date (optional)")}${row("links", "LinkedIn or website (optional)")}
${ctx.real && nat ? `<div class="hint">Nationality — stored, never printed: ${esc(nat)}</div>` : ""}`;
}

function fHeadline(ctx, st, V) {
  const b = bctx(ctx), codes = uniq([st.lang, ...codesOf(ctx)]);
  const ch = CVB.headlineChips(st, b);
  const tgt = VS.hlCode && codes.includes(VS.hlCode) ? VS.hlCode : st.lang;
  const chips = (label, list) => (list.length ? `<div class="cvb-chips"><span class="lbl">${label}</span>${list.map((c) => `<button class="tog" data-cvb-chip="${esc(tgt)}" data-cvb-text="${esc(c)}">${esc(c)}</button>`).join("")}</div>` : "");
  return `<div class="hint">One line under your name: a level or role family you held, the fields your lines show, the places you worked. No adjectives. The role you apply for belongs in the letter, not here.</div>
${codes.map((c) => fld(`Headline — ${esc(LANG_EN[c] || c.toUpperCase())}`, "headline." + c, st.headline[c], st, V)).join("")}
<div class="hint">Your own words to build it from. A click inserts the exact text into the ${esc(LANG_EN[tgt] || tgt)} headline at the cursor.</div>
${chips("Titles you held", ch.titles)}${chips("Fields your lines show", ch.fields)}${chips("Places", ch.places)}`;
}

function fSummary(ctx, st, V) {
  const b = bctx(ctx), codes = uniq([st.lang, ...codesOf(ctx)]);
  const tgt = VS.sumCode && codes.includes(VS.sumCode) ? VS.sumCode : st.lang;
  const years = CVB.careerYears(st, b.now);
  const pp = CVB.proofPoints(st);
  return `<div class="hint">Three or four sentences, 60–90 words, every phrase traceable to a line of your experience. No employer you apply to, no “Focus for”. Nothing is translated for you.${years ? ` Years on your record: ${years}.` : ""}</div>
${codes.map((c) => fld(`Summary — ${esc(LANG_EN[c] || c.toUpperCase())}`, "summary." + c, st.summary[c], st, V, { area: true, rows: 6 })).join("")}
${pp.length ? `<div class="lbl">Your proof points</div><ul class="cvb-pp">${pp.map((p) => `<li><span>${esc(p.x)}</span>${btn("Insert this line", `data-cvb-insert="${esc(p.rid)}|${esc(p.bid)}"`)}</li>`).join("")}</ul><div class="hint">Inserts the line unchanged into the ${esc(LANG_EN[tgt] || tgt)} summary at the cursor.</div>` : ""}`;
}

function datePick(r, side) {
  const v = S(r[side]), y = v.slice(0, 4), mm = v.length > 4 ? v.slice(5, 7) : S(VS.pend[r.id + "|" + side]);
  return `<span class="cvb-date"><select class="f" data-cvb-date="${esc(r.id)}|${side}|m" aria-label="${side === "from" ? "Start" : "End"} month"><option value="">Month</option>${MONTHS.map((m, i) => { const k = String(i + 1).padStart(2, "0"); return `<option value="${k}"${mm === k ? " selected" : ""}>${m}</option>`; }).join("")}</select><input class="f" data-cvb-date="${esc(r.id)}|${side}|y" value="${esc(y)}" inputmode="numeric" maxlength="4" placeholder="Year" aria-label="${side === "from" ? "Start" : "End"} year"></span>`;
}

function fExperience(ctx, st, V) {
  const b = bctx(ctx);
  const cands = CVB.restoreCandidates(st, { source: ctx.source });
  const P = ctx.P || {};
  return `<div class="hint">Four fields on every role: title, employer, place and dates. Newest first. Older roles are condensed, never removed. The builder warns; it never rewrites — “participated” does not become “led”.</div>
<div class="cvb-row">${btn("Add role", op("addRole"))}${btn("Sort by date", op("sortRoles"))}</div>
${st.roles.map((r, i) => {
  const p = "role:" + r.id;
  const pr = (P.experience || []).find((e) => e && e.id === r.id);
  const ach = pr ? (pr.bullets || []).filter((x) => x && x.ach) : [];
  const own = cands.filter((c) => c.o === r.o), other = cands.filter((c) => c.o !== r.o);
  const pick = [...own, ...other];
  return `<div class="cvb-role" id="cvbr-${esc(r.id)}">
<div class="cvb-rhead"><b>Role ${i + 1}${r.t ? " · " + esc(r.t) : ""}</b><span class="cvb-sp"></span>${btn("↑", op("moveRole", `data-rid="${esc(r.id)}" data-d="-1" aria-label="Move role up"`))}${btn("↓", op("moveRole", `data-rid="${esc(r.id)}" data-d="1" aria-label="Move role down"`))}${btn("Remove role", op("removeRole", `data-rid="${esc(r.id)}"`))}</div>
${hintEl(p, st, V)}
<div class="cvb-g2">${fld("Job title", p + ".t", r.t, st, V)}${fld("Employer", p + ".c", r.c, st, V)}${fld("Group (optional)", p + ".g", r.g, st, V)}${fld("Place", p + ".p", r.p, st, V)}</div>
<div class="cvb-dates"><label class="cvb-fld"><span class="lbl">From</span>${datePick(r, "from")}${hintEl(p + ".from", st, V)}</label>
<label class="cvb-fld"><span class="lbl">To</span>${r.now ? `<span class="hint">Present</span>` : datePick(r, "to")}${hintEl(p + ".to", st, V)}</label>
<label class="cvb-chk"><input type="checkbox" data-cvb-chk="${esc(p)}.now"${r.now ? " checked" : ""}> Present</label></div>
${r.dDirty && !(S(r.d).trim() && (!r.from || (!r.to && !r.now))) ? "" : fld("Dates as written on your CV", p + ".d", r.d, st, V)}
<div class="cvb-g2">${fld("Note (optional, e.g. held in parallel)", p + ".note", r.note, st, V)}<label class="cvb-chk"><input type="checkbox" data-cvb-chk="${esc(p)}.earlier"${r.earlier ? " checked" : ""}> Print as one “Earlier career” line${hintEl(p + ".earlier", st, V)}</label></div>
<div class="lbl">Lines</div>
${r.bullets.map((bl, k) => {
  const bp = "bullet:" + r.id + ":" + bl.id;
  const pts = CVB.splitPoints(bl.x);
  return `<div class="cvb-bl"><textarea class="f" data-cvb-f="${esc(bp)}" dir="auto" rows="${Math.max(2, Math.ceil(S(bl.x).length / 88))}" aria-label="Line ${k + 1}">${esc(bl.x)}</textarea>
<div class="cvb-row">${btn("↑", op("moveBullet", `data-rid="${esc(r.id)}" data-bid="${esc(bl.id)}" data-d="-1" aria-label="Move line up"`))}${btn("↓", op("moveBullet", `data-rid="${esc(r.id)}" data-bid="${esc(bl.id)}" data-d="1" aria-label="Move line down"`))}${btn("Split at cursor", op("split", `data-rid="${esc(r.id)}" data-bid="${esc(bl.id)}"`))}${pts.length ? btn("Split at “;” / “.”", op("splitAt", `data-rid="${esc(r.id)}" data-bid="${esc(bl.id)}" data-at="${pts[0]}"`)) : ""}${k + 1 < r.bullets.length ? btn("Merge with next", op("merge", `data-rid="${esc(r.id)}" data-bid="${esc(bl.id)}"`)) : ""}${st.roles.length > 1 ? `<select class="f cvb-sel" data-cvb-moveto="${esc(r.id)}|${esc(bl.id)}" aria-label="Move this line to another role"><option value="">Move to role…</option>${st.roles.filter((x) => x.id !== r.id).map((x) => `<option value="${esc(x.id)}">${esc(trunc(x.t || x.c || "Role", 40))}${x.c && x.t ? " · " + esc(trunc(x.c, 30)) : ""}</option>`).join("")}</select>` : ""}${btn("Delete", op("removeBullet", `data-rid="${esc(r.id)}" data-bid="${esc(bl.id)}"`))}</div>
${hintEl(bp, st, V)}</div>`;
}).join("")}
${ach.map((a) => `<div class="cvb-bl cvb-ach"><div class="hint">Written from your figure answer — the wording around it is the portal's. Edit the figure in its achievement box on Profile, or make it your own line.</div><div class="cvb-achx">${esc(a.x)}</div>${btn("Make this my line", op("ownLine", `data-rid="${esc(r.id)}" data-achkey="${esc(a.ach)}"`))}</div>`).join("")}
<div class="cvb-row">${btn("Add a line you write", op("addBullet", `data-rid="${esc(r.id)}"`))}${pick.length ? `<select class="f cvb-sel" data-cvb-restore="${esc(r.id)}" aria-label="Restore a line from your uploaded CV"><option value="">Restore a line from your ${ctx.real ? "uploaded CV" : "built-in profile"}…</option>${pick.map((c) => `<option value="${cands.indexOf(c)}">${esc(trunc(c.text, 80))}${c.o !== r.o ? " — from " + esc(trunc(c.c || c.t, 30)) : ""}</option>`).join("")}</select>` : ""}</div>
</div>`;
}).join("")}`;
}

function fSkills(ctx, st, V) {
  const b = bctx(ctx);
  const sug = CVB.suggestComps(st, b).filter((s) => S(s.label).trim());
  return `<div class="hint">8–10 plain keywords, hard skills first, only those a line of yours shows. Tools exactly as you name them. Unticked skills stay here and are not printed.</div>
<ul class="cvb-comps">${st.comps.map((c, i) => {
  const ev = CVB.evidenceFor(st, c, b);
  return `<li><label class="cvb-chk"><input type="checkbox" data-cvb-print="${i}"${c.printed ? " checked" : ""} aria-label="Print ${esc(c.n)}"></label>
<input class="f" data-cvb-compname="${i}" value="${esc(c.n)}" aria-label="Skill name">
<button class="tog" data-cvb-op="showEv" data-i="${i}" aria-pressed="${VS.showEv === i}">${ev.length} line${ev.length === 1 ? "" : "s"}</button>
${btn("↑", op("moveComp", `data-i="${i}" data-d="-1" aria-label="Move skill up"`))}${btn("↓", op("moveComp", `data-i="${i}" data-d="1" aria-label="Move skill down"`))}${btn("×", op("removeComp", `data-i="${i}" aria-label="Remove skill"`))}
${hintEl("comp:" + i, st, V)}${VS.showEv === i && ev.length ? `<ul class="cvb-ev">${ev.map((x) => `<li>${esc(x.x)}</li>`).join("")}</ul>` : ""}</li>`;
}).join("")}</ul>
<form class="cvb-row" id="cvbSkillForm"><input class="f" id="cvbSkillNew" placeholder="Add a skill, as you would name it" aria-label="New skill">${btn("Add", op("addSkill", 'type="submit"'))}</form>
<div class="cvb-row">${btn("Untick skills no line shows", op("hideUnev"))}</div>
${sug.length ? `<div class="lbl">Suggested from your lines</div><ul class="cvb-comps">${sug.map((s) => `<li><span>${esc(s.label)}</span><span class="hint">${s.evidence.length} line${s.evidence.length === 1 ? "" : "s"} · portal term: ${esc(s.hint)}</span>${btn("Add", op("addComp", `data-name="${esc(s.label)}" data-tag="${esc(s.tag)}"`))}</li>`).join("")}</ul>` : ""}
${hintEl("skills", st, V)}
${fld("Technical skills (as you name them)", "technical", st.technical, st, V)}`;
}

function fEducation(ctx, st, V) {
  return `<div class="hint">Every entry prints. The credential in its original name; a gloss only if you write one. Nothing is glossed or translated for you.</div>
${st.education.map((e, i) => `<div class="cvb-role"><div class="cvb-rhead"><b>Education ${i + 1}</b><span class="cvb-sp"></span>${btn("↑", op("moveEdu", `data-i="${i}" data-d="-1" aria-label="Move up"`))}${btn("↓", op("moveEdu", `data-i="${i}" data-d="1" aria-label="Move down"`))}${btn("Remove", op("removeEdu", `data-i="${i}"`))}</div>
${fld("Credential", `edu:${i}.b`, e.b, st, V)}
<div class="cvb-g2">${fld("Gloss (optional, your words)", `edu:${i}.gloss`, e.gloss, st, V)}${fld("Institution", `edu:${i}.inst`, e.inst, st, V)}${fld("Date", `edu:${i}.date`, e.date, st, V)}${fld("Grade", `edu:${i}.grade`, e.grade, st, V)}</div>
${fld("Detail", `edu:${i}.s`, e.s, st, V, { area: true })}</div>`).join("")}
<div class="cvb-row">${btn("Add an entry", op("addEdu"))}</div>`;
}

function fLanguages(ctx, st, V) {
  const codes = uniq([st.lang, ...codesOf(ctx)]);
  const R = st.referee || {};
  const lvl = (r) => `<select class="f cvb-sel" data-cvb-level="${st.langs.indexOf(r)}" aria-label="Level"><option value=""${!r.level && !r.cefr ? " selected" : ""}>Choose a level</option>${CVB.LEVELS.map((l) => `<option value="${l}"${r.level === l ? " selected" : ""}>${esc(CVB.LEVEL_LABEL.en[l])}</option>`).join("")}${r.cefr ? `<option value="${esc(r.cefr)}" selected>${esc(r.cefr)}</option>` : ""}</select>`;
  return `<div class="hint">Each language with your own level. A native language is never “fluent” or “verhandlungssicher”.</div>
<ul class="cvb-comps">${st.langs.map((r, i) => `<li><input class="f" data-cvb-langname="${i}" value="${esc(r.name)}" aria-label="Language">${lvl(r)}${r.lvlRaw && !r.level && !r.cefr ? `<span class="hint">Your CV says “${esc(r.lvlRaw)}”</span>` : ""}
${btn("↑", op("moveLang", `data-i="${i}" data-d="-1" aria-label="Move up"`))}${btn("↓", op("moveLang", `data-i="${i}" data-d="1" aria-label="Move down"`))}${btn("×", op("removeLang", `data-i="${i}" aria-label="Remove language"`))}${hintEl("lang:" + i, st, V)}</li>`).join("")}</ul>
<div class="cvb-row">${btn("Add a language", op("addLang"))}</div>
<div class="lbl">References</div>
${codes.map((c) => fld(`References line — ${esc(LANG_EN[c] || c.toUpperCase())}`, "refs." + c, st.refs[c], st, V, { ph: (CVB.LABELS[c] || CVB.LABELS.en).refs })).join("")}
<div class="hint">A referee's name prints only once you tick “confirmed reachable”. Contact details are never stored or printed.</div>
<div class="cvb-g2">${fld("Referee name", "referee.name", R.name, st, V)}${fld("Their role", "referee.role", R.role, st, V)}${fld("Organisation", "referee.org", R.org, st, V)}${fld("Letter date", "referee.date", R.date, st, V)}</div>
<label class="cvb-chk"><input type="checkbox" data-cvb-chk="referee.reachable"${R.reachable ? " checked" : ""}> Confirmed reachable and agreed to be named${hintEl("referee.reachable", st, V)}</label>
<label class="cvb-chk"><input type="checkbox" data-cvb-chk="referee.copy"${R.copy ? " checked" : ""}> A copy of the letter is available on request</label>`;
}

function fCheck(ctx, st, V) {
  const errs = V.errors.length;
  const d = CVB.diff(st, ctx.source);
  const nChanged = d.roles.added.length + d.roles.removed.length + d.roles.edited.length + d.lines.added.length + d.lines.removed.length + d.lines.edited.length + d.lines.moved.length;
  const q = V.questions;
  const group = (k, label, list) => (list.length ? `<div class="lbl">${label} (${list.length})</div><ul class="cvb-items">${list.map((i) => itemLi({ ...i, k })).join("")}</ul>` : "");
  const li = (x) => `<li>${esc(x)}</li>`;
  return `${group("e", "Must fix before export", V.errors)}${group("w", "Worth checking", V.warnings)}${group("i", "For your information", V.info)}
${q.length ? `<div class="lbl">Questions only you can answer (${q.length})</div><div class="hint">Every answer is optional, a figure too. Your answers stay here, in this browser. They are never printed — write a figure into a line yourself when you want it on the CV.</div>
${q.map((x) => `<label class="cvb-fld"><span class="cvb-q">${esc(x.msg)}</span><span class="lbl">Your answer, in your words</span><textarea class="f" data-cvb-f="answer:${esc(x.qid)}" dir="auto" rows="2">${esc(x.answer)}</textarea></label>`).join("")}` : ""}
<details class="cvb-diff"${VS.showDiff ? " open" : ""}><summary>What changed since your ${ctx.real ? "uploaded CV" : "built-in profile"} (${nChanged})</summary>
${d.roles.added.length ? `<div class="lbl">Roles added</div><ul>${d.roles.added.map(li).join("")}</ul>` : ""}${d.roles.removed.length ? `<div class="lbl">Roles removed</div><ul>${d.roles.removed.map(li).join("")}</ul>` : ""}
${d.roles.edited.length ? `<div class="lbl">Roles edited</div><ul>${d.roles.edited.map((x) => li(x.role + " — " + x.fields.map((f) => ({ t: "title", d: "dates", c: "employer" }[f] || f)).join(", "))).join("")}</ul>` : ""}${d.roles.reordered ? `<div class="hint">Roles reordered.</div>` : ""}
${d.lines.added.length ? `<div class="lbl">Lines added</div><ul>${d.lines.added.map((x) => li(x.x)).join("")}</ul>` : ""}${d.lines.edited.length ? `<div class="lbl">Lines edited</div><ul>${d.lines.edited.map((x) => li(x.from + " → " + x.to)).join("")}</ul>` : ""}
${d.lines.moved.length ? `<div class="lbl">Lines moved</div><ul>${d.lines.moved.map((x) => li(x.x + " → " + x.to)).join("")}</ul>` : ""}${d.lines.removed.length ? `<div class="lbl">Lines removed</div><ul>${d.lines.removed.map((x) => li(x.x)).join("")}</ul>` : ""}
</details>
<div class="cvb-row">${btn("Text PDF (for applications)", `id="cvbPdf"${errs ? " disabled" : ""}`, "btn sm pri")}${btn("Designed copy (image PDF)", `id="cvbDesign"${errs ? " disabled" : ""}`)}${btn("Check this CV", 'id="cvbCheck"')}${btn("Save now", 'id="cvbSave"')}${btn("Download a backup", 'id="cvbBackup"')}</div>
${errs ? `<div class="hint">Export waits for ${errs} must-fix item${errs === 1 ? "" : "s"} above. Nothing missing is filled in for you.</div>` : ""}
<div class="hint">The master CV is untailored. Which lines lead for a given posting is decided in the Draft.</div>`;
}

const FORMS = { header: fHeader, headline: fHeadline, summary: fSummary, experience: fExperience, skills: fSkills, education: fEducation, languages: fLanguages, check: fCheck };

/* ------------------------------------------------------------------ the tab */

function notes(ctx, st) {
  const e = ctx.edits || {}, out = [];
  if (!ctx.real) out.push("<b>This is the built-in example profile.</b> Upload your own CV to build yours.");
  if (e.cvb && ctx.cvbOn === false) out.push("<b>A built CV in this browser belongs to another profile</b> and was not applied. Your first change here starts a new one for this profile.");
  else if (!built(ctx)) out.push("<b>Nothing is saved as your built CV until you change something here.</b> From then on, Profile's Headline, Summary, Skills and Career history are edited in this tab.");
  if (built(ctx)) {
    const h = CVB.sourceHash(ctx.source);
    if (e.cvb.src && e.cvb.src !== h && e.cvbSrcAck !== h)
      out.push(`<b>Your ${ctx.real ? "uploaded CV" : "built-in profile"} changed since you built this one.</b> Your built CV still applies, so nothing you typed is lost. ${btn("Keep my built CV", op("keepStale"))} ${btn(ctx.real ? "Start from the new upload" : "Start from the built-in profile", op("reset"))} ${btn("Show what changed", op("showDiff"))}`);
    if (e.xp || e.comps) out.push("Some older edits were made before you built your CV and were not applied.");  }
  if (VS.note) out.push(`<b>From CV Review.</b> ${VS.note.quote ? `You wrote “${esc(VS.note.quote)}”. ` : ""}${VS.note.answer ? `Your answer, not on your CV until you write it into the line: “${esc(VS.note.answer)}”.` : esc(VS.note.question || "")} ${btn("Close", op("closeNote"))}`);
  return out.map((n) => `<div class="note">${n}</div>`).join("");
}

/** The whole tab as HTML. */
export function render(ctx) {
  const st = getState(ctx), b = bctx(ctx), V = CVB.validateAll(st, b);
  const cur = step(ctx), mk = market(ctx), lang = plang(ctx), codes = codesOf(ctx);
  const e = ctx.edits || {};
  /* Offered until the backup is swapped back, even after edits made since the reset. */
  const canUndoReset = !!(e.cvbPrev && e.cvbPrev.v === 1);
  const title = (CVB.STEPS.find((s) => s.id === cur) || {}).title || "";
  return `<div id="cvb" class="cvb">
<div class="cvb-notes">${notes(ctx, st)}</div>
<div class="cvb-top">
 <nav class="cvb-rail" id="cvbRail" aria-label="Builder steps">${railHtml(st, V, ctx)}</nav>
 <div class="cvb-tools">
  ${btn("Undo", `id="cvbUndo"${VS.undo.length ? "" : " disabled"}`)}${btn("Redo", `id="cvbRedo"${VS.redo.length ? "" : " disabled"}`)}
  ${btn(ctx.real ? "Reset to my uploaded CV" : "Reset to the built-in profile", `id="cvbReset"${built(ctx) ? "" : " disabled"}`)}${canUndoReset ? btn("Undo reset", 'id="cvbUndoReset"') : ""}
  <div class="seg" role="group" aria-label="Market">${Object.entries(MARKET_LABEL).map(([k, v]) => `<button data-cvb-market="${k}" aria-pressed="${mk === k}">${v}</button>`).join("")}</div>
  ${codes.length > 1 ? `<div class="seg" role="group" aria-label="Preview language">${codes.map((c) => `<button data-cvb-lang="${c}" aria-pressed="${lang === c}">${esc(c.toUpperCase())}</button>`).join("")}</div>` : ""}
 </div>
</div>
<div class="hint cvb-msg" id="cvbMsg" role="status">${esc(VS.msg)}</div>
<div class="cvb-grid">
 <div class="cvb-form"><h3 class="cvb-h3">${esc(title)}</h3>${stepItems(st, V, cur)}${FORMS[cur](ctx, st, V)}
  <div class="cvb-row cvb-nav">${cur !== STEP_IDS[0] ? btn("← Back", `data-cvb-step="${STEP_IDS[STEP_IDS.indexOf(cur) - 1]}"`) : ""}${cur !== STEP_IDS[STEP_IDS.length - 1] ? btn("Next →", `data-cvb-step="${STEP_IDS[STEP_IDS.indexOf(cur) + 1]}"`, "btn sm pri") : ""}</div>
 </div>
 <div class="cvb-prev"><div class="lbl">Preview · ${esc(MARKET_LABEL[mk])} · ${esc(lang.toUpperCase())}</div><div id="cvbPreview">${previewHtml(ctx, st, b)}</div></div>
</div>
</div>`;
}

/* ------------------------------------------------------------------ opening a field from elsewhere */

/** A field path from CV Review (a P path such as experience.2.bullets.1) as a builder step and path. */
export function pathFromProfile(ppath, ctx) {
  const p = S(ppath), st = getState(ctx);
  let m;
  if ((m = /^(?:edits\.)?(name|city|phone|email|workRights|nationality|availability|links)$/.exec(p))) return { step: "header", path: "hdr." + (m[1] === "nationality" ? "workRights" : m[1]) };
  if ((m = /^title\.([a-z]{2})$/.exec(p))) return { step: "headline", path: "headline." + m[1] };
  if ((m = /^summary\.([a-z]{2})$/.exec(p))) return { step: "summary", path: "summary." + m[1] };
  if ((m = /^refs\.([a-z]{2})$/.exec(p))) return { step: "languages", path: "refs." + m[1] };
  if (p === "langs") return { step: "languages", path: st.langs.length ? "lang:0" : "" };
  if (p === "technical") return { step: "skills", path: "technical" };
  if ((m = /^experience\.(\d+)(?:\.(t|c|d)|\.bullets\.(\d+))?/.exec(p))) {
    const r = st.roles[+m[1]];
    if (!r) return { step: "experience", path: "" };
    /* P carries only the written lines (an empty one is still being typed), so count those. */
    if (m[3] != null) { const bl = r.bullets.filter((x) => S(x.x).trim())[+m[3]]; return { step: "experience", path: bl ? "bullet:" + r.id + ":" + bl.id : "role:" + r.id }; }
    if (m[2] === "d") return { step: "experience", path: r.dDirty ? "role:" + r.id + ".from" : "role:" + r.id + ".d" };
    return { step: "experience", path: "role:" + r.id + (m[2] ? "." + m[2] : "") };
  }
  if ((m = /^education\.(\d+)\.(b|s)$/.exec(p))) return { step: "education", path: `edu:${m[1]}.${m[2]}` };
  if ((m = /^competencies\.(\d+)/.exec(p))) {
    let n = -1, at = -1;
    st.comps.forEach((c, i) => { if (c.printed && ++n === +m[1]) at = i; });
    return { step: "skills", path: at >= 0 ? "comp:" + at : "" };
  }
  return { step: "", path: "" };
}

/** The element a builder path is edited in. */
export function selectorFor(path) {
  const p = S(path);
  let m;
  if (!p) return null;
  if ((m = /^hdr\.(\w+)$/.exec(p))) return `[data-cvb-hdr="${m[1]}"]`;
  if ((m = /^role:([^.]+)\.(from|to)$/.exec(p))) return `[data-cvb-date="${m[1]}|${m[2]}|y"]`;
  if ((m = /^role:([^.]+)\.(now|earlier)$/.exec(p))) return `[data-cvb-chk="role:${m[1]}.${m[2]}"]`;
  if ((m = /^role:([^.]+)$/.exec(p))) return `[id="cvbr-${m[1]}"]`;
  if ((m = /^referee\.(reachable|copy)$/.exec(p))) return `[data-cvb-chk="${p}"]`;
  if ((m = /^comp:(\d+)$/.exec(p))) return `[data-cvb-compname="${m[1]}"]`;
  if ((m = /^lang:(\d+)$/.exec(p))) return `[data-cvb-langname="${m[1]}"]`;
  if (/^(role:|bullet:|headline\.|summary\.|refs\.|technical$|edu:|referee\.|answer:)/.test(p)) return `[data-cvb-f="${p.replace(/"/g, '\\"')}"]`;
  return null;
}

/**
 * Open the builder on a step and field (from CV Review, or a jump in the builder).
 * The caller switches the tab; flushFocus() then focuses the field.
 */
/* The step a builder path is edited on. */
const BUILDER_PATH_STEP = [[/^hdr\./, "header"], [/^headline\./, "headline"], [/^(role:|bullet:)/, "experience"], [/^(comp:|technical$)/, "skills"],
  [/^edu:/, "education"], [/^(lang:|refs\.|referee\.)/, "languages"], [/^answer:/, "check"]];

export function openAt({ step: s = "", path = "", note = null } = {}, ctx) {
  /* Every path is read as a profile path first ("summary.en", "refs.de" and the rest
     name their field there too), so the field decides the step, not the check's
     builderStep; a builder path keeps its own step. */
  const prof = path ? pathFromProfile(path, ctx) : { step: "", path: "" };
  const own = (BUILDER_PATH_STEP.find(([re]) => re.test(path)) || [])[1];
  const target = prof.step ? prof : own ? { step: own, path } : { step: "", path: "" };
  const stp = STEP_IDS.includes(target.step) ? target.step : STEP_IDS.includes(s) ? s : "check";
  VS.step = stp;
  if (ctx.edits) ctx.edits.cvbStep = stp;
  VS.focus = selectorFor(target.path);
  if (note) VS.note = note;
  if (/^headline\./.test(target.path)) VS.hlCode = target.path.slice(9);
  if (/^summary\./.test(target.path)) VS.sumCode = target.path.slice(8);
  return { step: stp, path: target.path, selector: VS.focus };
}
export function flushFocus(ctx) {
  const sel = VS.focus;
  VS.focus = null;
  return sel ? dom(ctx).focus(sel) : false;
}

/** A line or skill from one of the candidate's documents (the Profile Documents panel). */
export function addDocLine({ text = "", file = "", kind = "bullet" } = {}, ctx) {
  const st = getState(ctx), b = bctx(ctx);
  if (!S(text).trim()) return false;
  if (kind === "skill") return !!run(ctx, () => CVB.addComp(st, S(text).slice(0, 60), "", b));
  if (!st.roles.length) { setMsg(ctx, "Add a role in the CV Builder first."); return false; }
  const rid = st.roles[0].id;
  return !!run(ctx, (confirm) => CVB.restoreLine(st, rid, { kind: "doc", file, text }, { confirm, ctx: b }));
}

/* ------------------------------------------------------------------ events */

/* The nearest element (the target or an ancestor inside #cvb) carrying one of the
   builder's attributes. Walks parentElement, so tests can pass plain objects. */
const IDS = ["cvbUndo", "cvbRedo", "cvbReset", "cvbUndoReset", "cvbPdf", "cvbDesign", "cvbBackup", "cvbCheck", "cvbSave"];
const KEYS = ["cvbStep", "cvbMarket", "cvbLang", "cvbOp", "cvbJump", "cvbChip", "cvbInsert", "cvbF", "cvbHdr", "cvbDate", "cvbChk", "cvbPrint", "cvbCompname", "cvbLevel", "cvbLangname", "cvbRestore", "cvbMoveto"];
function locate(t) {
  let inside = false, hit = null;
  for (let el = t; el; el = el.parentElement) {
    if (!hit && ((el.id && IDS.includes(el.id)) || (el.dataset && KEYS.some((k) => el.dataset[k] !== undefined)))) hit = el;
    if (el.id === "cvb") { inside = true; break; }
  }
  return inside ? hit : null;
}

function persist(ctx, k, v) { if (ctx.edits) { ctx.edits[k] = v; if (typeof ctx.save === "function") ctx.save(); } }

function undo(ctx, from, to) {
  if (!from.length) return false;
  const cur = getState(ctx);
  const prev = from.pop();
  to.push(cur);
  const a = ACH_STEP.get(prev);
  if (a && ctx.edits) {
    ACH_STEP.set(cur, a);
    ctx.edits.ach = Object.assign({}, ctx.edits.ach);
    /* Compare-and-swap: a figure the candidate typed on Profile after the step is
       theirs, so Undo fills the answer only while it is still empty and Redo clears
       it only while it still holds the figure the step took. */
    const typed = S(ctx.edits.ach[a.k]).trim();
    if (from === VS.undo) { if (!typed) ctx.edits.ach[a.k] = a.v; } else if (typed === S(a.v).trim()) delete ctx.edits.ach[a.k];
  }
  VS.typing = null;
  commit(prev, ctx, { structural: true, noUndo: true });
  return true;
}

/** Reset to the source profile: exactly the parsed upload (or the seed) for every field the build owns. */
export function reset(ctx, { ask = true } = {}) {
  const who = ctx.real ? "your uploaded CV" : "the built-in profile";
  if (ask && !(typeof ctx.confirm === "function" && ctx.confirm(`Reset your built CV to ${who}? Your header fields and achievement answers are kept. You can undo the reset.`))) return false;
  const e = ctx.edits;
  if (e.cvb) e.cvbPrev = e.cvb;
  delete e.cvb; delete e.xp; delete e.comps; delete e.cvbSrcAck;
  if (e.prof) for (const k of Object.keys(e.prof)) if (CVB.ownedProfKey(k)) delete e.prof[k];
  const src = ctx.source || {};
  for (const k of CVB.OWNED) { if (k in src) ctx.P[k] = clone(src[k]); else delete ctx.P[k]; }
  if (typeof ctx.applyAchievements === "function") ctx.applyAchievements();
  const keep = VS.step;
  resetView(); VS.step = keep; VS.edits = e;
  VS.msg = `Reset to ${who}.`;
  if (typeof ctx.save === "function") ctx.save();
  if (typeof ctx.render === "function") ctx.render();
  return true;
}

function undoReset(ctx) {
  const e = ctx.edits;
  if (!(e.cvbPrev && e.cvbPrev.v === 1)) return false;
  /* Edits made since the reset are swapped into the backup, not dropped, so pressing
     Undo reset again brings them back. */
  const since = e.cvb && e.cvb.v === 1 ? e.cvb : null;
  e.cvb = e.cvbPrev;
  if (since) e.cvbPrev = since; else delete e.cvbPrev;
  resetView(); VS.edits = e;
  if (since) VS.msg = "Back to the CV from before the reset. Your changes since then are kept — Undo reset again to return to them.";
  applyToP(ctx);
  if (typeof ctx.save === "function") ctx.save();
  if (typeof ctx.render === "function") ctx.render();
  return true;
}

async function exportPdf(ctx, kind) {
  const W = ctx.win || (typeof window !== "undefined" ? window : {});
  const st = getState(ctx), b = bctx(ctx);
  const errs = CVB.validateAll(st, b).errors;
  if (errs.length) { setMsg(ctx, `Export waits for ${errs.length} must-fix item${errs.length === 1 ? "" : "s"} in step 8.`); return false; }
  const name = header(ctx).name;
  const fn = typeof W.applicationFilename === "function" ? W.applicationFilename(name, kind === "design" ? "CV designed" : "CV", "") : kind === "design" ? "cv-designed.pdf" : "cv.pdf";
  const printIt = (why) => {
    setMsg(ctx, why + " Choose Save as PDF as the destination.");
    if (typeof document !== "undefined") { document.body.classList.add("printcv"); setTimeout(() => { W.print(); document.body.classList.remove("printcv"); }, 80); }
  };
  if (plang(ctx) === "ar") { printIt("An Arabic CV prints rather than rasterises, so its letters join."); return true; }
  setMsg(ctx, kind === "design" ? "Building the designed copy…" : "Building the CV PDF…");
  try {
    if (kind === "design") {
      if (typeof W.buildApplicationPdf !== "function") throw new Error("The PDF module did not load.");
      await W.buildApplicationPdf(fn, "cv");
    } else {
      if (typeof W.buildCvTextPdf !== "function") throw new Error("The text-PDF module did not load.");
      await W.buildCvTextPdf(fn);
    }
    setMsg(ctx, "Saved " + fn + " to your Downloads.");
    return true;
  } catch (err) {
    if (kind === "design") { printIt(S(err && err.message) + " Printing instead."); return false; }
    setMsg(ctx, S(err && err.message) || "The PDF could not be built.");
    return false;
  }
}

function insertAt(text, piece, at) {
  const t = S(text), n = at == null ? t.length : Math.max(0, Math.min(at, t.length));
  const before = t.slice(0, n), after = t.slice(n);
  const pre = before && !/\s$/.test(before) ? " " : "", post = after && !/^\s/.test(after) ? " " : "";
  return { text: before + pre + piece + post + after, caret: (before + pre + piece).length };
}

function onClick(el, ctx) {
  const d = el.dataset || {};
  const st = getState(ctx), b = bctx(ctx);
  switch (el.id) {
    case "cvbUndo": return undo(ctx, VS.undo, VS.redo), true;
    case "cvbRedo": return undo(ctx, VS.redo, VS.undo), true;
    case "cvbReset": return reset(ctx), true;
    case "cvbUndoReset": return undoReset(ctx), true;
    case "cvbPdf": case "cvbDesign": {
      /* Recruiter lens C: below 85 the page's warning comes first (career-portal.html
         sendGate), reviewed in this Builder's own language and market, and its button
         proceeds. It never refuses: no gate, or any error in it, lets the export through. */
      const W = ctx.win || (typeof window !== "undefined" ? window : {});
      let go = true;
      try {
        const D = dom(ctx), out = typeof D.el === "function" ? D.el("#cvbMsg") : null;
        if (typeof W.cvSendGate === "function") go = W.cvSendGate(el.id, out, plang(ctx), market(ctx)) !== false;
      } catch { go = true; }
      if (go) exportPdf(ctx, el.id === "cvbPdf" ? "text" : "design");
      return true;
    }
    case "cvbBackup": if (typeof ctx.backup === "function") ctx.backup(); setMsg(ctx, "Backup downloaded. It includes your built CV."); return true;
    case "cvbSave": if (typeof ctx.save === "function") ctx.save(); setMsg(ctx, "Saved in this browser."); return true;
    case "cvbCheck": if (typeof ctx.go === "function") ctx.go("cvcheck"); return true;
    default: break;
  }
  if (d.cvbStep !== undefined) { VS.step = STEP_IDS.includes(d.cvbStep) ? d.cvbStep : "header"; persist(ctx, "cvbStep", VS.step); ctx.render(); return true; }
  if (d.cvbMarket !== undefined) { persist(ctx, "cvbMarket", d.cvbMarket); ctx.render(); return true; }
  if (d.cvbLang !== undefined) { persist(ctx, "cvbLang", d.cvbLang); ctx.render(); return true; }
  if (d.cvbJump !== undefined) {
    const [s, ...rest] = S(d.cvbJump).split("|");
    const path = rest.join("|");
    VS.step = STEP_IDS.includes(s) ? s : VS.step; persist(ctx, "cvbStep", VS.step);
    VS.focus = selectorFor(path);
    ctx.render(); flushFocus(ctx);
    return true;
  }
  if (d.cvbChip !== undefined) {
    const code = d.cvbChip, path = "headline." + code, sel = selectorFor(path);
    const r = CVB.chipInsert(st.headline[code], S(d.cvbText), dom(ctx).caret(sel));
    const res = CVB.setField(st, path, r.text, b);
    if (res.error) { setMsg(ctx, res.msg); return true; }
    commit(res.state, ctx, { structural: true });
    dom(ctx).focus(sel, r.caret);
    return true;
  }
  if (d.cvbInsert !== undefined) {
    const [rid, bid] = S(d.cvbInsert).split("|");
    const r = st.roles.find((x) => x.id === rid), bl = r && r.bullets.find((x) => x.id === bid);
    if (!bl) return true;
    const code = VS.sumCode || st.lang, path = "summary." + code, sel = selectorFor(path);
    const ins = insertAt(st.summary[code], bl.x, dom(ctx).caret(sel));
    const res = CVB.setField(st, path, ins.text, b);
    if (res.error) { setMsg(ctx, res.msg); return true; }
    commit(res.state, ctx, { structural: true });
    dom(ctx).focus(sel, ins.caret);
    return true;
  }
  if (d.cvbOp === undefined) {
    /* A click into a headline or summary box marks where chips and proof points go. */
    const f = S(d.cvbF);
    if (/^headline\./.test(f)) VS.hlCode = f.slice(9);
    if (/^summary\./.test(f)) VS.sumCode = f.slice(8);
    return false;
  }
  const rid = S(d.rid), bid = S(d.bid), i = +d.i, dl = +d.d || 0;
  switch (d.cvbOp) {
    case "addRole": run(ctx, () => CVB.addRole(st, 0)); break;
    case "removeRole": {
      const r = st.roles.find((x) => x.id === rid);
      if (r && typeof ctx.confirm === "function" && !ctx.confirm(`Remove ${r.t || r.c || "this role"}${r.bullets.length ? " and its " + r.bullets.length + " line" + (r.bullets.length === 1 ? "" : "s") : ""}? Undo brings it back.`)) break;
      run(ctx, () => CVB.removeRole(st, rid, { confirm: true }));
      break;
    }
    case "moveRole": run(ctx, () => CVB.moveRole(st, rid, dl)); break;
    case "sortRoles": run(ctx, () => CVB.sortRolesByDate(st, b.now)); break;
    case "addBullet": run(ctx, () => CVB.addBullet(st, rid, undefined, "", b)); break;
    case "removeBullet": run(ctx, () => CVB.removeBullet(st, rid, bid)); break;
    case "moveBullet": run(ctx, () => CVB.moveBullet(st, rid, bid, dl)); break;
    case "split": {
      const at = dom(ctx).caret(selectorFor("bullet:" + rid + ":" + bid));
      if (at == null) { setMsg(ctx, "Click in the line where it should split, then press Split."); break; }
      run(ctx, () => CVB.splitBullet(st, rid, bid, at, b));
      break;
    }
    case "splitAt": run(ctx, () => CVB.splitBullet(st, rid, bid, +d.at, b)); break;
    case "merge": run(ctx, () => CVB.mergeBullets(st, rid, bid)); break;
    case "ownLine": {
      const pr = ((ctx.P || {}).experience || []).find((x) => x && x.id === rid);
      const a = pr && (pr.bullets || []).find((x) => x && x.ach === d.achkey);
      if (!a) break;
      const r = CVB.makeOwnLine(st, rid, a.x, d.achkey);
      if (r.error) { setMsg(ctx, r.msg); break; }
      /* The answer is cleared (so the template line does not print twice) in the same
         undo step as the new line: Undo brings the figure back with the template line. */
      const k = r.clearAch, had = !!(ctx.edits.ach && k && Object.prototype.hasOwnProperty.call(ctx.edits.ach, k));
      const achStep = had ? { k, v: ctx.edits.ach[k] } : null;
      if (had) { ctx.edits.ach = Object.assign({}, ctx.edits.ach); delete ctx.edits.ach[k]; }
      commit(r.state, ctx, { structural: true, ach: achStep });
      break;
    }
    case "addComp": run(ctx, () => CVB.addComp(st, S(d.name), S(d.tag), b)); break;
    case "addSkill": run(ctx, () => CVB.addComp(st, dom(ctx).value("#cvbSkillNew"), "", b)); break;
    case "removeComp": VS.showEv = -1; run(ctx, () => CVB.removeComp(st, i)); break;
    case "moveComp": VS.showEv = -1; run(ctx, () => CVB.moveComp(st, i, dl)); break;
    case "hideUnev": run(ctx, () => CVB.hideUnevidenced(st, b)); break;
    case "showEv": VS.showEv = VS.showEv === i ? -1 : i; ctx.render(); break;
    case "addEdu": run(ctx, () => CVB.addEdu(st)); break;
    case "removeEdu":
      /* The Draft prints the first entry, so one always stays: clear its fields instead. */
      if (st.education.length <= 1) { setMsg(ctx, "Keep at least one education entry — clear its fields instead."); break; }
      run(ctx, () => CVB.removeEdu(st, i));
      break;
    case "moveEdu": run(ctx, () => CVB.moveEdu(st, i, dl)); break;
    case "addLang": run(ctx, () => CVB.addLang(st)); break;
    case "removeLang": run(ctx, () => CVB.removeLang(st, i)); break;
    case "moveLang": run(ctx, () => CVB.moveLang(st, i, dl)); break;
    case "dismiss": {
      const hint = S(d.hint);
      if (!run(ctx, () => CVB.dismiss(st, hint))) break;
      /* A quarantined header value whose only finding is now dismissed is saved. */
      const m = /^pd\.hdr\.(\w+)\./.exec(hint), q = m && ((ctx.edits || {}).prof || {})["blocked." + m[1]];
      if (typeof q === "string") { setHeader(ctx, m[1], q); if (typeof ctx.render === "function") ctx.render(); }
      break;
    }
    case "keepStale": persist(ctx, "cvbSrcAck", CVB.sourceHash(ctx.source)); ctx.render(); break;
    case "showDiff": VS.showDiff = true; VS.step = "check"; persist(ctx, "cvbStep", "check"); ctx.render(); break;
    case "closeNote": VS.note = null; ctx.render(); break;
    case "reset": reset(ctx); break;
    default: return false;
  }
  return true;
}

function onInput(el, ctx) {
  const d = el.dataset || {};
  const st = getState(ctx), b = bctx(ctx);
  const val = el.value !== undefined ? S(el.value) : S(el.textContent);
  if (d.cvbF !== undefined) {
    const path = S(d.cvbF);
    if (/^headline\./.test(path)) VS.hlCode = path.slice(9);
    if (/^summary\./.test(path)) VS.sumCode = path.slice(8);
    const r = CVB.setField(st, path, val, b);
    if (r.error) { dom(ctx).html(hid(path), `<span class="cvb-e">${esc(r.msg)}</span>`); return true; }
    commit(r.state, ctx, { field: path });
    return true;
  }
  if (d.cvbHdr !== undefined) { setHeader(ctx, S(d.cvbHdr), val); return true; }
  if (d.cvbLangname !== undefined) {
    const i = +d.cvbLangname;
    const r = CVB.setLang(st, i, { name: val });
    if (r.error) { dom(ctx).html(hid("lang:" + i), `<span class="cvb-e">${esc(r.msg)}</span>`); return true; }
    commit(r.state, ctx, { field: "lang:" + i });
    return true;
  }
  /* The year box and the skill name commit on change, not on every key. */
  return d.cvbDate !== undefined || d.cvbCompname !== undefined;
}

/* A header field: one writer (the page's setProf). A value naming a protected
   characteristic is quarantined in edits.prof['blocked.<key>'] and never reaches P. */
export function setHeader(ctx, k, v) {
  if (!["name", "city", "phone", "email", "workRights", "availability", "links"].includes(k)) return false;
  const e = ctx.edits;
  const g = hdrGuard(ctx, k, v);
  e.prof = Object.assign({}, e.prof);
  if (g.blocked) {
    /* Quarantined only: P and edits.prof keep the last clean value, so one blocked
       keystroke never blanks the name on the Draft, the letters and every other tab. */
    e.prof["blocked." + k] = S(v);
  } else {
    delete e.prof["blocked." + k];
    if (HDR_TOP.includes(k) && typeof e[k] === "string") delete e[k];
    if (typeof ctx.setProf === "function") ctx.setProf(k, S(v)); else { e.prof[k] = S(v); ctx.P[k] = S(v); }
  }
  if (typeof ctx.save === "function") ctx.save();
  const st = getState(ctx), V = CVB.validateAll(st, bctx(ctx));
  const d = dom(ctx);
  d.html("cvbPreview", previewHtml(ctx, st));
  d.html("cvbRail", railHtml(st, V, ctx));
  const kept = g.blocked ? S(k === "links" ? (ctx.P || {}).links : header(ctx)[k]).trim() : "";
  const msg = g.msg + (kept ? ` Your CV keeps “${kept}”.` : "");
  d.html(hid("hdr." + k), (g.blocked || g.warn ? `<span class="cvb-${g.blocked ? "e" : "w"}">${esc(msg)}</span>${g.blocked ? ackBtn(g) : ""}` : "") + fieldHint("hdr." + k, st, V));
  return true;
}

function onChange(el, ctx) {
  const d = el.dataset || {};
  const st = getState(ctx), b = bctx(ctx);
  if (d.cvbDate !== undefined) {
    const [rid, side, part] = S(d.cvbDate).split("|");
    const r = st.roles.find((x) => x.id === rid);
    if (!r) return true;
    const cur = S(r[side]), key = rid + "|" + side;
    let y = cur.slice(0, 4), mm = cur.length > 4 ? cur.slice(5, 7) : S(VS.pend[key]);
    if (part === "m") mm = S(el.value); else y = S(el.value).trim();
    if (y && !/^\d{4}$/.test(y)) { setMsg(ctx, "Type the year as four digits."); return true; }
    if (!y) { VS.pend[key] = mm; if (mm) setMsg(ctx, "Now type the year."); if (!cur) return true; }
    delete VS.pend[key];
    run(ctx, () => CVB.setField(st, "role:" + rid + "." + side, y ? (mm ? y + "-" + mm : y) : "", b));
    return true;
  }
  if (d.cvbChk !== undefined) { run(ctx, () => CVB.setField(st, S(d.cvbChk), !!el.checked, b)); return true; }
  if (d.cvbPrint !== undefined) { run(ctx, () => CVB.setCompPrinted(st, +d.cvbPrint, !!el.checked)); return true; }
  if (d.cvbCompname !== undefined) { run(ctx, () => CVB.renameComp(st, +d.cvbCompname, S(el.value))); return true; }
  if (d.cvbLevel !== undefined) { if (S(el.value)) run(ctx, () => CVB.setLang(st, +d.cvbLevel, { level: S(el.value) })); return true; }
  if (d.cvbRestore !== undefined) {
    const cands = CVB.restoreCandidates(st, { source: ctx.source });
    const c = cands[+el.value];
    if (c) run(ctx, (confirm) => CVB.restoreLine(st, S(d.cvbRestore), c, { confirm, ctx: b }));
    else if (typeof ctx.render === "function") ctx.render();
    return true;
  }
  if (d.cvbMoveto !== undefined) {
    const [rid, bid] = S(d.cvbMoveto).split("|");
    if (S(el.value)) run(ctx, (confirm) => CVB.moveBulletToRole(st, rid, bid, S(el.value), undefined, { confirm }));
    return true;
  }
  return d.cvbF !== undefined || d.cvbHdr !== undefined || d.cvbLangname !== undefined;
}

/**
 * One DOM event from inside #cvb. Returns true when the builder handled it, so the
 * page stops it reaching the other #pane listeners.
 */
export function handle(ev, ctx) {
  const el = ev && ev.target ? locate(ev.target) : null;
  if (!el) return false;
  if (ev.type === "click") {
    /* Enter in the skill box clicks its submit button: add the skill, never submit the page. */
    if (el.type === "submit" && typeof ev.preventDefault === "function") ev.preventDefault();
    return onClick(el, ctx);
  }
  if (ev.type === "input") return onInput(el, ctx);
  if (ev.type === "change") return onChange(el, ctx);
  return false;
}

export { STEP_IDS };

if (typeof window !== "undefined") {
  window.CVB = CVB;
  window.CVB_VIEW = { render, handle, openAt, flushFocus, addDocLine, getState, resetView };
  if (typeof window.afterCvView === "function") window.afterCvView("build");
}
