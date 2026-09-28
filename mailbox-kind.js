/**
 * Three kinds of mailbox. An application one is filled in; a general one (info@,
 * contact@, a person's name) is offered as a choice and labelled so; one that is
 * never for a CV (press@, sales@, customersupport@...) is not offered at all — a
 * site's only address being media@ does not make it the place to apply.
 *
 * A mailbox is judged by words only when every part of its name is made of known
 * words: "customer.support", "uaesales", "careers-dubai", "hr1". Anything else is a
 * person or something unknown, and stays a general address that is offered, never
 * hidden and never filled in. Matching stems inside names hid real people —
 * Newsome, Pressman, Billingsley and Maria Sales all read as "never" — and made
 * Steve Jobs an application box.
 *
 * Its own module because both the server (api/site.js, through linkedin-company.js)
 * and the page (fetch-address.js) judge addresses, and must judge them the same way.
 */

const words = (s) => s.split(/\s+/).filter(Boolean);
/* Recruiting, in the portal's languages and the Gulf's transliterations. */
const STRONG = new Set(words(`career careers karriere carriere carrieres job jobs recruit recruits recruiting recruitment
  recruiter recruiters talent talents hiring hire vacancy vacancies bewerbung bewerbungen stellen stelle emploi emplois
  empleo empleos recrutement candidat candidats candidate candidates candidature candidatures cvs resume resumes apply
  application applications employment rrhh wazaif wazayef wadhaif tawzeef tawdheef tawzif trabajo seleccion join opportunities`));
/* The HR department: an application box unless the rest of the name says otherwise. */
const WEAK = new Set(words(`hr hrd people personal personnel personalabteilung humanresources`));
/* Never for a CV. */
const NEVER = new Set(words(`press presse media news marketing sales vertrieb ventas ventes vendas support help helpdesk
  service services dienst billing invoice invoices invoicing rechnung rechnungen accounts account accounting finance
  security legal compliance fraud investor investors webmaster event events partner partners partnership partnerships
  procurement purchasing purchase einkauf complaint complaints newsletter booking bookings reservation reservations
  tender tenders payroll feedback order orders shop store returns care`));
/* Words that say nothing about the kind but are not a person: general inboxes,
   modifiers and places. */
const NEUTRAL = new Set(words(`info information contact contacts hello mail office admin administration enquiries enquiry
  inquiries inquiry reception general team the our with and for work dept department desk head group global intl
  international local regional central main online digital corporate corp customer customers client clients kunden tech
  technical after pre angebote acquisition human resources culture post web staff all relations
  dubai uae abudhabi abu dhabi auh dxb sharjah shj ajman rak fujairah alain ksa saudi riyadh ruh jeddah jed dammam khobar
  qatar doha bahrain kuwait oman muscat gcc mena emea middleeast middle east africa asia europe london germany deutschland
  berlin muenchen munich hamburg frankfurt koeln cologne duesseldorf stuttgart austria wien vienna zurich zuerich geneva
  switzerland egypt cairo jordan amman lebanon beirut india mumbai delhi pakistan karachi usa america france paris spain
  madrid italy milan`));
/* Two letters are a word only as a whole part ("ta@", "hr.uae@", "careers.sa@"),
   except these three, which also build compounds ("hrdubai", "itsupport", "joinus"). */
const SHORT = new Map(Object.entries({ cv: "strong", ta: "strong", hr: "weak", pr: "never", ir: "never",
  ae: "neutral", sa: "neutral", de: "neutral", at: "neutral", ch: "neutral", uk: "neutral", us: "neutral", eu: "neutral",
  me: "neutral", in: "neutral", eg: "neutral", jo: "neutral", lb: "neutral", qa: "neutral", kw: "neutral", bh: "neutral",
  om: "neutral", it: "neutral" }));
const IN_COMPOUND = new Set(["hr", "it", "us"]);
/* Places that are also given names. First in a name of two or more parts they are a
   person ("jordan.sales@", "doha.press@", "alain.carriere@"), never a department. */
const GIVEN = new Set(words(`jordan paris milan india vienna geneva alain jed doha riyadh london`));
/* Places. First in a name of two or more parts, a place may be a person's given name
   ("jo.sales@", "france.press@"), so such a mailbox is offered, never hidden. */
const PLACES = new Set(words(`dubai uae abudhabi abu dhabi auh dxb sharjah shj ajman rak fujairah alain ksa saudi riyadh ruh
  jeddah jed dammam khobar qatar doha bahrain kuwait oman muscat gcc mena emea middleeast middle east africa asia europe london
  germany deutschland berlin muenchen munich hamburg frankfurt koeln cologne duesseldorf stuttgart austria wien vienna zurich
  zuerich geneva switzerland egypt cairo jordan amman lebanon beirut india mumbai delhi pakistan karachi usa america france
  paris spain madrid italy milan ae sa de at ch uk us eu me in eg jo lb qa kw bh om`));
const PHRASE = /^(joinus|jointheteam|joinourteam|workwithus|workforus|humanresources|peopleandculture)$/;

const kindOf = (w) => STRONG.has(w) ? "strong" : WEAK.has(w) ? "weak" : NEVER.has(w) ? "never" : NEUTRAL.has(w) ? "neutral" : SHORT.get(w) || "";

/* A part as a run of known words (and digits), or null when it is not one. */
function segment(part, extra) {
  const n = part.length, best = new Array(n + 1).fill(null);
  best[0] = [];
  for (let i = 0; i < n; i++) {
    if (!best[i]) continue;
    const d = /^\d+/.exec(part.slice(i));
    if (d && !best[i + d[0].length]) best[i + d[0].length] = [...best[i], d[0]];
    for (let j = i + 2; j <= n; j++) {
      const w = part.slice(i, j);
      const known = (w.length >= 3 && (kindOf(w) || extra.has(w))) || (w.length === 2 && SHORT.has(w) && (IN_COMPOUND.has(w) || (i === 0 && j === n)));
      if (known && !best[j]) best[j] = [...best[i], w];
    }
  }
  return best[n];
}

export function mailboxKind(address) {
  const [local = "", domain = ""] = String(address || "").toLowerCase().split("@");
  /* The company's own name may be part of a box: "acmejobs@acme.com". */
  const extra = new Set(domain.split(".").filter((l) => l.length >= 3 && !/^(com|net|org|www|gov|edu)$/.test(l)));
  const parts = local.split(/[._+-]+/).filter(Boolean);
  if (!parts.length) return "general";
  if (parts.length > 1 && GIVEN.has(parts[0])) return "general";
  const found = [];
  for (const p of parts) {
    const seg = PHRASE.test(p) ? [p] : segment(p, extra);
    if (!seg) return "general";
    found.push(...seg);
  }
  const whole = parts.join("");
  const has = (k) => found.some((w) => kindOf(w) === k);
  const strong = has("strong") || /^(joinus|jointheteam|joinourteam|workwithus|workforus)$/.test(whole);
  const weak = has("weak") || /humanresources|peopleandculture/.test(whole);
  if (strong) return "apply";
  if (has("never")) return weak || PLACES.has(parts[0]) && parts.length > 1 ? "general" : "never";
  return weak ? "apply" : "general";
}

/**
 * An address as printed, cut back to the address: trailing punctuation, and a next
 * sentence run into it with no space — "hr@acme.ae.For queries…" is hr@acme.ae, and
 * the longer form was being filled into To.
 */
/* Domain endings: every country code, and the generic ones companies here use. */
const TLD = new Set(words(`ac ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bm bn bo br bs bt bw by bz ca cc cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz de dj dk dm do dz ec ee eg er es et eu fi fj fk fm fo fr ga gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu id ie il im in io iq ir is it je jm jo jp ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc md me mg mh mk ml mm mn mo mp mq mr ms mt mu mv mw mx my mz na nc ne nf ng ni nl no np nr nu nz om pa pe pf pg ph pk pl pm pn pr ps pt pw py qa re ro rs ru rw sa sb sc sd se sg sh si sk sl sm sn so sr ss st sv sx sy sz tc td tf tg th tj tk tl tm tn to tr tt tv tw tz ua ug uk us uy uz va vc ve vg vi vn vu wf ws ye yt za zm zw com net org edu gov mil int info biz name pro aero coop museum mobi asia tel travel jobs cat app dev io ai group global online site store tech agency digital solutions services consulting media network systems cloud shop club design xyz top ltd llc inc gmbh dubai abudhabi arab academy capital energy finance holdings international law legal management partners properties realestate studio`));

export function cleanAddress(raw) {
  let a = String(raw || "").replace(/[.,;:)\]]+$/, "");
  /* A sentence run into the address: its last label is no domain ending and the one before
     it is ("Careers@Acme.com.Please", "jobs@acme.group.For"), or it is a Title-case word
     after an address written in lower case ("hr@acme.ae.To"). "Careers@Gulfstar.Co.Uk"
     ends in a real ending and is kept whole — cutting it gave another company's domain. */
  const m = /^([^@]+@[^@]+\.([A-Za-z]{2,}))\.([A-Za-z]+)$/.exec(a);
  if (m) {
    const prev = m[2].toLowerCase(), last = m[3].toLowerCase();
    const ending = (x) => TLD.has(x);
    if ((!ending(last) && ending(prev)) || (/^[A-Z][a-z]+$/.test(m[3]) && m[1] === m[1].toLowerCase() && ending(prev))) a = m[1];
  }
  return a.toLowerCase();
}
