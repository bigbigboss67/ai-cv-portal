/**
 * Portal sign-in (Clerk) + profile and consent capture.
 *
 * Until a visitor is signed in AND has completed their profile (including accepting the
 * Terms and Privacy Policy), a full-screen gate covers the portal. Profile details and the
 * consent record live on the Clerk user as unsafeMetadata (user-editable, max 8 KB), so no
 * database is needed. The CV itself stays in the browser.
 *
 * Marketing consent is a separate, optional, unticked checkbox and can be withdrawn any
 * time under "My details" - required for valid consent under GDPR and UAE PDPL.
 *
 * Loaded as a classic deferred script after Clerk's two CDN script tags in index.html.
 */
(function () {
  // Bump when terms.html / privacy.html or the consent wording change, so the record shows
  // which version each user accepted.
  const CFG = window.LEGAL || {};
  const LEGAL_VERSION = CFG.version || "2026-11-14";
  // Must be the operator's real legal name before launch: consent to an unnamed sender is not valid.
  const OPERATOR = String(CFG.operatorName || "").trim();
  // No named operator and contact yet = no marketing consent is asked for (see legal-config.js).
  const MARKETING_ON = !!OPERATOR && !!String(CFG.privacyEmail || "").trim();
  // One box per channel: German case law wants the sender and the channel named.
  const MARKETING_TEXT =
    `I agree that ${OPERATOR} may email me job alerts, career content, and news and offers about the Executive Career Portal. I can withdraw at any time under “My details” or via the unsubscribe link.`;
  const MARKETING_PHONE_TEXT =
    "I also agree to receive these by SMS or WhatsApp at the phone number I provide.";

  // Only what the account needs is required (data minimisation). Everything else is
  // voluntary and says what it is for. Nationality is deliberately not collected.
  // Dropdown choices. Countries come from the browser's own region names (ISO 3166 codes).
  const ISO = "AE SA QA KW BH OM EG JO LB MA TN DZ IQ SY YE LY SD PS TR DE AT CH FR GB IE NL BE LU ES PT IT GR SE NO DK FI IS PL CZ SK HU RO BG HR SI RS BA ME MK AL EE LV LT UA MD BY RU GE AM AZ KZ UZ CY MT US CA MX BR AR CL CO PE VE UY EC BO PY CR PA DO CU JM IN PK BD LK NP AF IR CN JP KR TW HK SG MY ID TH VN PH KH MM AU NZ ZA NG KE GH ET TZ UG RW SN CI CM AO MZ ZW ZM MU".split(" ");
  const regionName = (() => { try { const d = new Intl.DisplayNames(["en"], { type: "region" }); return (c) => d.of(c) || c; } catch { return (c) => c; } })();
  const COUNTRIES = ISO.map(regionName).sort((x, y) => x.localeCompare(y));
  const DIAL = ["+971 UAE", "+966 Saudi Arabia", "+974 Qatar", "+965 Kuwait", "+973 Bahrain", "+968 Oman", "+20 Egypt", "+962 Jordan", "+961 Lebanon", "+212 Morocco", "+216 Tunisia", "+213 Algeria", "+964 Iraq", "+90 Turkey", "+49 Germany", "+43 Austria", "+41 Switzerland", "+33 France", "+44 UK", "+353 Ireland", "+31 Netherlands", "+32 Belgium", "+34 Spain", "+351 Portugal", "+39 Italy", "+30 Greece", "+46 Sweden", "+47 Norway", "+45 Denmark", "+358 Finland", "+48 Poland", "+420 Czechia", "+40 Romania", "+995 Georgia", "+7 Russia / Kazakhstan", "+1 USA / Canada", "+52 Mexico", "+55 Brazil", "+91 India", "+92 Pakistan", "+880 Bangladesh", "+94 Sri Lanka", "+86 China", "+81 Japan", "+82 South Korea", "+65 Singapore", "+60 Malaysia", "+62 Indonesia", "+63 Philippines", "+61 Australia", "+64 New Zealand", "+27 South Africa", "+234 Nigeria", "+254 Kenya"];
  const ROLES = ["Chief Executive Officer (CEO)", "Chief Operating Officer (COO)", "Chief Financial Officer (CFO)", "Chief Commercial Officer (CCO)", "Managing Director", "General Manager", "Country Manager", "Operations Director", "Commercial Director", "Sales Director", "Finance Director", "HR Director", "Project Director", "Supply Chain Director", "Senior Manager", "Manager", "Other"];
  const YEARS = ["0–2", "3–5", "6–10", "11–15", "16–20", "More than 20"];
  const SALARY = ["Below AED 20,000 / month", "AED 20,000 – 35,000 / month", "AED 35,000 – 50,000 / month", "AED 50,000 – 75,000 / month", "AED 75,000 – 100,000 / month", "Above AED 100,000 / month", "Prefer not to say"];

  // Only what the account needs is required (data minimisation). Everything else is
  // voluntary and says what it is for. Nationality is deliberately not collected.
  // `options` renders a dropdown; `dial` adds a country-code dropdown in front.
  const FIELDS = [
    { id: "firstName", label: "First name", required: true, auto: "given-name" },
    { id: "lastName", label: "Last name", required: true, auto: "family-name" },
    { id: "country", label: "Country of residence", required: true, options: COUNTRIES },
    { id: "city", label: "City (optional — for local job alerts)", required: false, auto: "address-level2" },
    { id: "phone", label: "Phone (optional — used only if you tick SMS/WhatsApp below)", required: false, type: "tel", dial: true, wide: true },
    { id: "currentTitle", label: "Current job level (optional — to tailor suggestions)", required: false, options: ROLES },
    { id: "targetRoles", label: "Target role (optional — to tailor job alerts)", required: false, options: ROLES },
    { id: "yearsExperience", label: "Years of experience (optional)", required: false, options: YEARS },
    { id: "salaryExpectation", label: "Salary expectation (optional)", required: false, options: SALARY },
    { id: "linkedin", label: "LinkedIn profile URL (optional)", required: false, type: "url" },
  ];



  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const style = document.createElement("style");
  style.textContent = `
    #authGate{position:fixed;inset:0;z-index:100000;background:var(--bg-canvas,#F8FAFC);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:32px 16px;}
    #authGate .ag-card{width:100%;max-width:560px;background:var(--bg-surface,#fff);border:1px solid var(--border-subtle,#E2E8F0);border-radius:16px;padding:24px;color:var(--text-primary,#0F172A);font-family:inherit;}
    #authGate h2{margin:0 0 6px;font-size:20px;} #authGate p{margin:0 0 14px;font-size:13.5px;line-height:1.55;color:var(--text-secondary,#334155);}
    #authGate .ag-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 12px;} @media(max-width:560px){#authGate .ag-grid{grid-template-columns:1fr;}}
    #authGate label.ag-f{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:600;color:var(--text-secondary,#334155);}
    #authGate .ag-f.wide{grid-column:1/-1;} #authGate .ag-dial{display:flex;gap:8px;} #authGate .ag-dial select{flex:0 0 46%;min-width:0;} #authGate .ag-dial input{flex:1;min-width:0;}
    #authGate select,#authGate input[type=text],#authGate input[type=tel],#authGate input[type=url],#authGate input[type=number]{padding:9px 10px;border-radius:8px;border:1px solid var(--border-strong,#CBD5E1);background:var(--bg-surface,#fff);color:var(--text-primary,#0F172A);font-size:14px;}
    #authGate .ag-check{display:flex;gap:10px;align-items:flex-start;font-size:13px;line-height:1.5;margin-top:12px;color:var(--text-primary,#0F172A);}
    #authGate .ag-check input{margin-top:3px;flex-shrink:0;width:16px;height:16px;}
    #authGate .ag-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:18px;flex-wrap:wrap;}
    #authGate button.ag-primary{background:#059669;color:#fff;border:0;border-radius:999px;padding:10px 20px;font-weight:700;font-size:14px;cursor:pointer;}
    #authGate button.ag-ghost{background:transparent;border:1px solid var(--border-strong,#CBD5E1);color:var(--text-secondary,#334155);border-radius:999px;padding:10px 16px;font-size:13px;cursor:pointer;}
    #authGate .ag-err{color:#dc2626;font-size:12.5px;margin-top:10px;min-height:16px;}
    #authGate a{color:#059669;font-weight:600;}
    #authSlot{display:flex;align-items:center;gap:8px;}
  `;
  document.head.appendChild(style);

  const gate = document.createElement("div");
  gate.id = "authGate";
  gate.innerHTML = `<div class="ag-card"><h2>Executive Career Portal</h2><p>Loading sign-in…</p></div>`;
  const attach = () => document.body.appendChild(gate);
  if (document.body) attach(); else document.addEventListener("DOMContentLoaded", attach);

  const card = () => gate.querySelector(".ag-card");
  const showGate = (on) => { gate.style.display = on ? "flex" : "none"; };

  function profileOf(user) {
    const m = (user && user.unsafeMetadata) || {};
    return { profile: m.profile || {}, consents: m.consents || {} };
  }
  const isComplete = (user) => {
    const { profile, consents } = profileOf(user);
    // A new LEGAL_VERSION asks for express re-acceptance; silence is not agreement.
    return !!(consents.terms && consents.terms.at && consents.terms.version === LEGAL_VERSION) && FIELDS.every((f) => !f.required || String(profile[f.id] || "").trim());
  };

  function renderSignIn(clerk) {
    card().innerHTML = `<h2>Sign in to the Executive Career Portal</h2>
      <p>Create a free account or sign in to continue. See our <a href="terms.html" target="_blank" rel="noopener">Terms</a> and <a href="privacy.html" target="_blank" rel="noopener">Privacy Policy</a>.</p>
      <div id="agSignIn"></div>`;
    clerk.mountSignIn(document.getElementById("agSignIn"), { signUpForceRedirectUrl: location.href, forceRedirectUrl: location.href });
  }

  const optionsHtml = (list, cur, placeholder) =>
    `<option value="">${placeholder}</option>` +
    // A value saved earlier that is no longer in the list is kept, not silently dropped.
    (cur && !list.includes(cur) ? [cur, ...list] : list).map((o) => `<option value="${esc(o)}" ${o === cur ? "selected" : ""}>${esc(o)}</option>`).join("");

  function fieldHtml(f, value) {
    const v = String(value == null ? "" : value);
    const req = f.required ? "required" : "";
    let control;
    if (f.options) {
      control = `<select name="${f.id}" ${req}>${optionsHtml(f.options, v, "Select…")}</select>`;
    } else if (f.dial) {
      // Stored as "+971 501234567": split it back into code and number.
      const code = (v.match(/^\+\d+/) || [""])[0];
      const cur = DIAL.find((d) => d.split(" ")[0] === code) || "";
      control = `<span class="ag-dial"><select name="${f.id}Code" aria-label="Country code">${optionsHtml(DIAL, cur, "Code…")}</select>
        <input type="tel" name="${f.id}Number" value="${esc(v.replace(/^\+\d+\s*/, ""))}" inputmode="tel" autocomplete="tel-national" maxlength="20" placeholder="Number" /></span>`;
    } else {
      control = `<input type="${f.type || "text"}" name="${f.id}" value="${esc(v)}" ${req} ${f.auto ? `autocomplete="${f.auto}"` : ""} maxlength="200" />`;
    }
    return `<label class="ag-f${f.wide ? " wide" : ""}">${esc(f.label)}${control}</label>`;
  }

  function renderProfile(clerk, { editing = false } = {}) {
    const user = clerk.user;
    const { profile, consents } = profileOf(user);
    const pre = { firstName: user.firstName || "", lastName: user.lastName || "", ...profile };
    const alreadyAccepted = !!(consents.terms && consents.terms.at && consents.terms.version === LEGAL_VERSION);
    card().innerHTML = `<h2>${editing ? "My details" : "Complete your profile"}</h2>
      <p>${editing ? "Update your details or change your marketing choice." : "We need a few details to set up your account."} Signed in as <strong>${esc(user.primaryEmailAddress ? user.primaryEmailAddress.emailAddress : "")}</strong>.</p>
      <form id="agForm" novalidate>
        <div class="ag-grid">
          ${FIELDS.map((f) => fieldHtml(f, pre[f.id])).join("")}
        </div>
        <label class="ag-check"><input type="checkbox" name="terms" ${alreadyAccepted ? "checked disabled" : ""} />
          <span>I have read and accept the <a href="terms.html" target="_blank" rel="noopener">Terms of Use</a> and have read the <a href="privacy.html" target="_blank" rel="noopener">Privacy Policy</a>. <em>(required)</em></span></label>
        ${MARKETING_ON ? `        <label class="ag-check"><input type="checkbox" name="marketing" ${consents.marketing && consents.marketing.granted ? "checked" : ""} />
          <span>${esc(MARKETING_TEXT)} <em>(optional)</em></span></label>
        <label class="ag-check"><input type="checkbox" name="marketingPhone" ${consents.marketingPhone && consents.marketingPhone.granted ? "checked" : ""} />
          <span>${esc(MARKETING_PHONE_TEXT)} <em>(optional)</em></span></label>` : ""}
        <div class="ag-err" id="agErr" role="alert"></div>
        <div class="ag-actions">
          ${editing ? '<button type="button" class="ag-ghost" id="agCancel">Cancel</button>' : '<button type="button" class="ag-ghost" id="agSignOut">Sign out</button>'}
          <button type="submit" class="ag-primary">${editing ? "Save" : "Save and continue"}</button>
        </div>
      </form>`;
    const form = document.getElementById("agForm");
    const err = document.getElementById("agErr");
    const cancel = document.getElementById("agCancel");
    if (cancel) cancel.onclick = () => showGate(false);
    const out = document.getElementById("agSignOut");
    if (out) out.onclick = () => clerk.signOut();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const data = new FormData(form);
      const next = {};
      for (const f of FIELDS) {
        if (f.dial) {
          const num = String(data.get(f.id + "Number") || "").replace(/[^\d]/g, "").replace(/^0+/, "");
          const code = String(data.get(f.id + "Code") || "").split(" ")[0];
          if (num && !code) { err.textContent = "Choose the country code for your phone number."; return; }
          next[f.id] = num ? `${code} ${num}` : "";
        } else {
          next[f.id] = String(data.get(f.id) || "").trim().slice(0, 200);
        }
        if (f.required && !next[f.id]) { err.textContent = `Please fill in: ${f.label}.`; return; }
      }
      if (next.linkedin && !/^https?:\/\/([\w-]+\.)?linkedin\.com\//i.test(next.linkedin)) { err.textContent = "The LinkedIn URL should start with https://www.linkedin.com/"; return; }
      if (data.get("marketingPhone") && !next.phone) { err.textContent = "Add a phone number, or untick SMS/WhatsApp."; return; }
      if (!alreadyAccepted && !data.get("terms")) { err.textContent = "Please accept the Terms of Use to continue."; return; }
      const now = new Date().toISOString();
      // Every grant and withdrawal is appended to a history, never overwritten, so the
      // record still shows what was agreed to and when after a later withdrawal.
      const history = [...(consents.history || [])];
      const choice = (key, box, text) => {
        const had = consents[key] || {};
        if (!MARKETING_ON) return had;
        const wants = !!data.get(box);
        if (wants === !!had.granted && had.at) return had;   // unchanged: keep the original record
        const rec = { granted: wants, at: now, version: LEGAL_VERSION, text };
        if (wants || had.at) history.push({ type: key, ...rec });
        return rec;
      };
      const marketing = choice("marketing", "marketing", MARKETING_TEXT);
      const marketingPhone = choice("marketingPhone", "marketingPhone", MARKETING_PHONE_TEXT);
      const terms = alreadyAccepted ? consents.terms : { at: now, version: LEGAL_VERSION };
      if (!alreadyAccepted) history.push({ type: "terms", granted: true, at: now, version: LEGAL_VERSION });
      err.textContent = "Saving…";
      try {
        await user.update({
          unsafeMetadata: {
            ...(user.unsafeMetadata || {}),
            profile: next,
            consents: { terms, marketing, marketingPhone, history: history.slice(-30) },
          },
        });
        showGate(false);
        renderHeader(clerk);
      } catch (ex) {
        err.textContent = "Could not save: " + ((ex.errors && ex.errors[0] && ex.errors[0].message) || ex.message || "error");
      }
    };
  }

  function renderHeader(clerk) {
    let slot = document.getElementById("authSlot");
    if (!slot) {
      const anchor = document.getElementById("themeBtn");
      if (!anchor) return;
      slot = document.createElement("div");
      slot.id = "authSlot";
      anchor.parentNode.insertBefore(slot, anchor);
    }
    slot.innerHTML = `<button type="button" class="btn-pill-secondary" id="authDetailsBtn" title="View or change your details and marketing choice">My details</button><div id="authUserBtn"></div>`;
    document.getElementById("authDetailsBtn").onclick = () => { renderProfile(clerk, { editing: true }); showGate(true); };
    clerk.mountUserButton(document.getElementById("authUserBtn"));
  }

  function route(clerk) {
    if (!clerk.user) { renderSignIn(clerk); showGate(true); return; }
    if (!isComplete(clerk.user)) { renderProfile(clerk); showGate(true); return; }
    showGate(false);
    renderHeader(clerk);
  }

  async function start() {
    try {
      if (!window.Clerk) throw new Error("The sign-in service did not load.");
      await window.Clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor } });
      let lastId = window.Clerk.user ? window.Clerk.user.id : null;
      route(window.Clerk);
      window.Clerk.addListener(({ user }) => {
        const id = user ? user.id : null;
        if (id !== lastId) { lastId = id; route(window.Clerk); }
      });
    } catch (ex) {
      console.error("Sign-in:", ex);
      card().innerHTML = `<h2>Sign-in is unavailable</h2><p>${esc(ex.message || ex)} Check your connection or ad blocker and try again.</p><div class="ag-actions"><button class="ag-primary" onclick="location.reload()">Retry</button></div>`;
    }
  }
  if (document.readyState === "complete") start(); else window.addEventListener("load", start);
})();
