/**
 * Graph send, bolted onto the existing Review panel.
 *
 * Reads the rendered sheets out of the DOM rather than reaching into the portal's
 * inline script, so the two stay independent and neither can break the other.
 */

import { initMailer, signIn, signOut, pdfBase64, sendMail, mailerStatus } from "./mailer.js";

const $$ = (q, r = document) => r.querySelector(q);

function panel() {
  const mailBtn = $$("#mailBtn");
  if (!mailBtn || $$("#msPanel")) return;
  const box = document.createElement("div");
  box.id = "msPanel";
  box.style.cssText =
    "margin-top:10px;padding:10px 12px;border:1px solid var(--shell-line,#2d3a5c);" +
    "border-radius:6px;display:grid;gap:8px";
  mailBtn.insertAdjacentElement("afterend", box);
  paint();
}

function paint() {
  const box = $$("#msPanel");
  if (!box) return;
  const st = mailerStatus();

  if (!st.configured) {
    // Direct send needs an Entra app registration, which needs an Azure directory,
    // which needs a card. Not worth it for a job search — so say what to do instead
    // rather than nagging about a setup step that may never happen.
    box.innerHTML =
      `<div class="hint"><b>How sending works.</b><br>
       <b>1.</b> Press <b>Prepare application</b>. One file downloads: an Outlook draft (<b>.eml</b>)
       that already carries the full cover letter, design intact, in the message body, and your CV
       attached as a text PDF that applicant-tracking systems can read (an Arabic CV comes out of the
       print dialog instead — Save CV PDF only — and is attached by hand).<br>
       <b>2.</b> Double-click the <b>.eml</b>. Outlook opens it as an editable draft. Read it and press
       Send. The designed copy of the CV is a separate button and is never attached for you.<br><br>
       <b>To make step 2 automatic:</b> in the browser's download bar, open the menu beside the .eml
       and tick <b>Always open files of this type</b>. After that the draft opens by itself. A web
       page is not allowed to launch a file on your machine, so that switch is the browser's to
       throw, not the portal's.<br><br>
       The recipient is filled in when the posting or the company's own pages publish one. When they
       do not the draft still opens — type the address into Outlook. Nothing is ever guessed.</div>`;
    return;
  }

  box.innerHTML = st.signedIn
    ? `<div class="hint">Signed in as <b>${st.username}</b> — mail sends from this mailbox and lands in its Sent Items.</div>
       <div style="display:flex;gap:8px;flex-wrap:wrap">
         <button class="btn pri sm" id="msSend">Send now with PDF attached</button>
         <button class="btn sm" id="msDraft">Create a draft instead</button>
         <button class="btn sm" id="msOut">Sign out</button>
       </div>
       <div class="hint" id="msMsg"></div>`
    : `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
         <button class="btn sm" id="msIn">Sign in with Microsoft</button>
         <span class="hint">Personal accounts only. Nothing is sent until you press send.</span>
       </div>
       <div class="hint" id="msMsg"></div>`;
}

const say = (t) => { const m = $$("#msMsg"); if (m) m.innerHTML = t; };

/** Clone the rendered letter and CV into one offscreen A4 column for the PDF. */
function documentsForPdf() {
  const sheets = [...document.querySelectorAll("#pane .sheet")];
  if (!sheets.length) return null;
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:fixed;left:-10000px;top:0;width:210mm;background:#fff";
  // Letter first, then CV — the order an employer reads them in.
  const ordered = sheets.sort(
    (a, b) => (b.classList.contains("letter") ? 1 : 0) - (a.classList.contains("letter") ? 1 : 0),
  );
  for (const sh of ordered) {
    const c = sh.cloneNode(true);
    c.style.pageBreakAfter = "always";
    wrap.appendChild(c);
  }
  document.body.appendChild(wrap);
  return wrap;
}

function context() {
  const to = ($$("#toAddr")?.value || "").trim();
  /* The letter's own heading ("Application — General Manager"), as the .eml draft uses it.
     The line under the name on the CV is the candidate's headline, not the role. */
  const head = $$("#pane .sheet.letter .role")?.textContent?.trim() || "";
  const name = $$("#pane .sheet h1")?.textContent?.trim() || "Rassem Kadiri";
  const letter = $$("#pane .sheet.letter");
  const html = letter ? letter.innerHTML : "<p>Please find my application attached.</p>";
  return { to, head, name, html };
}

async function go(draftOnly) {
  const { to, head, name, html } = context();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    say(`<b style="color:#e0a080">That recipient address is not valid.</b> Note the field is prefilled
         with a <b>guessed</b> address built from the company name — replace it with the real one
         from the posting before sending anything.`);
    return;
  }

  const btns = [...document.querySelectorAll("#msPanel button")];
  btns.forEach((b) => (b.disabled = true));
  say("Building the PDF…");

  let wrap = null;
  try {
    wrap = documentsForPdf();
    if (!wrap) throw new Error("No rendered documents on screen — open the Draft view first.");
    const file = `${name.replace(/[^\w]+/g, "_")}_application.pdf`;
    const { base64, bytes } = await pdfBase64(wrap, file);
    say(`PDF built (${Math.round(bytes / 1024)} KB). ${draftOnly ? "Creating draft" : "Sending"}…`);

    const res = await sendMail({
      to,
      subject: head ? `${head} — ${name}` : `Application — ${name}`,
      html,
      attachments: [{ name: file, base64 }],
      draftOnly,
    });

    say(
      draftOnly
        ? `Draft created in your mailbox${res.webLink ? ` — <a href="${res.webLink}" target="_blank" rel="noopener">open it</a>` : ""}. Nothing has been sent.`
        : `<b>Sent to ${to}</b> with the PDF attached. It is in your Sent Items.`,
    );
  } catch (err) {
    say(`<b style="color:#e0a080">${String(err.message || err)}</b>`);
  } finally {
    if (wrap) wrap.remove();
    btns.forEach((b) => (b.disabled = false));
  }
}

document.addEventListener("click", async (e) => {
  const id = e.target.id;
  if (id === "msIn")    { try { await signIn(); } catch (err) { say(String(err.message || err)); } paint(); }
  if (id === "msOut")   { await signOut(); paint(); }
  if (id === "msSend" || id === "msDraft") {
    /* Recruiter lens C: below 85 the page's warning comes first (career-portal.html
       sendGate) and its button proceeds. A missing gate, or any error in it, sends. */
    let ok = true;
    try { if (typeof window.cvSendGate === "function") ok = window.cvSendGate(id, $$("#msMsg")) !== false; } catch { ok = true; }
    if (!ok) return;
  }
  if (id === "msSend")  await go(false);
  if (id === "msDraft") await go(true);
});

// The portal re-renders its whole pane on every interaction, so re-attach the
// panel rather than binding once and hoping the node survives.
new MutationObserver(() => panel()).observe(document.body, { childList: true, subtree: true });

try {
  await initMailer();
} catch (err) {
  console.warn("mailer init:", err);
}
panel();
