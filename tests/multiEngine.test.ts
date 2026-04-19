// tests/multiEngine.test.ts — fixture-based tests for the new keyless engines,
// the consensus scorer, and the classifier helpers for the email/WhatsApp verifiers.
// Pure — no network, no DB.

import { parseBraveHtml } from '../server/actors/braveSearch';
import { parseStartpageHtml } from '../server/actors/startpageSearch';
import { parseMojeekHtml } from '../server/actors/mojeekSearch';
import { parseSearxJson } from '../server/actors/searxMetaSearch';
import { classifyWhatsappPage } from '../server/actors/whatsappVerifier';
import {
  buildConsensus,
  identityKey,
  normalizePhone,
  normalizeHandle,
  normalizeEmail,
  normalizeDomain,
  isInstitutionalLead,
  type RawLead,
} from '../server/verificationService';

// ---------- Brave ----------

const BRAVE_HTML = `
<div class="snippet fdb" data-type="web">
  <a class="heading-serpresult" href="https://luxury-abaya.ae/">
    <h3 class="title">Luxury Abaya DXB - Authentic Arabic Fashion</h3>
  </a>
  <div class="snippet-description">Handmade abayas delivered across UAE. Cash on delivery. WhatsApp +971 50 123 4567.</div>
</div>
<div class="snippet">
  <a class="heading-serpresult" href="https://shop.example.ae/">
    <h3 class="title">Example Abaya Shop</h3>
  </a>
  <div class="snippet-description">Premium abayas in Dubai. <strong>Tabby</strong> &amp; Apple Pay.</div>
</div>
`;

describe('parseBraveHtml', () => {
  const results = parseBraveHtml(BRAVE_HTML);

  test('parses both Brave results', () => {
    expect(results.length).toBe(2);
  });

  test('strips tags and decodes entities from snippets', () => {
    expect(results[1].description).toMatch(/Tabby/);
    expect(results[1].description).not.toContain('<strong>');
    expect(results[1].description).not.toContain('&amp;');
  });

  test('captures absolute URLs', () => {
    expect(results[0].url).toBe('https://luxury-abaya.ae/');
  });
});

// ---------- Startpage ----------

const STARTPAGE_HTML = `
<section class="w-gl__result">
  <a class="w-gl__result-title result-link" href="https://instagram.com/dubai_oud">Dubai Oud (@dubai_oud)</a>
  <p class="w-gl__description">Authentic Arabic oud &amp; bakhoor. WhatsApp 0501234567</p>
</section>
<section class="w-gl__result">
  <a class="w-gl__result-title result-link" href="https://madeinuae.ae/perfumes">Made in UAE - Perfumes</a>
  <p class="w-gl__description">Shop local UAE perfumes with Tabby.</p>
</section>
`;

describe('parseStartpageHtml', () => {
  const results = parseStartpageHtml(STARTPAGE_HTML);

  test('extracts 2 results', () => {
    expect(results.length).toBe(2);
  });

  test('gets direct URLs and decoded titles', () => {
    expect(results[0].url).toBe('https://instagram.com/dubai_oud');
    expect(results[0].description).toMatch(/WhatsApp/);
  });
});

// ---------- Mojeek ----------

const MOJEEK_HTML = `
<ul class="results">
  <li class="r">
    <a class="ob" href="https://luxury-abaya.ae/"><h2>Luxury Abaya</h2></a>
    <p class="s">Dubai abaya shop - cash on delivery.</p>
  </li>
  <li class="r">
    <a class="ob" href="https://shop.other.ae/"><h2>Other Shop</h2></a>
    <p class="s">Perfumes with Stripe checkout.</p>
  </li>
</ul>
`;

describe('parseMojeekHtml', () => {
  const results = parseMojeekHtml(MOJEEK_HTML);

  test('parses both Mojeek results', () => {
    expect(results.length).toBe(2);
  });

  test('extracts title + snippet', () => {
    expect(results[0].title).toBe('Luxury Abaya');
    expect(results[1].description).toMatch(/Stripe/);
  });
});

// ---------- Searx ----------

describe('parseSearxJson', () => {
  test('maps results[] entries to SearchResult shape', () => {
    const out = parseSearxJson({
      results: [
        {
          url: 'https://luxury-abaya.ae/',
          title: 'Luxury Abaya',
          content: 'UAE abaya shop with cash on delivery',
        },
        {
          url: 'https://instagram.com/dubai_oud',
          title: 'Dubai Oud',
          content: '',
          pretty_url: 'instagram.com/dubai_oud',
        },
      ],
    });
    expect(out.length).toBe(2);
    expect(out[0].url).toBe('https://luxury-abaya.ae/');
    expect(out[0].description).toMatch(/cash on delivery/i);
    expect(out[1].description).toBe('instagram.com/dubai_oud');
  });

  test('skips non-http urls and bad entries', () => {
    const out = parseSearxJson({
      results: [
        { url: 'javascript:void(0)', title: 'X' },
        null,
        { url: 'https://ok.ae', title: 'OK' },
      ],
    });
    expect(out.length).toBe(1);
  });

  test('returns empty array on bad input', () => {
    expect(parseSearxJson(null)).toEqual([]);
    expect(parseSearxJson({})).toEqual([]);
  });
});

// ---------- WhatsApp classifier ----------

describe('classifyWhatsappPage', () => {
  test('detects valid chat page', () => {
    expect(
      classifyWhatsappPage(
        '<html><body><a class="_9vd5">Continue to Chat</a><script>{"isCountrySupported":true}</script></body></html>'
      )
    ).toBe('live');
  });

  test('detects invalid-number sentinel', () => {
    expect(
      classifyWhatsappPage(
        '<div>Phone number shared via url is invalid.</div>'
      )
    ).toBe('not_registered');
  });

  test('detects Arabic invalid-number sentinel', () => {
    expect(
      classifyWhatsappPage(
        '<p>الرقم الذي تمت مشاركته غير صالح</p>'
      )
    ).toBe('not_registered');
  });

  test('returns unknown for ambiguous html', () => {
    expect(classifyWhatsappPage('<html></html>')).toBe('unknown');
  });
});

// ---------- Normalizers ----------

describe('normalizers', () => {
  test('normalizePhone converts UAE local to E.164', () => {
    expect(normalizePhone('0501234567')).toBe('+971501234567');
    expect(normalizePhone('+971 50 123 4567')).toBe('+971501234567');
    expect(normalizePhone('00971501234567')).toBe('+971501234567');
    expect(normalizePhone('971501234567')).toBe('+971501234567');
  });

  test('normalizePhone rejects short garbage', () => {
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });

  test('normalizeHandle strips @ and rejects reserved paths', () => {
    expect(normalizeHandle('@Shop_DXB')).toBe('shop_dxb');
    expect(normalizeHandle('p')).toBeNull();
    expect(normalizeHandle('reel')).toBeNull();
  });

  test('normalizeHandle rejects government / institutional handles', () => {
    expect(normalizeHandle('uaemgov')).toBeNull();
    expect(normalizeHandle('dxb_police')).toBeNull();
    expect(normalizeHandle('ministry_of_health')).toBeNull();
    expect(normalizeHandle('dnrd_official')).toBeNull();
    expect(normalizeHandle('luxury_boutique_dxb')).toBe('luxury_boutique_dxb');
  });

  test('normalizeEmail lowercases and validates', () => {
    expect(normalizeEmail('Hello@Shop.AE')).toBe('hello@shop.ae');
    expect(normalizeEmail('mailto:info@shop.ae')).toBe('info@shop.ae');
    expect(normalizeEmail('not-an-email')).toBeNull();
  });

  test('normalizeDomain strips www and protocol', () => {
    expect(normalizeDomain('https://www.shop.ae/path')).toBe('shop.ae');
    expect(normalizeDomain('shop.ae')).toBe('shop.ae');
  });
});

// ---------- isInstitutionalLead ----------

describe('isInstitutionalLead', () => {
  test('flags gov email domains', () => {
    expect(isInstitutionalLead({ email: 'info@dnrd.ae' })).toBe(true);
    expect(isInstitutionalLead({ email: 'amer@mohre.gov.ae' })).toBe(true);
    expect(isInstitutionalLead({ email: 'info@luxury-shop.ae' })).toBe(false);
  });

  test('flags institutional business names', () => {
    expect(isInstitutionalLead({ businessName: 'Ministry of Economy' })).toBe(true);
    expect(isInstitutionalLead({ businessName: 'Dubai Municipality' })).toBe(true);
    expect(isInstitutionalLead({ businessName: 'Luxury Abaya DXB' })).toBe(false);
  });

  test('flags institutional instagram handles', () => {
    expect(isInstitutionalLead({ instagramHandle: 'uaemgov' })).toBe(true);
    expect(isInstitutionalLead({ instagramHandle: 'luxury_abaya_dxb' })).toBe(false);
  });
});

// ---------- identityKey + consensus ----------

describe('identityKey', () => {
  test('prefers phone over other identifiers', () => {
    const key = identityKey({
      source: 'ddg',
      phone: '0501234567',
      email: 'x@y.ae',
      instagramHandle: 'foo',
      website: 'https://shop.ae',
    });
    expect(key).toBe('phone:+971501234567');
  });

  test('falls back to IG handle, then email, then domain', () => {
    expect(identityKey({ source: 'ddg', instagramHandle: 'shop' })).toBe('ig:shop');
    expect(identityKey({ source: 'ddg', email: 'x@shop.ae' })).toBe('email:x@shop.ae');
    expect(identityKey({ source: 'ddg', website: 'https://www.shop.ae/' })).toBe('domain:shop.ae');
  });

  test('returns null when nothing identifies the lead', () => {
    expect(identityKey({ source: 'ddg', businessName: 'Shop' })).toBeNull();
  });
});

describe('buildConsensus', () => {
  const raw: RawLead[] = [
    {
      source: 'ddg',
      businessName: 'Luxury Abaya DXB',
      phone: '0501234567',
      website: 'https://luxury-abaya.ae/',
      instagramHandle: 'luxury_abaya_dxb',
    },
    {
      source: 'bing',
      businessName: 'Luxury Abaya',
      phone: '+971 50 123 4567',
      website: 'https://luxury-abaya.ae/',
    },
    {
      source: 'brave',
      businessName: 'Luxury Abaya DXB',
      phone: '501234567',
    },
    {
      source: 'nominatim',
      businessName: 'Mall Abaya Boutique',
      website: 'https://abaya-boutique.ae',
      phone: '+9714123456',
    },
  ];

  const consensus = buildConsensus(raw);

  test('groups by phone identity across engines', () => {
    const lux = consensus.find((c) => c.identityKey === 'phone:+971501234567');
    expect(lux).toBeDefined();
    expect(lux!.sources.sort()).toEqual(['bing', 'brave', 'ddg']);
    expect(lux!.agreementScore).toBe(3);
    expect(lux!.verifiedStatus).toBe('VERIFIED');
    expect(lux!.businessName.length).toBeGreaterThan(0);
    expect(lux!.instagramHandle).toBe('luxury_abaya_dxb');
  });

  test('keeps solo leads as UNVERIFIED', () => {
    const solo = consensus.find((c) => c.identityKey === 'phone:+9714123456');
    expect(solo).toBeDefined();
    expect(solo!.verifiedStatus).toBe('UNVERIFIED');
    expect(solo!.agreementScore).toBe(1);
  });

  test('sorts VERIFIED first', () => {
    expect(consensus[0].verifiedStatus).toBe('VERIFIED');
  });
});
