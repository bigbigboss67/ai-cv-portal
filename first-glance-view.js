/**
 * The HTML of recruiter lens A and B (first-glance.js): the "First 6 seconds" panel
 * and the "What gets you rejected" card at the top of CV Review, and the same panel
 * for one job in Application review.
 *
 * Strings only, no DOM. Everything printed is one of: a Quote from the glance (the
 * candidate's own words or the posting's, escaped, with the hit marked), a label
 * from first-glance.js LABELS or VIEW_LABELS below, or a string the glance copied
 * from the review (a check title, rule, fix or note, a question, the candidate's
 * stored answer, the Fit check's reason). The helpers that quote and place a line
 * come in as H = {quoteHtml, whereOf, chip, esc} from cv-review-view.js, so both
 * tabs quote the same way and this module imports no view. Colours: the review's
 * BAND (through VERDICT_COLOUR) and SEV_COLOUR only, already contrast-checked on the
 * blueprint skin. No new CSS: every class exists in the page.
 */
import { LABELS, VERDICT_COLOUR } from "./first-glance.js";
import { SEV_COLOUR, BAND } from "./cv-review.js";

const S = (v) => (v == null ? "" : String(v));
const ESC = (s) => S(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** The view's own headings. Every other string it prints is the glance's. */
export const VIEW_LABELS = Object.freeze({
  eye: "What the eye lands on",
  stops: "What stops the read",
  clear: "Nothing in the top third stops the read.",
  must: "The posting's must-haves, where the eye meets them",
  fix: "Fix:",
});

function kit(H) {
  const h = H && typeof H === "object" ? H : {};
  const esc = typeof h.esc === "function" ? h.esc : ESC;
  return {
    esc,
    quote: typeof h.quoteHtml === "function" ? h.quoteHtml : (t) => esc(t),
    where: typeof h.whereOf === "function" ? h.whereOf : (p) => S(p),
    chip: typeof h.chip === "function" ? h.chip : () => "",
  };
}

/* A quote as the review shows one; a masked one only says so. */
function quoteBlock(q, T) {
  if (!q) return "";
  if (q.masked) return `<div class="hint">${T.esc(LABELS.masked)}</div>`;
  if (!S(q.text)) return "";
  return `<blockquote class="cvr-quote" dir="auto">${T.quote(q.text, q.hit)}</blockquote>`;
}
/* Where a line sits, in the candidate's own terms; the posting is "The posting". */
const placeOf = (path, P, T) => (/^posting\./.test(S(path)) ? LABELS.targetLine : S(path) ? T.where(path, P) : "");

/* One action button. A Builder fix inside CV Review uses the review's own handler
   (data-cvfix); in Application review the page's (data-fgfix). The scope label says
   who the change reaches. */
function actHtml(a, T, fixAttr) {
  if (!a || !a.label) return "";
  const scope = a.scope ? `<span class="hint">${T.esc(a.scope)}</span>` : "";
  if (a.to === "builder") return `<button class="btn sm" ${fixAttr}="${T.esc(`${S(a.step)}|${S(a.path)}`)}">${T.esc(a.label)}</button>${scope}`;
  if (a.to === "draft" || a.to === "match") return `<button class="btn sm" data-cvgo="${a.to}">${T.esc(a.label)}</button>${scope}`;
  return "";
}

function verdictTag(g, T) {
  const c = VERDICT_COLOUR[g.verdict] || VERDICT_COLOUR.maybe;
  return `<span class="tag" data-fg-verdict="${T.esc(g.verdict)}" style="border-color:${c};color:${c}">${T.esc(LABELS.verdict[g.verdict] || g.verdict)}</span>`;
}

/* The reasons, failing first. Direct children only: .ilist puts an arrow before every div. */
function reasonsHtml(g, T) {
  const list = [...g.reasons.filter((r) => !r.ok), ...g.reasons.filter((r) => r.ok)];
  return `<div class="ilist">${list.map((r) => `<div data-fg-reason="${T.esc(r.code)}" data-ok="${r.ok ? "1" : "0"}">${r.ok ? `<span>${T.esc(r.label)}</span>` : `<b>${T.esc(r.label)}</b>`}${Array.isArray(r.notes) && r.notes.length ? `<span class="hint">${r.notes.map(T.esc).join(" · ")}</span>` : ""}</div>`).join("")}</div>`;
}

function catchesHtml(g, P, T) {
  if (!g.catches.length) return "";
  return `<div class="lbl">${T.esc(VIEW_LABELS.eye)}</div>${g.catches.map((c) => {
    const at = placeOf(c.quote && c.quote.path, P, T);
    return `<div class="cvr-inst" data-fg-catch="${T.esc(c.code)}"><div class="cvr-where">${T.esc(c.label)}${at ? " · " + T.esc(at) : ""}</div>${quoteBlock(c.quote, T)}</div>`;
  }).join("")}`;
}

function killHtml(k, P, T, fixAttr) {
  const at = placeOf(k.quote ? k.quote.path : k.path, P, T);
  const title = k.title && k.title !== k.label ? `<span class="hint">${T.esc(k.title)}</span>` : "";
  return `<div class="cvr-inst" data-fg-kill="${T.esc(k.code)}"><div class="cvr-ch">${T.chip(k.sev)}<b>${T.esc(k.label)}</b>${title}${k.gate ? `<span class="tag">${T.esc(LABELS.gate)}</span>` : ""}</div>
${at ? `<div class="cvr-where">${T.esc(at)}</div>` : ""}${quoteBlock(k.quote, T)}${k.note ? `<div class="hint">${T.esc(k.note)}</div>` : ""}${k.against ? `<div class="cvr-where">${T.esc(k.against.label)}</div>${quoteBlock(k.against.quote, T)}` : ""}${k.alt ? `<div class="cvr-where">${T.esc(k.alt.label)}</div>${quoteBlock(k.alt.quote, T)}` : ""}
<div class="cvr-fix"><b>${T.esc(VIEW_LABELS.fix)}</b> ${T.esc(k.fix)}</div><div class="cvr-acts">${actHtml(k.act, T, fixAttr)}</div></div>`;
}

function killsHtml(list, P, T, fixAttr) {
  return `<div class="lbl">${T.esc(VIEW_LABELS.stops)}</div>${list.length ? list.map((k) => killHtml(k, P, T, fixAttr)).join("") : `<div class="hint">${T.esc(VIEW_LABELS.clear)}</div>`}`;
}

function head(g, T, title) {
  return `<h5>${T.esc(title)}</h5>
<div class="cvr-ch">${verdictTag(g, T)}<span class="hint">${T.esc(LABELS.target[g.target && g.target.source] || "")}</span></div>
<div class="hint">${T.esc(g.scope || LABELS.scope.top)}</div>`;
}

/**
 * A: the "First 6 seconds" panel of CV Review (no posting). The top-third problems
 * only; the one item that gets the CV rejected has its own card (rejectHtml).
 */
export function sixHtml(g, P, H) {
  if (!g || !Array.isArray(g.reasons)) return "";
  const T = kit(H);
  return `<div class="ipanel" id="fg6">${head(g, T, LABELS.title)}
${reasonsHtml(g, T)}
${catchesHtml(g, P, T)}
${killsHtml(g.kills.filter((k) => k.top), P, T, "data-cvfix")}</div>`;
}

/* One weak achievement with the review's own question for its figure. Answers are
   typed only in the Questions aside: "Answer →" opens it there, so no field is
   rendered twice. A skipped question's field sits in a closed list, so it offers
   "Ask again" instead. */
function weakHtml(w, P, T) {
  const why = w.why.map((x) => LABELS.weak[x] || x).join(" · ");
  const q = w.question;
  let qh = `<div class="hint">${T.esc(LABELS.noQuestion)}</div>`;
  if (q) {
    qh = (q.about === "role" ? `<div class="cvr-where">${T.esc(q.label || LABELS.aboutRole)}${placeOf(q.path, P, T) ? " · " + T.esc(placeOf(q.path, P, T)) : ""}</div>${quoteBlock(q.quote, T)}` : "")
      + `<div class="cvr-qt">${T.esc(q.text)}</div>`
      + (q.state === "answered" && S(q.answer) ? `<div class="hint">${T.esc(LABELS.answer)}: ${T.esc(q.answer)}</div>` : "");
  }
  const acts = !q ? actHtml(w.act, T, "data-cvfix")
    : q.state === "skipped" ? `<button class="cvr-link" data-cvq-unskip="${T.esc(q.key)}">${T.esc(LABELS.act.askAgain)}</button>`
    : `<button class="cvr-link" data-fg-q="${T.esc(q.key)}">${T.esc(LABELS.act.answer)}</button><button class="btn sm" data-cvq-use="${T.esc(q.key)}">${T.esc(LABELS.act.use)}</button>`;
  const path = w.quote ? w.quote.path : "";
  return `<div class="cvr-inst" data-fg-weak="${T.esc(path)}"><div class="cvr-where">${T.esc(placeOf(path, P, T))} · ${T.esc(why)}</div>${quoteBlock(w.quote, T)}${qh}<div class="cvr-acts">${acts}</div></div>`;
}

/**
 * B: "What gets you rejected" — the one item, then the three weakest achievements
 * and the formula as guidance only. With nothing to reject, the card says so and
 * still lists the weak lines.
 */
export function rejectHtml(g, P, H) {
  if (!g || !Array.isArray(g.weakest)) return "";
  const T = kit(H), rj = g.reject;
  const ac = rj ? SEV_COLOUR[rj.sev] || SEV_COLOUR.med : BAND.ready;
  const top = `<div class="cvr-ch">${rj ? T.chip(rj.sev) : ""}<h3>${T.esc(LABELS.kill["K-REJECT"])}</h3>${rj && rj.gate ? `<span class="tag">${T.esc(LABELS.gate)}</span>` : ""}</div>`;
  const at = rj ? placeOf(rj.quote ? rj.quote.path : rj.path, P, T) : "";
  const body = rj
    ? `<div class="cvr-where" data-fg-reject="${T.esc(rj.check)}">${T.esc(rj.title)}${at ? " · " + T.esc(at) : ""}</div>${quoteBlock(rj.quote, T)}${rj.note ? `<div class="hint">${T.esc(rj.note)}</div>` : ""}<div class="hint">${T.esc(rj.why)}</div><div class="cvr-fix"><b>${T.esc(VIEW_LABELS.fix)}</b> ${T.esc(rj.fix)}</div><div class="cvr-acts">${actHtml(rj.act, T, "data-cvfix")}</div>`
    : `<div class="hint">${T.esc(LABELS.noReject)}</div>`;
  const weak = g.weakest.length ? g.weakest.map((w) => weakHtml(w, P, T)).join("") : `<div class="hint">${T.esc(LABELS.noWeak)}</div>`;
  return `<div class="job cvr-card" id="fgReject" style="--ac:${ac}">${top}
${body}
<div class="lbl">${T.esc(LABELS.weakTitle)}</div>${weak}
<div class="hint">${T.esc(g.formula || LABELS.formula)}</div></div>`;
}

function callHtml(c, P, T) {
  const cls = { keep: " hit", move: " hit", "in-cv": " hit", gap: " gap" }[c.state] || "";
  const term = c.term && S(c.term.text) ? c.term.text : c.k;
  const at = c.quote ? placeOf(c.quote.path, P, T) : "";
  return `<div class="cvr-inst" data-fg-call="${T.esc(c.state)}"><div class="cvr-ch"><span class="tag${cls}">${T.esc(term)}</span><span class="hint">${T.esc(c.label)}</span></div>${c.quote ? `${at ? `<div class="cvr-where">${T.esc(at)}</div>` : ""}${quoteBlock(c.quote, T)}` : ""}${c.act ? `<div class="cvr-acts">${actHtml(c.act, T, "data-fgfix")}</div>` : ""}</div>`;
}

/**
 * A for one job, in Application review: judged against the posting's title and its
 * must-haves (the keyword report Match shows), over this job's CV as the Draft
 * prints it. Every button says who its change reaches.
 */
export function postingHtml(g, P, H) {
  if (!g || !Array.isArray(g.reasons)) return "";
  const T = kit(H);
  const call = g.callNow.length ? `<div class="lbl">${T.esc(VIEW_LABELS.must)}</div>${g.callNow.map((c) => callHtml(c, P, T)).join("")}` : "";
  return `<div class="ipanel" id="fg6job">${head(g, T, g.mode === "posting" ? LABELS.titlePosting : LABELS.title)}
${reasonsHtml(g, T)}
${call}${catchesHtml(g, P, T)}
${killsHtml(g.kills, P, T, "data-fgfix")}</div>`;
}
