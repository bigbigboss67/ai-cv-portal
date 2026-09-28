/**
 * The profile this deployment starts with.
 *
 * A seed, not a candidate: the portal treats it as an example until someone
 * uploads a CV, and HAS_REAL_PROFILE stays false for it, so letters edited
 * against it keep the storage keys they have always had.
 *
 * Deployments that are not this person's delete this file. The portal then
 * starts empty and asks for a CV, which is what a fresh install should do.
 */

window.SEED_PROFILE={
 name:"Rassem Kadiri",
 /* Headline, summary, email, titles and dates as the owner's master CVs (cv/Rassem_Kadiri_CV_2026_EN.docx, _Lebenslauf_2026_DE.docx) and the verified fact base give them, aligned 24 Sep 2026 on the owner's decision. */
 title:{en:"Senior Business Advisor · Operations, Market Entry & General Management · Germany / GCC",de:"Senior Business Advisor · Operations, Markteintritt & Geschäftsführung · Deutschland / GCC"},
 city:"Dubai, UAE",phone:"+971 52 997 9695",email:"rassemkadiri@live.de",
 /* Work authorisation, not raw nationality: nationality is a bias vector and
    Arabic (native) below already carries the regional signal. */
 nationality:"German passport (EU)",langs:"German (native) · Arabic (native) · English (fluent)",
 summary:{en:"Business executive with more than 25 years of leadership and advisory experience across Germany and the United Arab Emirates. Track record in general management, market entry and operational turnaround — from regional management of a German rental network to leading a Dubai media group of 250 staff and founding 2 UAE companies. Since 2012 an independent advisor to SMEs and large enterprises on expansion, revenue growth and operational excellence. Works natively in German and Arabic and fluently in English.",
          de:"Business Executive mit über 25 Jahren Führungs- und Beratungserfahrung in Deutschland und den VAE: vom Regionalmanagement eines deutschen Mietwagennetzes über die Leitung einer Dubaier Mediengruppe mit 250 Mitarbeitern bis zur Gründung zweier eigener Unternehmen. Seit 2012 unabhängiger Berater für KMU und Großunternehmen zu Expansion, Umsatzsteigerung und operativer Exzellenz. Deutsch und Arabisch auf Muttersprachniveau, Englisch verhandlungssicher."},
 competencies:[["Strategic planning","strategy"],["Business development","business development"],["Negotiation","negotiation"],["Leadership & team management","leadership"],["Market intelligence & analysis","market analysis"],["Market entry & expansion","market entry"],["Contract development","contracts"],["Client & stakeholder management","stakeholder"],["P&L / cost control","p&l"],["Training & mentoring","training"],["Presentation & communication","communication"],["Restructuring","restructuring"],["Investor relations","investor"],["Digital transformation","digital transformation"],["IT & AI proficiency","ai"]],
 experience:[
  {t:"Business Advisor & Consultant",c:"Independent — UAE & international",d:"Feb 2012 – Present",tags:["strategy","business development","market entry","market analysis","investor","digital transformation","ai","stakeholder","training","negotiation","consulting","real estate","media"],
   bullets:[
    {x:"Built an independent advisory practice serving SMEs and large enterprises on expansion, revenue optimisation and operational turnaround",tags:["strategy","business development","consulting","p&l"]},
    {x:"Led advisory mandates for major real-estate and broadcast clients: feasibility studies, market-entry strategies and investor presentations.",tags:["market entry","real estate","media","investor","market analysis"]},
    {x:"Delivered market intelligence and regulatory guidance through extensive local and international networks.",tags:["market analysis","stakeholder","compliance"]},
    {x:"Represented clients in high-level negotiations, structuring deals and partnerships supporting long-term growth.",tags:["negotiation","contracts","stakeholder"]},
    {x:"Supported clients in securing equity investment, scaling operations and connecting with investors and acquirers.",tags:["investor","business development"]},
    {x:"Advised on digital transformation, integrating IT and AI solutions into business processes.",tags:["digital transformation","ai","it"]},
    {x:"Trained and mentored client teams on business excellence, customer engagement and high-impact presentation.",tags:["training","communication","leadership"]}]},
  {t:"Founder & Managing Director",c:"GTI General Trading — Dubai",d:"Jan 2008 – 2012",tags:["trading","business development","negotiation","contracts","leadership","logistics","construction"],
   bullets:[
    {x:"Founded and ran a general trading company in building materials and heavy equipment.",tags:["trading","construction","business development"]},
    {x:"Negotiated exclusive supplier agreements and managed the full team and operation.",tags:["negotiation","contracts","leadership","logistics"]}]},
  {t:"Co-owner",c:"Al Araba Al Thahabiya Car Rental — Sharjah",d:"Aug 2007 – 2012 (alongside GTI)",tags:["automotive","mobility","b2b","business development","vip","leadership"],
   bullets:[
    {x:"Founded a premium VIP transport service and won major B2B corporate rental agreements for it",tags:["automotive","mobility","b2b","vip","business development"]}]},
  {t:"Managing Director",c:"Al Aqariya Media Group (Real Estate Channel FZ-LLC), part of Capital Plus Holding — Dubai",d:"Mar 2005 – Jan 2008",tags:["media","leadership","restructuring","p&l","real estate","publishing","operations"],
   bullets:[
    {x:"Directed 4 media divisions — television, magazine, newspaper and web — and 250 staff for a group inside Capital Plus Holding",tags:["media","leadership","operations","publishing"]},
    {x:"Led the group's board of directors",tags:["leadership","stakeholder"]},
    {x:"Delivered a group-wide restructuring programme covering expansion and cost management",tags:["restructuring","p&l","operations"]}]},
  {t:"Northern Regional Manager",c:"Budget Car Rental Deutschland GmbH — Germany",d:"Aug 1999 – Mar 2005",tags:["germany","automotive","mobility","operations","p&l","leadership","franchise","retail"],
   bullets:[
    {x:"Promoted from Supervisor to Station Manager to Northern Regional Manager over 5 years; ran multi-station operations across northern Germany — cost control and team leadership.",tags:["germany","operations","p&l","leadership","mobility"]}]}],
 education:[{b:"Kaufmann im Groß- und Außenhandel (IHK Hannover)",s:"Wholesale & Foreign Trade Merchant — Abschlussprüfung 1998, Gesamtnote ‚gut‘ · Berufsbildende Schule Garbsen"}],
 refs:{en:"References available on request.",de:"Referenzen auf Anfrage."}
};
