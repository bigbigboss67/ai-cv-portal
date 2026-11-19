/**
 * Modular Cover Letter & RTL Direction Helpers
 * Extracted from index.html for maintainability and unit verification.
 */

export function applyCoverLetterDirection(textareaEl, lang = "en") {
  if (!textareaEl) return;
  const isRtl = String(lang || "en").toLowerCase() === "ar";
  textareaEl.setAttribute("dir", isRtl ? "rtl" : "ltr");
  textareaEl.style.direction = isRtl ? "rtl" : "ltr";
  textareaEl.style.textAlign = isRtl ? "right" : "left";
}

export function buildLocalizedNinetyDayBlock(lang = "en") {
  const code = String(lang || "en").toLowerCase();
  if (code === "de") {
    return `\n\nUm vom ersten Tag an messbare Ergebnisse zu sichern, umfasst mein 90-Tage-Executive-Impact-Plan:
• Tage 1–30 (Diagnose & Ausrichtung): Vollständige Analyse von GuV, Lieferkette und Führungsteam sowie Etablierung einer klaren Board-KPI-Kadenz.
• Tage 31–60 (Operative Beschleunigung): Realisierung schneller Margenpotenziale, Neuverhandlung zentraler Lieferanten-SLAs und Beseitigung operativer Engpässe.
• Tage 61–90 (Skalierbare Wertschöpfung): Einführung automatisierter Steuerungs-Dashboards, Ausbau regionaler Marktanteile und Finalisierung der mehrjährigen EBITDA-Roadmap.`;
  }
  if (code === "ar") {
    return `\n\nولضمان تحقيق نتائج فورية وقابلة للقياس منذ اليوم الأول، ترتكز خطتي التنفيذية لأول 90 يوماً على:
• الأيام 1–30 (التشخيص والمواءمة): إجراء مراجعة شاملة للأرباح والخسائر وسلسلة الإمداد والكفاءات القيادية، مع ترسيخ إيقاع واضح لمؤشرات الأداء أمام مجلس الإدارة.
• الأيام 31–60 (التسريع التشغيلي): تحقيق مكاسب سريعة في هوامش الربح، وإعادة التفاوض على اتفاقيات مستوى الخدمة مع الموردين الرئيسيين، وإزالة الاختناقات التشغيلية.
• الأيام 61–90 (تعظيم القيمة القابلة للتوسع): إطلاق لوحات متابعة تشغيلية مؤتمتة، وتوسيع الحصة السوقية الإقليمية، واعتماد خارطة طريق الأرباح قبل الفوائد والضرائب والإهلاك (EBITDA) متعددة السنوات.`;
  }
  if (code === "fr") {
    return `\n\nPour garantir un impact mesurable dès la prise de poste, ma feuille de route exécutive à 90 jours s'articule autour de trois phases :
• Jours 1–30 (Diagnostic & Alignement) : Audit complet du P&L, de la chaîne d'approvisionnement et des équipes clés, avec mise en place d'une cadence claire de KPIs pour le Conseil.
• Jours 31–60 (Accélération Opérationnelle) : Capture de gains rapides de marge, renégociation des SLAs fournisseurs critiques et élimination des goulots d'étranglement.
• Jours 61–90 (Création de Valeur Durable) : Déploiement de tableaux de bord automatisés, expansion des parts de marché régionales et finalisation de la feuille de route EBITDA pluriannuelle.`;
  }
  if (code === "es") {
    return `\n\nPara garantizar resultados medibles desde el primer día, mi plan ejecutivo de impacto a 90 días contempla:
• Días 1–30 (Diagnóstico y Alineación): Auditoría integral de P&L, cadena de suministro y talento clave, estableciendo una cadencia clara de KPIs para el Consejo.
• Días 31–60 (Aceleración Operativa): Captura de mejoras rápidas de margen, renegociación de SLAs con proveedores estratégicos y eliminación de cuellos de botella.
• Días 61–90 (Creación de Valor Escalable): Implementación de cuadros de mando automatizados, expansión de cuota de mercado regional y cierre de la hoja de ruta EBITDA plurianual.`;
  }
  return `\n\nTo ensure immediate accountability, my proposed 90-Day Executive Impact Hypothesis entails:
• Days 1–30 (Diagnosis & Alignment): Complete operational audit across P&L, supply chain, and talent baselines while establishing Board KPI cadence.
• Days 31–60 (Operational Acceleration): Capture quick operational margin wins, renegotiate core vendor SLAs, and eliminate operational bottlenecks.
• Days 61–90 (Scalable Value Creation): Institute automated operational dashboards, scale regional market share, and finalize the multi-year EBITDA roadmap.`;
}
