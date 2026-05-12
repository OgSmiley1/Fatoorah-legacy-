// server/templates/sectorScripts.ts
// Sector-keyed outreach templates. Lifted from:
//  - 💬 Scripts by Service (sheet 7 of MF_Service_Leads_493_…xlsx)
//  - 📊 Sector Breakdown (sheet 6 — Payment Link Opportunity column)
//  - MyFatoorah_ChatGPT_SalesAgent.html (Arabic WhatsApp greeting block)
//
// One source of truth: callers look up by sector keyword, then interpolate
// {{businessName}} / {{emirate}}. Unknown sectors fall through to GENERIC.

export interface SectorTemplate {
  /** Short pain angle used in proposal section 4 ("Their Current Problem"). */
  painAngle: string;
  /** One-line opportunity statement used in proposal section 5 ("Solution"). */
  opportunity: string;
  /** WhatsApp cold-outreach script (English). */
  whatsappEn: string;
  /** WhatsApp cold-outreach script (Gulf Arabic). */
  whatsappAr: string;
  /** Email subject line. */
  emailSubject: string;
  /** Email body (plain-text). */
  emailBody: string;
}

// All entries share the same merchant placeholder set: {{businessName}}, {{emirate}}.
const GENERIC: SectorTemplate = {
  painAngle: 'No online payment infrastructure — every order takes a phone call, every deposit a WhatsApp dance.',
  opportunity: 'Payment links + invoicing remove the back-and-forth, settle next-day, and surface BNPL automatically.',
  whatsappEn:
    `Hi {{businessName}} 👋\n\n` +
    `I'm Maaz from MyFatoorah — UAE's licensed payment gateway. I noticed you don't have a checkout option online yet.\n\n` +
    `Most of the merchants we onboard in {{emirate}} are now collecting deposits and recurring payments via simple WhatsApp links — funds in their account the next day.\n\n` +
    `If you've got 2 minutes I can show you exactly how it would look for your business.`,
  whatsappAr:
    `السلام عليكم {{businessName}}،\n\n` +
    `أنا معاز من MyFatoorah، بوابة دفع مرخصة من البنك المركزي الإماراتي.\n\n` +
    `كتير من الحسابات في {{emirate}} بدأت تقبل الدفع أونلاين وعن طريق الواتساب وصارت تحصّل مبالغها في اليوم التالي — بدون أي تأخير.\n\n` +
    `لو فاضل عندك دقيقتين، بقدر أشرح كيف يشتغل وكيف ينفعك بالضبط.`,
  emailSubject: 'Payment Infrastructure for {{businessName}} — MyFatoorah',
  emailBody:
    `Dear {{businessName}} team,\n\n` +
    `I'm Maaz Sharif, Commercial Manager at MyFatoorah (Licensed by the Central Bank of UAE).\n\n` +
    `I've prepared a tailored proposal for {{businessName}} outlining how we can accelerate your payment operations:\n\n` +
    `• Personalized pricing structure with next-day settlement (T+1)\n` +
    `• Native Tabby / Tamara BNPL — average +23% basket size in the GCC\n` +
    `• Payment links via WhatsApp, email, QR — no website required\n` +
    `• 3 working days from agreement to go-live\n\n` +
    `Available for a 20-minute call this week, or we can move directly to the agreement and reserve your onboarding slot.\n\n` +
    `Best regards,\n` +
    `Maaz Sharif\n` +
    `Commercial Manager — UAE\n` +
    `MyFatoorah PSP LLC\n` +
    `+971 50 950 9587  |  msharif@myfatoorah.com`,
};

// Sector-specific overrides. Keys are matched case-insensitively as substrings,
// so "Photography Studio" matches "photography" entry. Order is by specificity:
// the lookup picks the FIRST match, so more-specific keys come earlier.
const SECTOR_OVERRIDES: Array<{ keys: string[]; template: Partial<SectorTemplate> }> = [
  {
    keys: ['driving school'],
    template: {
      painAngle: 'Course fees are AED 2,500–6,000 paid upfront — high friction at signup.',
      opportunity: 'Tabby/Tamara split the course fee into 4 interest-free payments; sign-up conversion jumps.',
      whatsappEn:
        `Hi {{businessName}} 👋\n\n` +
        `Driving-school course fees are a sticking point for most students — they want to enrol but the lump sum stops them.\n\n` +
        `With MyFatoorah we can split your fee into 4 interest-free Tabby/Tamara payments at checkout. Schools we work with see ~20% more enrolments in the first month.\n\n` +
        `Worth a 5-minute look?`,
    },
  },
  {
    keys: ['moving', 'mover'],
    template: {
      painAngle: 'Large deposits needed upfront — currently collected cash or by bank transfer, slow and friction-heavy.',
      opportunity: 'A single WhatsApp payment link collects the deposit instantly; you confirm the booking on the spot.',
    },
  },
  {
    keys: ['car wash', 'auto detail', 'auto service'],
    template: {
      painAngle: 'Repeat customers want a subscription but you can\'t auto-charge a card on a wallet.',
      opportunity: 'Recurring billing turns weekly washes into a monthly subscription — predictable revenue, less queueing at the till.',
      whatsappEn:
        `Hi {{businessName}}!\n\n` +
        `Saw your car-wash on Google Maps — great ratings. Quick question: do your regulars ever ask about a monthly package?\n\n` +
        `With MyFatoorah we set up auto-charge subscriptions in an hour. No more chasing payments — funds land next day.\n\n` +
        `Open to a 2-minute call?`,
    },
  },
  {
    keys: ['photography', 'studio'],
    template: {
      painAngle: 'Booking deposits get lost — no way to lock in a slot without a payment link.',
      opportunity: 'Send a deposit link the second the inquiry comes in; the slot is yours, not the next caller\'s.',
    },
  },
  {
    keys: ['home cleaning', 'cleaning service'],
    template: {
      painAngle: 'You quote on WhatsApp, the customer says "yes", then the payment dance starts — bank transfer screenshots, no-shows.',
      opportunity: 'Send a one-tap WhatsApp payment link the moment you quote. They pay, the visit is locked.',
      whatsappEn:
        `Hi {{businessName}} 👋\n\n` +
        `I found your cleaning service on Google Maps — fantastic reviews.\n\n` +
        `Most cleaning teams we work with were losing 1–2 jobs a week to no-shows. With MyFatoorah you send a payment link with the quote, customer taps once, the booking is confirmed and funds settle the next day.\n\n` +
        `Worth a quick look?`,
    },
  },
  {
    keys: ['ac repair', 'electrician', 'plumber', 'hvac', 'technician'],
    template: {
      painAngle: 'Technicians collect cash on-site or wait days for transfers — invoicing is a part-time job.',
      opportunity: 'Generate an invoice in 30 seconds, share via WhatsApp, customer pays before the technician leaves.',
      whatsappEn:
        `Hi {{businessName}},\n\n` +
        `I'm Maaz from MyFatoorah 👋\n\n` +
        `A lot of technicians and AC/plumbing teams we work with were spending hours each week on invoicing and chasing payments. With us they generate a WhatsApp payment link on-site, the customer taps, done — funds in their bank the next day.\n\n` +
        `If you have 2 minutes I'll show you what it looks like for your team.`,
    },
  },
  {
    keys: ['restaurant', 'cafe', 'coffee', 'bakery', 'cloud kitchen'],
    template: {
      painAngle: 'Delivery orders go through aggregators that take 25–35% — your margin lives on direct WhatsApp orders, but those have no checkout.',
      opportunity: 'Direct-order payment links bypass the aggregator margin entirely. Tabby on a 200-AED order lifts AOV 20%+.',
    },
  },
  {
    keys: ['salon', 'spa', 'beauty', 'barber'],
    template: {
      painAngle: 'Customers want to book the AED-1,200 package but the upfront cash is the dealbreaker.',
      opportunity: 'BNPL turns the package into 4 small payments — booking confirmed, you get paid up front by Tabby.',
    },
  },
  {
    keys: ['clinic', 'dental', 'medical center', 'pharmacy'],
    template: {
      painAngle: 'Treatment plans are AED 5K–25K — insurance is partial, the gap is where customers ghost.',
      opportunity: 'Installment plans + secure 3DS2 checkout lift treatment-plan acceptance significantly.',
    },
  },
  {
    keys: ['real estate', 'property', 'broker'],
    template: {
      painAngle: 'AED 5K reservation deposits are still collected by cheque or transfer — slow, fragile.',
      opportunity: 'A reservation-deposit payment link locks the unit in 30 seconds and settles next day.',
    },
  },
];

export function getSectorTemplate(sector: string | null | undefined): SectorTemplate {
  if (!sector) return GENERIC;
  const lower = sector.toLowerCase();
  for (const o of SECTOR_OVERRIDES) {
    if (o.keys.some(k => lower.includes(k))) {
      // Merge: overrides take precedence, GENERIC fills gaps.
      return { ...GENERIC, ...o.template } as SectorTemplate;
    }
  }
  return GENERIC;
}

/** Replace {{businessName}} / {{emirate}} placeholders. Unknown placeholders stay literal. */
export function interpolate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? vars[k] : `{{${k}}}`));
}
