/**
 * The CV Review tab: the view and event handling around cv-review.js.
 *
 * career-portal.html only wires this in: vCvReview() returns render(ctx), and the
 * delegated #pane listener hands every event inside #cvr to handle(event, ctx).
 * ctx is the same object the CV Builder view gets (see cv-builder-view.js), plus
 * cvStyle, workRights, jobNames and appLangs.
 *
 * Nothing here edits the CV. Every fix is the candidate's, in the Builder ("Fix in
 * Builder" opens the step and focuses the field). The candidate's own text is
 * quoted escaped with the hit marked; answers to questions are stored as their own
 * text in edits.cvq and are never spliced into the CV; "Checked — it's true and
 * stays" is stored in edits.cvrAck and comes back when the quoted text changes.
 */
import { reviewCV, langReadiness, orphanAnswers, answerNeedsUnit, SECTIONS, SEV_COLOUR, SEV_LABEL, BAND, CHECKS, MARKETS, defaultMarket, defaultLang } from "./cv-review.js";
import * as BV from "./cv-builder-view.js";
/* Recruiter lens A+B (first 6 seconds, what gets you rejected) and C (the scorecard):
   read from this same review, never re-derived, and each wrapped so a failure there
   leaves the review as it was. */
import { firstGlance } from "./first-glance.js";
import { sixHtml, rejectHtml } from "./first-glance-view.js";
import { scorecard, scorecardHtml } from "./cv-scorecard.js";

const S = (v) => (v == null ? "" : String(v));
const esc = (s) => S(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LANG_EN = { en: "English", de: "German", ar: "Arabic", fr: "French", es: "Spanish", it: "Italian", pt: "Portuguese", nl: "Dutch", tr: "Turkish", ru: "Russian" };
const MARKET_SHORT = { gcc: "UAE / GCC", dach: "DACH", uk: "UK" };
const FILTERS = [["all", "All"], ["high", "Must fix"], ["med", "Should fix"], ["low", "Consider"], ["acked", "Checked by you"]];
const ACK_LABEL = "Checked — it's true and stays";

const fresh = () => ({ filter: "all", more: false });
const VS = fresh();
export function resetView() { Object.assign(VS, fresh()); }
export function viewState() { return VS; }

/* ------------------------------------------------------------------ context */

const workRightsOf = (ctx) => S((ctx.P || {}).workRights || (!ctx.real ? (ctx.P || {}).nationality : "") || "").trim();

export function market(ctx) {
  const m = S((ctx.edits || {}).cvrMarket);
  if (MARKETS[m]) return m;
  try { return defaultMarket(ctx.P || {}, ctx.edits || {}); } catch { return "gcc"; }
}
export function langs(ctx) {
  const l = (ctx.appLangs && ctx.appLangs.length ? ctx.appLangs : ["en"]).map((c) => S(c).toLowerCase());
  return [...new Set(l)];
}
export function lang(ctx) {
  const L = langs(ctx), saved = S((ctx.edits || {}).cvrLang).toLowerCase();
  if (L.includes(saved)) return saved;
  const d = defaultLang(market(ctx), ctx.P || {});
  return L.includes(d) ? d : L[0];
}

/** The options reviewCV reads, from the page context. */
export function opts(ctx, L = lang(ctx), M = market(ctx)) {
  const e = ctx.edits || {}, now = ctx.now || new Date();
  return {
    market: M, lang: L, today: { y: now.getFullYear(), m: now.getMonth() + 1 }, real: !!ctx.real, edits: e,
    cvStyle: ctx.cvStyle, workRights: ctx.workRights !== undefined ? ctx.workRights : workRightsOf(ctx), syn: ctx.vocab && ctx.vocab.SYN,
    achAnswers: e.ach || {}, ack: e.cvrAck || {}, answers: e.cvq || {}, skipped: e.cvqSkip || {}, jobNames: ctx.jobNames || {}, builder: true,
  };
}

/* The review in a given language and market. The page's send warning passes the
   draft's language, and the Builder its own language and market, so an export is
   judged as it will print. */
export function review(ctx, L, M) { return reviewCV(ctx.P || {}, opts(ctx, L || lang(ctx), M || market(ctx))); }

/** The market a posting's city points at (a UAE job gcc, a German one dach), GCC when unknown. */
export function marketFor(city) {
  try { return defaultMarket({ city: S(city) }, {}); } catch { return "gcc"; }
}

/* ------------------------------------------------------------------ pieces */

const docDom = {
  html(id, h) { const el = typeof document !== "undefined" && document.getElementById(id); if (el) el.innerHTML = h; },
  text(id, t) { const el = typeof document !== "undefined" && document.getElementById(id); if (el) el.textContent = t; },
  /* Scroll with behavior "auto": smooth scrolling never animates in the app's browser pane. */
  focus(sel) {
    const el = typeof document !== "undefined" && document.querySelector(sel);
    if (!el) return false;
    try { el.scrollIntoView({ behavior: "auto", block: "center" }); } catch { /* old engines */ }
    try { el.focus({ preventScroll: true }); } catch { el.focus(); }
    return true;
  },
};
const dom = (ctx) => ctx.dom || docDom;

/* The candidate's own text, escaped, at most about 140 characters around the hit. */
export function quoteHtml(text, hit) {
  const t = S(text);
  /* Cut only between words, so no half word the candidate did not write shows up. */
  const back = (i) => { if (i <= 0 || i >= t.length) return Math.max(0, Math.min(i, t.length)); const sp = t.lastIndexOf(" ", i); return sp > 0 ? sp : i; };
  const fwd = (i) => { if (i <= 0) return 0; const sp = t.indexOf(" ", i); return sp < 0 ? i : sp + 1; };
  if (!hit || !(hit[1] > hit[0])) { if (t.length <= 140) return esc(t); return esc(t.slice(0, back(139)).trimEnd()) + "…"; }
  const s = Math.max(0, hit[0]), e = Math.min(t.length, hit[1]);
  const room = Math.max(20, 140 - (e - s));
  let a = Math.max(0, s - Math.floor(room / 2)), b = Math.min(t.length, e + (room - (s - a)));
  if (a > 0) a = Math.min(fwd(a), s);
  if (b < t.length) b = Math.max(back(b), e);
  return (a > 0 ? "…" : "") + esc(t.slice(a, s)) + "<mark>" + esc(t.slice(s, e)) + "</mark>" + esc(t.slice(e, b)) + (b < t.length ? "…" : "");
}

/* Where an instance is, in the candidate's own terms: role title · employer · line n. */
export function whereOf(path, P) {
  const p = S(path);
  let m;
  if ((m = /^experience\.(\d+)(?:\.(t|c|d)|\.bullets\.(\d+))?/.exec(p))) {
    const e = ((P || {}).experience || [])[+m[1]] || {};
    const bits = [S(e.t) || `Role ${+m[1] + 1}`, S(e.c)].filter(Boolean);
    if (m[3] != null) bits.push(`line ${+m[3] + 1}`);
    else if (m[2]) bits.push({ t: "job title", c: "employer", d: "dates" }[m[2]]);
    return bits.join(" · ");
  }
  if ((m = /^(title|summary|refs)\.([a-z]{2})$/.exec(p))) return `${{ title: "Headline", summary: "Summary", refs: "References" }[m[1]]} (${LANG_EN[m[2]] || m[2].toUpperCase()})`;
  if ((m = /^education\.(\d+)\.(b|s)$/.exec(p))) return `Education ${+m[1] + 1} · ${m[2] === "b" ? "credential" : "detail"}`;
  if ((m = /^competencies\.(\d+)/.exec(p))) return `Skills · ${+m[1] + 1}`;
  if ((m = /^edits\.(\w+)$/.exec(p))) return `${m[1].startsWith("sum_") ? "A draft's own summary" : "Draft sheet · " + m[1]}`;
  const F = { name: "Name", city: "Location", phone: "Phone", email: "Email", workRights: "Work rights", nationality: "Work-rights field", langs: "Languages", technical: "Technical skills", availability: "Availability", links: "Links" };
  return F[p] || p;
}

const chip = (sev) => `<span class="tag cvr-sev" style="border-color:${SEV_COLOUR[sev]};color:${SEV_COLOUR[sev]}">${esc(SEV_LABEL[sev])}</span>`;

/** How a line is quoted and placed, for first-glance-view.js here and on the page. */
export const H = Object.freeze({ quoteHtml, whereOf, chip, esc });

/* Recruiter lens A and B, from this same review and options, above Readiness. */
function glanceHtml(P, r, o) {
  try { const g = firstGlance(P, r, o); return sixHtml(g, P, H) + rejectHtml(g, P, H); } catch { return ""; }
}

/* Recruiter lens C, the 7-part scorecard, from this same review, so the parts and the
   0-100 cannot disagree. Keyword strength reads the job the page last opened. */
function scoreHtml(r, ctx) {
  let k = null;
  try { k = typeof ctx.keywords === "function" ? ctx.keywords() : ctx.keywords || null; } catch { k = null; }
  try { return scorecardHtml(scorecard(r, { keywords: k })); } catch { return ""; }
}

function instanceHtml(chk, i, P) {
  const ev = i.evidence || [];
  const first = ev[0] || {};
  const fixAttr = `${esc(chk.builderStep)}|${esc(first.path || "")}`;
  return `<div class="cvr-inst">
${ev.map((e) => `<div class="cvr-where">${esc(whereOf(e.path, P))}${i.sev !== chk.sev ? " " + chip(i.sev) : ""}</div>${e.text ? `<blockquote class="cvr-quote" dir="auto">${quoteHtml(e.text, e.hit)}</blockquote>` : ""}${e.note ? `<div class="hint">${esc(e.note)}</div>` : ""}`).join("")}
<div class="cvr-acts"><button class="btn sm" data-cvfix="${fixAttr}">Fix in Builder →</button>${i.acked ? `<button class="cvr-link" data-cvr-unack="${esc(i.key)}">Undo “checked”</button>` : i.ackable ? `<button class="cvr-link" data-cvr-ack="${esc(i.key)}">${esc(i.ackLabel || ACK_LABEL)}</button>` : ""}</div>
${i.noAck ? `<div class="hint">${esc(i.noAck)}</div>` : ""}</div>`;
}

function cardHtml(chk, list, P) {
  const sev = ["high", "med", "low"].find((s) => list.some((i) => i.sev === s)) || chk.sev;
  return `<div class="job cvr-card" style="--ac:${SEV_COLOUR[sev]}">
<div class="cvr-ch">${chip(sev)}<h3>${esc(chk.title)}</h3>${chk.gate ? `<span class="tag">gate</span>` : ""}</div>
<div class="hint">${esc(chk.rule)}</div>
<div class="cvr-rule">Rule: ${esc(chk.source)}</div>
${list.map((i) => instanceHtml(chk, i, P)).join("")}
<div class="cvr-fix"><b>Fix:</b> ${esc(chk.fix)}</div></div>`;
}

function readinessHtml(r) {
  const c = r.counts;
  return `<div class="ipanel cvr-ready" style="--ac:${r.band}"><h5>Readiness</h5><div class="big">${r.score}</div><div class="track"><i style="width:${r.score}%"></i></div>
<div class="cvr-verdict" style="color:${r.band}">${esc(r.verdict)}</div>
<div class="hint">${c.mustFix} must-fix · ${c.shouldFix} should-fix · ${c.consider} consider${c.checkedByYou ? ` · ${c.checkedByYou} checked by you` : ""}</div>
<div class="cvr-bars">${SECTIONS.map((s) => `<div class="cvr-bar"><span>${esc(s)}</span><div class="track"><i style="width:${r.sections[s]}%;background:${r.sections[s] >= 85 ? BAND.ready : r.sections[s] >= 70 ? BAND.after : BAND.work}"></i></div></div>`).join("")}</div></div>`;
}

function questionHtml(q) {
  const a = S(q.answer);
  return `<div class="cvr-qq" data-state="${q.state}">
<div class="cvr-qt">${esc(q.question)}</div>${q.why ? `<div class="hint">${esc(q.why)}</div>` : ""}
<label class="cvr-ans"><span class="lbl">Your answer, in your words</span><textarea class="f" dir="auto" rows="2" data-cvq="${esc(q.key)}">${esc(a)}</textarea></label>
<div class="hint cvr-unit" id="cvq-${esc(q.key.replace(/[^\w-]/g, "_"))}">${q.needsUnit ? "A number needs its unit — write it in your words (people, sites, AED …)." : ""}</div>
<div class="cvr-acts"><button class="btn sm" data-cvq-use="${esc(q.key)}">Use in Builder →</button>${q.state === "skipped" ? `<button class="cvr-link" data-cvq-unskip="${esc(q.key)}">Ask again</button>` : `<button class="cvr-link" data-cvq-skip="${esc(q.key)}">Skip — not applicable / I'd rather not say</button>`}</div></div>`;
}

function grouped(list) {
  const g = new Map();
  for (const q of list) { const k = q.roleLabel || "Your CV"; if (!g.has(k)) g.set(k, []); g.get(k).push(q); }
  return [...g.entries()].map(([k, qs]) => `<div class="cvr-qg"><div class="lbl">${esc(k)}</div>${qs.map(questionHtml).join("")}</div>`).join("");
}

function questionsHtml(r, ctx) {
  const qs = r.questions || [];
  const open = qs.filter((q) => q.state === "open" && !q.more), more = qs.filter((q) => q.state === "open" && q.more);
  const answered = qs.filter((q) => q.state === "answered"), skipped = qs.filter((q) => q.state === "skipped");
  const orphans = orphanAnswers((ctx.edits || {}).cvq || {}, r);
  return `<aside class="panel cvr-q"><header><h4>Questions only you can answer</h4><span class="src" id="cvrOpen">${open.length + more.length} open</span></header><div class="body">
<div class="hint">Every question comes from a check and quotes your own line. Your answers stay in this browser and never reach a document on their own — you write the final line in the Builder.</div>
${open.length ? grouped(open) : `<div class="hint">No open questions.</div>`}
${more.length ? `<button class="btn sm" data-cvr-more="1" aria-expanded="${VS.more}">${VS.more ? "Show fewer" : `Show ${more.length} more`}</button>${VS.more ? grouped(more) : ""}` : ""}
${answered.length ? `<div class="lbl">Answered (not yet on your CV)</div>${grouped(answered)}` : ""}
${skipped.length ? `<details><summary>Skipped (${skipped.length})</summary>${grouped(skipped)}</details>` : ""}
${orphans.length ? `<div class="lbl">Earlier answers whose line changed or passed</div>${orphans.map((o) => `<div class="cvr-qq"><div class="cvr-quote" dir="auto">${esc(o.answer)}</div><button class="cvr-link" data-cvq-del="${esc(o.key)}">Remove this answer</button></div>`).join("")}` : ""}
</div></aside>`;
}

/* ------------------------------------------------------------------ the tab */

/** The whole tab as HTML. */
export function render(ctx) {
  const P = ctx.P || {};
  const hasCv = (P.experience && P.experience.length) || Object.values(P.summary || {}).some((v) => S(v).trim());
  if (!hasCv) return `<div id="cvr" class="cvr"><div class="blank">Upload your CV first — the review reads your whole CV.<br><br><button class="btn sm" data-cvr-go="profile">Go to Profile</button></div></div>`;
  const M = market(ctx), L = lang(ctx), LS = langs(ctx);
  /* One options object for the review, the language check and the first-glance panel. */
  const o = opts(ctx, L, M);
  const r = reviewCV(P, o);
  let ready = {};
  try { ready = langReadiness(P, LS, o); } catch { ready = {}; }
  const open = (r.questions || []).filter((q) => q.state === "open").length;
  dom(ctx).text("bCvr", open ? String(open) : "");
  const f = VS.filter;
  const failing = r.checks.filter((k) => k.status === "fail");
  const want = (i) => (f === "acked" ? i.acked : !i.acked && !i.later && (f === "all" || i.sev === f));
  const secs = SECTIONS.map((sec) => {
    const all = r.checks.filter((k) => k.section === sec);
    const cards = all.map((k) => ({ k, list: (k.instances || []).filter(want) })).filter((x) => x.list.length);
    const passed = all.filter((k) => k.status === "pass");
    const nFail = failing.filter((k) => k.section === sec).length;
    if (!cards.length && (f !== "all" || !passed.length)) return "";
    return `<section class="cvr-sec"><h4>${esc(sec)}${nFail ? ` <span class="cvr-n">${nFail} failing</span>` : ""}</h4>
${cards.map((x) => cardHtml(x.k, x.list, P)).join("")}
${passed.length && f === "all" ? `<details class="cvr-pass"><summary>Passed (${passed.length})</summary><ul>${passed.map((k) => `<li>${esc(k.title)}</li>`).join("")}</ul></details>` : ""}</section>`;
  }).join("");
  return `<div id="cvr" class="cvr">
<div class="note"><b>Your whole CV, read as a senior recruiter would.</b> The review reads no job posting; only Keyword strength uses the job you last opened. Nothing here changes your CV: every fix is yours, in the Builder.</div>
${ctx.real ? "" : `<div class="note">This is the built-in example profile, not an uploaded CV.</div>`}
<div class="cvr-top">
 <div class="seg" role="group" aria-label="Market">${Object.entries(MARKET_SHORT).map(([k, v]) => `<button data-cvr-market="${k}" aria-pressed="${M === k}">${v}</button>`).join("")}</div>
 <label class="cvr-lang"><span class="lbl">Document language</span><select class="f" data-cvr-lang aria-label="Document language">${LS.map((c) => `<option value="${c}"${c === L ? " selected" : ""}>${ready[c] && !ready[c].ready ? "● " : ""}${esc(LANG_EN[c] || c.toUpperCase())}${ready[c] && !ready[c].ready ? " — not ready" : ""}</option>`).join("")}</select></label>
</div>
<div class="cvr-grid">
 <div class="cvr-main">
  ${glanceHtml(P, r, o)}
  ${readinessHtml(r)}
  ${scoreHtml(r, ctx)}
  <div class="chipsrow cvr-filters" role="group" aria-label="Filter">${FILTERS.map(([k, v]) => `<button class="tog" data-cvr-filter="${k}" aria-pressed="${f === k}">${v}</button>`).join("")}</div>
  ${secs || `<div class="blank">${f === "acked" ? "Nothing marked as checked yet." : "Nothing in this filter."}</div>`}
  <div class="panel cvr-cannot"><header><h4>What this review cannot check</h4></header><div class="body"><ul class="hint"><li>Whether a line is true.</li><li>Whether a figure is right.</li><li>The tone of an Arabic version.</li><li>Fit to any specific job — use Application review for that.</li></ul></div></div>
 </div>
 ${questionsHtml(r, ctx)}
</div></div>`;
}

/* ------------------------------------------------------------------ events */

const IDS = [];
const KEYS = ["cvrMarket", "cvrLang", "cvrFilter", "cvrAck", "cvrUnack", "cvfix", "cvq", "cvqSkip", "cvqUnskip", "cvqUse", "cvqDel", "cvrMore", "cvrGo", "fgQ"];
function locate(t) {
  let inside = false, hit = null;
  for (let el = t; el; el = el.parentElement) {
    if (!hit && ((el.id && IDS.includes(el.id)) || (el.dataset && KEYS.some((k) => el.dataset[k] !== undefined)))) hit = el;
    if (el.id === "cvr") { inside = true; break; }
  }
  return inside ? hit : null;
}

function put(ctx, key, k, v) {
  const e = ctx.edits;
  e[key] = Object.assign({}, e[key]);
  if (v === undefined) delete e[key][k]; else e[key][k] = v;
  if (typeof ctx.save === "function") ctx.save();
}

/* Open the Builder on a step and field, then focus it once the tab has rendered. */
function toBuilder(ctx, stepId, path, note) {
  BV.openAt({ step: stepId, path, note }, ctx);
  if (typeof ctx.go === "function") ctx.go("build");
  BV.flushFocus(ctx);
}

function onClick(el, ctx) {
  const d = el.dataset || {};
  if (d.cvrMarket !== undefined) { if (MARKETS[d.cvrMarket]) { ctx.edits.cvrMarket = d.cvrMarket; if (typeof ctx.save === "function") ctx.save(); } ctx.render(); return true; }
  if (d.cvrFilter !== undefined) { VS.filter = FILTERS.some(([k]) => k === d.cvrFilter) ? d.cvrFilter : "all"; ctx.render(); return true; }
  if (d.cvrAck !== undefined) { put(ctx, "cvrAck", d.cvrAck, true); ctx.render(); return true; }
  if (d.cvrUnack !== undefined) { put(ctx, "cvrAck", d.cvrUnack, undefined); ctx.render(); return true; }
  if (d.cvfix !== undefined) { const [s, ...p] = S(d.cvfix).split("|"); toBuilder(ctx, s, p.join("|")); return true; }
  if (d.cvqSkip !== undefined) { put(ctx, "cvqSkip", d.cvqSkip, true); ctx.render(); return true; }
  if (d.cvqUnskip !== undefined) { put(ctx, "cvqSkip", d.cvqUnskip, undefined); ctx.render(); return true; }
  if (d.cvqDel !== undefined) { put(ctx, "cvq", d.cvqDel, undefined); ctx.render(); return true; }
  if (d.cvrMore !== undefined) { VS.more = !VS.more; ctx.render(); return true; }
  if (d.cvrGo !== undefined) { if (typeof ctx.go === "function") ctx.go(d.cvrGo); return true; }
  if (d.fgQ !== undefined) {
    /* "Answer →" on a weak achievement: its question in the Questions aside, where
       answers are typed. One still under "Show more" opens that list first. (A skipped
       one gets "Ask again" instead: its field sits in a closed list.) */
    const q = (review(ctx).questions || []).find((x) => x.key === d.fgQ);
    if (q && q.more) VS.more = true;
    ctx.render();
    const sel = `#cvr [data-cvq="${typeof CSS !== "undefined" && CSS.escape ? CSS.escape(S(d.fgQ)) : S(d.fgQ).replace(/["\\]/g, "\\$&")}"]`;
    const D = dom(ctx);
    if (typeof D.focus === "function") D.focus(sel);
    return true;
  }
  if (d.cvqUse !== undefined) {
    const q = (review(ctx).questions || []).find((x) => x.key === d.cvqUse);
    if (!q) { ctx.render(); return true; }
    const stepId = (CHECKS[q.check] || [])[4] || "check";
    toBuilder(ctx, stepId, q.path || "", { question: q.question, quote: q.quote || "", answer: S(((ctx.edits || {}).cvq || {})[q.key]).trim() });
    return true;
  }
  return false;
}

function onInput(el, ctx) {
  const d = el.dataset || {};
  if (d.cvq === undefined) return false;
  const v = S(el.value);
  put(ctx, "cvq", d.cvq, v.trim() ? v : undefined);
  /* Only the unit hint changes while typing; the lists regroup on the next render. */
  dom(ctx).html("cvq-" + S(d.cvq).replace(/[^\w-]/g, "_"), v.trim() && answerNeedsUnit(v) ? "A number needs its unit — write it in your words (people, sites, AED …)." : "");
  return true;
}

function onChange(el, ctx) {
  const d = el.dataset || {};
  if (d.cvrLang !== undefined) { ctx.edits.cvrLang = S(el.value); if (typeof ctx.save === "function") ctx.save(); ctx.render(); return true; }
  return d.cvq !== undefined;
}

/**
 * One DOM event from inside #cvr. Returns true when handled, so the page stops it
 * reaching the other #pane listeners.
 */
export function handle(ev, ctx) {
  const el = ev && ev.target ? locate(ev.target) : null;
  if (!el) return false;
  if (ev.type === "click") return onClick(el, ctx);
  if (ev.type === "input") return onInput(el, ctx);
  if (ev.type === "change") return onChange(el, ctx);
  return false;
}

if (typeof window !== "undefined") {
  window.CVR_VIEW = { render, handle, review, resetView, opts, marketFor, H };
  if (typeof window.afterCvView === "function") window.afterCvView("cvcheck");
}
