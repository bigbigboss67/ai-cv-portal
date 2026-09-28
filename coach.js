/**
 * The CV read the way a hiring director reads it, and the rung above the one it
 * is written for.
 *
 * Two rules hold this together. First, every finding points at a line that is
 * actually in the CV — a rewrite is offered as a pattern with the figure left
 * blank, never with a number invented to fill it. Second, the ladder is built
 * from the level and the function the CV itself states; it does not promote
 * anyone into a field their record never mentions.
 *
 * Pure and English/German aware, so the Node tests run what the page runs.
 */

/* ------------------------------------------------------------------ reading */

const lower = (s) => String(s == null ? "" : s).toLowerCase();
const words = (s) => String(s || "").trim().split(/\s+/).filter(Boolean);
const bulletsOf = (p) => (p && p.experience ? p.experience : []).flatMap((e) => (e.bullets || []).map((b) => String((b && b.x) || b || "")));

/** A figure a recruiter can size the claim with: a count, a percentage or money. */
export const FIGURE = /(?:^|[^\p{L}\p{N}])(?:\d[\d.,']*\s*(?:%|percent|prozent|m\b|mn\b|bn\b|k\b|million|milliarde|mio|tsd)?|(?:aed|usd|eur|gbp|sar|qar|chf|€|\$|£)\s*\d)/iu;

/* Openers that describe a job description rather than what the person did. */
const WEAK_EN = [
  /^responsible for\b/i, /^duties (?:included|were)\b/i, /^tasked with\b/i, /^worked (?:on|with|as)\b/i,
  /^helped\b/i, /^assisted (?:with|in)\b/i, /^involved in\b/i, /^participated in\b/i, /^in charge of\b/i,
  /^part of\b/i, /^supported\b/i,
];
const WEAK_DE = [
  /^verantwortlich für\b/i, /^zuständig für\b/i, /^mitarbeit (?:bei|an)\b/i, /^unterstützung (?:bei|der)\b/i,
  /^aufgaben\b/i, /^tätigkeiten\b/i, /^beteiligt an\b/i,
];
export const WEAK_OPENERS = [...WEAK_EN, ...WEAK_DE];

/* A line that already opens on an act needs no verb offered. */
const STRONG_VERB = /^(?:[a-z]+ed|led|ran|won|cut|grew|built|drove|set|sold|took|made|met|held|kept|saw|oversaw|began|brought|chose|left|führte|leitete|baute|gewann|senkte|steigerte|verhandelte)\b/i;

/* Claims with no content. Each is either cut or replaced by the fact behind it. */
export const BUZZWORDS = [
  "dynamic", "motivated", "hard-working", "hardworking", "team player", "results-oriented", "results-driven",
  "proven track record", "go-getter", "passionate", "detail-oriented", "self-starter", "synergy", "synergies",
  "thought leader", "guru", "ninja", "rockstar", "out of the box", "think outside the box", "excellent communication skills",
  "dynamisch", "motiviert", "teamfähig", "belastbar", "zuverlässig", "engagiert", "kommunikationsstark", "flexibel",
];

const PRONOUN = /(?:^|[^\p{L}])(?:i|my|me|ich|mein|meine|meiner)(?:[^\p{L}]|$)/iu;

/* Facts an employer may not ask for in the EU and does not need anywhere: they
   only give a screener something to filter on before reading the record. */
const PERSONAL = [
  [/\b(date of birth|geburtsdatum|geboren am|d\.o\.b\.?|dob)\b/i, "date of birth"],
  [/\b(marital status|familienstand|married|single|verheiratet|ledig)\b/i, "marital status"],
  [/\b(photo|photograph|lichtbild|bewerbungsfoto)\b/i, "a photo"],
  [/\b(religion|konfession)\b/i, "religion"],
];

const firstVerb = (b) => lower(b).replace(/^[^\p{L}]+/u, "").split(/\s+/)[0] || "";

/* ------------------------------------------------------------------ the review */

const sev = { high: 3, med: 2, low: 1 };

/**
 * @param {object} profile  as the CV parser returns it
 * @param {string} text     the CV text the parser read, for what the profile drops
 * @returns {{stats: object, wins: string[], fixes: object[]}}
 */
export function reviewCv(profile, text = "") {
  const p = profile || {};
  const raw = String(text || "");
  const bl = bulletsOf(p);
  const roles = p.experience || [];
  const fixes = [];
  const wins = [];
  const add = (severity, id, what, why, how, examples = []) => fixes.push({ id, severity, what, why, how, examples });

  const withFigure = bl.filter((b) => FIGURE.test(b));
  const pct = bl.length ? Math.round((withFigure.length / bl.length) * 100) : 0;

  /* 1. Figures. The single strongest predictor of an interview at manager level
        and above: a claim without magnitude reads as an opinion. */
  if (bl.length && pct < 50) {
    add(pct < 20 ? "high" : "med", "figures",
      `Only ${pct}% of your ${bl.length} bullet points carry a number`,
      "A director-level screener reads for magnitude — revenue, headcount, margin, budget, deal size. A line without one describes activity; a line with one describes a result, and is the line that gets quoted in the shortlist meeting.",
      "Take your three strongest lines and put the figure in front: what moved, by how much, over what period. If you cannot verify a number, give the scale instead — team size, number of sites, contract count.",
      bl.filter((b) => !FIGURE.test(b)).slice(0, 3).map((b) => ({ from: b, to: toPattern(b) })));
  } else if (bl.length) {
    wins.push(`${pct}% of your bullets carry a figure — that is above what most CVs at this level manage.`);
  }

  /* 2. Weak openers. */
  const weak = bl.filter((b) => WEAK_OPENERS.some((re) => re.test(b.trim())));
  if (weak.length) {
    add(weak.length > 2 ? "high" : "med", "openers",
      `${weak.length} ${weak.length === 1 ? "line starts" : "lines start"} with the job description, not the work`,
      "“Responsible for” and “Verantwortlich für” describe the post, which the title already did. The reader learns nothing about whether you were any good at it.",
      "Open with a verb that has an outcome behind it — led, built, won, cut, opened, turned around, negotiated — then the object, then the result.",
      weak.slice(0, 3).map((b) => ({ from: b, to: toPattern(b) })));
  }

  /* 3. Buzzwords. */
  const hay = " " + lower([...bl, ...Object.values(p.summary || {})].join(" · ")) + " ";
  const buzz = BUZZWORDS.filter((w) => hay.includes(" " + w) || hay.includes(w + " "));
  if (buzz.length) {
    add(buzz.length > 3 ? "med" : "low", "buzzwords",
      `${buzz.length} claim${buzz.length === 1 ? "" : "s"} nobody can check: ${buzz.slice(0, 5).join(", ")}`,
      "Every candidate writes these, so they carry no information and cost you the line they occupy. A screener skips them.",
      "Delete the adjective and keep the fact that made you write it. “Proven track record” becomes the track record itself.");
  }

  /* 4. Pronouns. */
  const pron = bl.filter((b) => PRONOUN.test(b));
  if (pron.length > 1) {
    add("low", "pronouns", `${pron.length} lines use “I” or “my”`,
      "A CV is written in an implied first person; the pronoun is assumed. Spelling it out reads as a letter, not a record.",
      "Cut the pronoun and start at the verb.",
      pron.slice(0, 2).map((b) => ({ from: b, to: b.replace(/^\s*I\s+/i, "").replace(/^\s*ich\s+/i, "") })));
  }

  /* 5. The summary. */
  const sum = Object.values(p.summary || {}).find((s) => String(s || "").trim()) || "";
  const sw = words(sum).length;
  if (!sum) {
    add("high", "summary", "There is no profile summary at the top",
      "The screener gives a CV about seven seconds before deciding to read on. Those seconds are spent at the top of page one, and yours starts with a job title and a date.",
      "Three lines, no more: your level and sector, the scale you have run, and the role you are applying for. Say what you want next — a CV that does not is read as a CV sent everywhere.");
  } else if (sw > 80) {
    add("med", "summary", `Your summary runs to ${sw} words`,
      "Past roughly sixty words a summary stops being read and becomes a paragraph the eye jumps over.",
      "Cut it to three lines. Keep level, sector, scale and the ask; move everything else into the roles where it can be dated and evidenced.");
  } else if (!FIGURE.test(sum)) {
    add("low", "summary", "Your summary carries no figure",
      "The first paragraph is where you set your size — how many people, how much revenue, how many markets. Without it the reader assigns you a level by guessing.",
      "Put one number in the first line: headcount led, revenue owned, or markets covered.");
  } else {
    wins.push("Your summary states scale in the first lines, which is where a screener looks for it.");
  }

  /* 6. Roles that never state their size. */
  const unsized = roles.filter((e) => !FIGURE.test([e.t, e.c, ...(e.bullets || []).map((b) => (b && b.x) || b)].join(" ")));
  if (unsized.length) {
    add(unsized.length > 1 ? "med" : "low", "scale",
      `${unsized.length} role${unsized.length === 1 ? " never says" : "s never say"} how big the job was`,
      "Two people with the same title can be running a corner shop or a region. The reader has no way to tell yours apart, so they assume the smaller one.",
      "Give each role a scale line: team size, budget or revenue, number of sites or markets.",
      unsized.slice(0, 3).map((e) => ({ from: [e.t, e.c].filter(Boolean).join(", "), to: `${e.t || "Role"}, ${e.c || "Company"} — [team size] staff · [budget or revenue] · [sites or markets]` })));
  }

  /* 7. The same verb over and over. */
  const verbs = {};
  for (const b of bl) { const v = firstVerb(b); if (v.length > 3) verbs[v] = (verbs[v] || 0) + 1; }
  const overused = Object.entries(verbs).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]);
  if (overused.length) {
    add("low", "verbs", `“${overused[0][0]}” opens ${overused[0][1]} of your lines`,
      "Repetition flattens the record: every role starts to read as the same job at a different address.",
      "Vary the verb to the actual act — won, negotiated, opened, restructured, cut, launched, recovered, consolidated.");
  }

  /* 8. Length. */
  if (bl.length > 28) {
    add("med", "length", `${bl.length} bullet points across ${roles.length} roles`,
      "Past two pages a CV is skimmed rather than read, and the lines that suffer are the recent ones at the top, which are the ones that matter.",
      "Keep five or six lines for the last two roles, two or three for the ones before, and compress anything over fifteen years old into one “Earlier career” line.");
  }

  /* 9. What the parser could not find. An applicant tracking system reads the
        same text layer this page just read, so a gap here is a gap there. */
  const missing = [];
  if (!String(p.email || "").trim()) missing.push("an email address");
  if (!String(p.phone || "").trim()) missing.push("a phone number");
  if (!roles.length) missing.push("any dated work history");
  if (missing.length) {
    add("high", "ats", `The reader could not find ${missing.join(" or ")} in your file`,
      "This page reads the same text layer an applicant tracking system reads. What it missed, the system misses — and a record with no contact detail is closed rather than chased.",
      "Put the contact block in the body of the document as plain text, not in a header, footer, text box, table or image. Re-export, drop the file in again, and check the fields above fill in.");
  } else {
    wins.push("Your contact details sit in the text layer where an applicant tracking system can read them.");
  }

  /* 10. Detail on roles that ended long ago. */
  const thisYear = new Date().getFullYear();
  const old = roles.filter((e) => { const y = (String(e.d || "").match(/\b(19|20)\d{2}\b/g) || []).map(Number).pop(); return y && thisYear - y > 15 && (e.bullets || []).length > 2; });
  if (old.length) {
    add("low", "earlier", `${old.length} role${old.length === 1 ? "" : "s"} over fifteen years old still carry full detail`,
      "Space at the top of page one is what decides the read, and it is being spent on work nobody will ask about.",
      "Compress them into one line: “Earlier career: [titles] at [companies], [years].”");
  }

  /* 11. Personal data. */
  const found = PERSONAL.filter(([re]) => re.test(raw)).map(([, label]) => label);
  if (found.length) {
    add("med", "personal", `Your CV states ${found.join(", ")}`,
      "In the EU and the UK this is information an employer may not ask for, and a screener who reads it has to prove afterwards that it changed nothing. Some Gulf employers do screen on nationality, so that one is a judgement call by market — the rest are not.",
      "Take them out. Keep work rights, which is the thing an employer actually needs: “German passport (EU)” or the visa you hold.");
  }

  const score = Math.max(0, Math.min(100, 100 - fixes.reduce((n, f) => n + sev[f.severity] * 9, 0)));
  fixes.sort((a, b) => sev[b.severity] - sev[a.severity]);
  return {
    stats: { bullets: bl.length, withFigure: withFigure.length, pctFigure: pct, roles: roles.length, weak: weak.length, buzz: buzz.length, score },
    wins,
    fixes,
  };
}

/** A weak line turned into the shape of a strong one. The figures stay blank: an invented number is the one CV error that survives to the reference call. */
export function toPattern(bullet) {
  const raw = String(bullet || "").trim().replace(/\s+/g, " ");
  const german = WEAK_DE.some((re) => re.test(raw));
  let s = raw;
  for (const re of WEAK_OPENERS) s = s.replace(re, "");
  s = s.replace(/^[\s:,\-–—]+/, "");
  s = s.replace(/^(managing|leading|running|handling|overseeing|developing|building)\b/i, (m) => ({ managing: "Led", leading: "Led", running: "Ran", handling: "Handled", overseeing: "Directed", developing: "Built", building: "Built" })[m.toLowerCase()]);
  /* Strip the opener off "Responsible for the retail operation" and a noun phrase
     is left. The verb is the person's to choose — offering three is coaching;
     picking one for them would put a claim in their mouth. */
  const verb = s && !STRONG_VERB.test(s) ? (german ? "[Geführt / Aufgebaut / Gesenkt] " : "[Led / Ran / Built / Won] ") : "";
  if (s && !verb) s = s[0].toUpperCase() + s.slice(1);
  return (verb + s || "[what you did]") + (FIGURE.test(s) ? "" : " — [figure: value, headcount or %] over [period]");
}

/* ------------------------------------------------------------------ the ladder */

/* Most specific first: "managing director" is executive, not director. */
export const RUNGS = [
  { id: "exec", label: "Executive", rx: /\b(managing director|general manager|chief [a-z]+ officer|ceo|coo|cfo|cto|cmo|president|owner|founder|geschäftsführer)\b/i },
  { id: "director", label: "Director", rx: /\b(director|vice president|vp|partner|principal|head of)\b/i },
  { id: "senior", label: "Senior manager", rx: /\b(senior manager|regional manager|country manager|area manager|senior)\b/i },
  { id: "manager", label: "Manager", rx: /\b(manager|supervisor|team lead|lead|leiter)\b/i },
  { id: "entry", label: "Specialist", rx: /\b(intern|trainee|graduate|assistant|coordinator|officer|analyst|executive assistant)\b/i },
];

const FUNCTIONS = [
  [/\b(operations|operational|betrieb)\b/i, "operations"],
  [/\b(sales|vertrieb|commercial)\b/i, "sales"],
  [/\b(finance|financial|finanz|controlling|treasury)\b/i, "finance"],
  [/\b(marketing|brand)\b/i, "marketing"],
  [/\b(human resources|hr|people|personal)\b/i, "people"],
  [/\b(supply chain|logistics|procurement|purchasing|einkauf)\b/i, "supply chain"],
  [/\b(real estate|property|development|construction|projekt)\b/i, "real estate"],
  [/\b(business development|market entry|expansion)\b/i, "business development"],
  [/\b(technology|engineering|it|software|digital)\b/i, "technology"],
];

/* What the rung above actually asks to see, and the words that show it. */
export const EVIDENCE = [
  { id: "pl", label: "P&L ownership", rx: /\b(p&l|profit and loss|ebitda|gross margin|bottom line|umsatzverantwortung|budgetverantwortung|revenue responsibility)\b/i },
  { id: "board", label: "Board and shareholder exposure", rx: /\b(board|shareholder|investor|governance|vorstand|aufsichtsrat|gesellschafter)\b/i },
  { id: "scale", label: "Headcount at scale", rx: /\b\d{2,}\s*(?:\+\s*)?(?:staff|employees|people|mitarbeiter|fte|headcount)\b/i },
  { id: "multi", label: "More than one market", rx: /\b(multi-country|across (?:the )?(?:gcc|gulf|mena|region|europe)|international|regional|several markets|mehrere länder)\b/i },
  { id: "change", label: "Change delivered", rx: /\b(?:restructur\w*|turn-?around|post-merger|integration|m&a|acquisitions?|market entry|greenfield|sanierung|umstrukturierung)\b/i },
  /* Not bare “capital”: half the holding companies in the Gulf are called one.
     Funding has to be named as funding before it counts as funding experience. */
  { id: "capital", label: "Capital or funding", rx: /\b(?:fundrais\w*|capital rais\w*|rais\w* (?:capital|finance|funding)|capital markets|working capital|investor relations|private equity|venture capital|(?:debt|equity|project) financ\w*|series [a-d]|kapitalbeschaffung|finanzierungsrunde)\b/i },
];

/* Each rung's next step. The function noun is filled from the CV; where the CV
   names none, the generic title is used rather than a guess. */
const NEXT = {
  entry: (fn) => [[fn ? `${fn} manager` : "Manager", ["pl", "scale"]], [fn ? `Team lead, ${fn}` : "Team lead", ["scale"]]],
  manager: (fn) => [[fn ? `Senior ${fn} manager` : "Senior manager", ["scale", "pl"]], [fn ? `Head of ${fn}` : "Head of department", ["pl", "change"]]],
  senior: (fn) => [[fn ? `Head of ${fn}` : "Head of department", ["pl", "change"]], [fn ? `${fn} director` : "Director", ["pl", "board"]]],
  director: (fn) => [["Managing director", ["pl", "board", "scale"]], ["General manager", ["pl", "scale", "multi"]], [fn ? `VP ${fn}` : "Vice president", ["pl", "multi"]], ["Chief operating officer", ["pl", "change", "scale"]]],
  exec: () => [["Group chief executive", ["pl", "board", "multi", "capital"]], ["Regional managing director", ["pl", "multi", "scale"]], ["Non-executive director / board seat", ["board", "change"]], ["Managing partner / principal", ["capital", "board"]]],
};

export function rungOf(profile) {
  const titles = [(profile && profile.title && (profile.title.en || profile.title.de)) || "", ...((profile && profile.experience) || []).slice(0, 3).map((e) => e.t)].join(" · ");
  return RUNGS.find((r) => r.rx.test(titles)) || RUNGS[RUNGS.length - 1];
}

export function functionOf(profile, text = "") {
  const titles = ((profile && profile.experience) || []).map((e) => e.t).join(" · ");
  const hit = FUNCTIONS.find(([rx]) => rx.test(titles)) || FUNCTIONS.find(([rx]) => rx.test(String(text).slice(0, 4000)));
  return hit ? hit[1] : "";
}

/**
 * The rung above the one the CV is written for, what each option would need,
 * and which of them this record already supports.
 */
export function ladder(profile, text = "") {
  const hay = [text, JSON.stringify(profile || {})].join(" · ");
  const have = new Set(EVIDENCE.filter((e) => e.rx.test(hay)).map((e) => e.id));
  const rung = rungOf(profile);
  const fn = functionOf(profile, text);
  const options = (NEXT[rung.id] || NEXT.manager)(fn).map(([title, needs]) => {
    const evidence = needs.filter((n) => have.has(n));
    const gaps = needs.filter((n) => !have.has(n));
    const name = (id) => (EVIDENCE.find((e) => e.id === id) || { label: id }).label;
    return { title, evidence: evidence.map(name), gaps: gaps.map(name), fit: needs.length ? Math.round((evidence.length / needs.length) * 100) : 0 };
  });
  options.sort((a, b) => b.fit - a.fit || a.gaps.length - b.gaps.length);
  return { current: { id: rung.id, label: rung.label }, fn, have: [...have], options, best: options[0] || null };
}

/** The search terms for the rung above — used as the second track of the search. */
export function stepUpTitles(profile, text = "") {
  return ladder(profile, text).options.map((o) => o.title).filter((t) => !/non-executive|board seat/i.test(t)).slice(0, 2);
}
