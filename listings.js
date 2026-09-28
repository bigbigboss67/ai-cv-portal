/**
 * Show the listings the scheduled fetcher collected.
 *
 * data/listings.json is written by .github/workflows/fetch-listings.yml, which
 * runs scripts/fetch-listings.mjs daily. A static site cannot fetch these pages
 * itself — both block cross-origin requests — so Actions does it and commits
 * the result.
 */

const FEED = "./data/listings.json";
let feed = null;

async function load() {
  if (feed) return feed;
  const res = await fetch(FEED, { cache: "no-store" });
  if (!res.ok) throw new Error(`listings.json — HTTP ${res.status}`);
  feed = await res.json();
  return feed;
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/**
 * These URLs come from scraped third-party pages, so they are untrusted input.
 * Escaping alone would still let a `javascript:` href through. Allow only http
 * and https, and drop anything else to a dead link rather than rendering it.
 */
const safeUrl = (u) => {
  try {
    const p = new URL(String(u), location.href);
    return p.protocol === "http:" || p.protocol === "https:" ? p.href : "#";
  } catch {
    return "#";
  }
};

const ago = (iso) => {
  const h = (Date.now() - new Date(iso)) / 36e5;
  if (h < 1) return "just now";
  if (h < 24) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} d ago`;
};

/** UAE relevance, so the Gulf roles are not buried under the global ones. */
const isUae = (j) => /uae|dubai|abu dhabi|sharjah|emirat|gulf|gcc/i.test(`${j.title} ${j.location}`);

/* Rows are taken from each source in turn, newest first within a source where the board gives
   a date — so the boards without dates are not buried under the ones with them, and every
   source shows near the top. */
function interleave(list) {
  const bySrc = new Map();
  for (const j of list) {
    if (!bySrc.has(j.src)) bySrc.set(j.src, []);
    bySrc.get(j.src).push(j);
  }
  for (const rows of bySrc.values()) rows.sort((a, b) => String(b.posted || "").localeCompare(String(a.posted || "")));
  const queues = [...bySrc.values()];
  const out = [];
  while (queues.some((q) => q.length)) for (const q of queues) if (q.length) out.push(q.shift());
  return out;
}

/* A long list shows its first rows until "Show all" is pressed; the choice survives the
   portal re-drawing the pane. */
const CAP = 40;
const showAll = { uae: false, rest: false };

function render(box, data) {
  const all = data.sources.flatMap((s) => s.jobs.map((j) => ({ ...j, src: s.id })));
  const uae = interleave(all.filter(isUae));
  const rest = interleave(all.filter((j) => !isUae(j)));

  const row = (j) => `
    <div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:baseline;
                padding:9px 0;border-bottom:1px solid var(--shell-line,#22304f)">
      <div><a href="${esc(safeUrl(j.url))}" target="_blank" rel="noopener noreferrer"
              style="color:inherit;text-decoration:none;border-bottom:1px solid rgba(201,162,74,.4)">${esc(j.title)}</a>
        <div class="hint" style="margin-top:2px">${esc(j.company)}${j.location ? " · " + esc(j.location) : ""}${j.posted ? " · posted " + esc(j.posted) : ""}</div></div>
      <span class="tag">${esc(j.src)}</span>
    </div>`;
  const group = (key, list) => (showAll[key] ? list : list.slice(0, CAP)).map(row).join("")
    + (!showAll[key] && list.length > CAP
      ? `<div style="padding:10px 0"><button class="btn sm" data-lshow="${key}">Show all ${list.length}</button></div>` : "");

  // A source that loaded but matched nothing is stated as unresolved, not as
  // "nothing open" — those look identical in the data and only one is good news.
  const health = data.sources
    .map((s) => {
      if (!s.ok) return `<span class="tag gap">${esc(s.id)} — failed: ${esc(s.error)}</span>`;
      if (!s.count) return `<span class="tag gap">${esc(s.id)} — 0 matched, parser unverified</span>`;
      return `<span class="tag">${esc(s.id)} — ${s.count}</span>`;
    })
    .join(" ");

  box.innerHTML = `
    <div class="ipanel">
      <h5>Fetched listings · ${all.length}</h5>
      <div class="hint" style="margin-bottom:8px">
        Collected ${esc(ago(data.generatedAt))} by the scheduled fetcher. ${health}
      </div>
      ${uae.length
        ? `<div class="hint" style="margin:10px 0 2px"><b>UAE and Gulf — ${uae.length}</b></div>${group("uae", uae)}`
        : `<div class="hint" style="margin:10px 0">No UAE or Gulf role in this run.</div>`}
      ${rest.length
        ? `<div class="hint" style="margin:14px 0 2px">Elsewhere — ${rest.length}</div>${group("rest", rest)}`
        : ""}
    </div>`;
}

async function mount() {
  // The Sources view is the natural home; it already lists where roles come from.
  const pane = document.querySelector("#pane");
  if (!pane || document.querySelector("#liveListings")) return;
  // The Sources view is built from .panel cards, not the .ipanel side-panel cards
  // the Draft view uses — anchor to whichever exists, and fall back to the pane itself.
  const anchor = pane.querySelector(".panel, .ipanel, .blank");

  const box = document.createElement("div");
  box.id = "liveListings";
  box.style.cssText = "padding:18px 22px 0;display:grid;gap:14px";
  if (anchor && anchor.parentElement) anchor.parentElement.insertBefore(box, anchor);
  else pane.prepend(box);
  box.innerHTML = `<div class="ipanel"><h5>Fetched listings</h5><div class="hint">Loading…</div></div>`;
  box.addEventListener("click", (e) => {
    const b = e.target.closest("[data-lshow]");
    if (!b || !feed) return;
    showAll[b.dataset.lshow] = true;
    render(box, feed);
  });

  try {
    render(box, await load());
  } catch (err) {
    box.innerHTML = `<div class="ipanel"><h5>Fetched listings</h5>
      <div class="hint">Not available — ${esc(err.message)}.<br>
      The file appears once the <b>Fetch job listings</b> workflow has run at least once.</div></div>`;
  }
}

// Only on the Sources tab, and the portal re-renders its pane constantly.
new MutationObserver(() => {
  const onSources = document.querySelector('.tab[data-t="sources"][aria-current="true"]');
  if (onSources) mount();
}).observe(document.body, { childList: true, subtree: true });

mount();
