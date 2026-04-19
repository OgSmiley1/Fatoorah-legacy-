// tests/searchService.test.ts — pure parser + detector fixtures (no network, no DB)
import {
  parseDdgHtml,
  parseBingHtml,
  detectCod,
  detectGateways,
  extractContacts,
  stripTags,
  decodeHtml,
} from '../server/searchParsers';

// --- HTML fixtures that mimic real DDG / Bing results ---

const DDG_HTML = `
<div class="result">
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Finstagram.com%2Fluxury_abaya_dxb&rut=abc">
    Luxury Abaya DXB (@luxury_abaya_dxb) &middot; Instagram
  </a>
  <a class="result__snippet" href="//example">
    Handmade abayas delivered across UAE. Cash on delivery only. WhatsApp +971 50 123 4567.
  </a>
</div>
<div class="result">
  <a class="result__a" href="https://shop.example.ae/">Example Abaya Shop</a>
  <a class="result__snippet" href="//example">
    Premium abayas in Dubai. Contact info@example.ae for wholesale.
  </a>
</div>
`;

const BING_HTML = `
<ol id="b_results">
  <li class="b_algo">
    <h2><a href="https://instagram.com/dubai_oud" target="_blank">Dubai Oud (@dubai_oud)</a></h2>
    <p>Authentic Arabic oud &amp; bakhoor. كاش عند الاستلام. WhatsApp 0501234567</p>
  </li>
  <li class="b_algo">
    <h2><a href="https://madeinuae.ae/perfumes">Made in UAE - Perfumes</a></h2>
    <p>Shop local UAE perfumes with <strong>Tabby</strong> &amp; Apple Pay.</p>
  </li>
</ol>
`;

describe('parseDdgHtml', () => {
  const results = parseDdgHtml(DDG_HTML);

  test('extracts 2 results', () => {
    expect(results.length).toBe(2);
  });

  test('unwraps DDG redirect URL', () => {
    expect(results[0].url).toBe('https://instagram.com/luxury_abaya_dxb');
  });

  test('keeps direct URLs intact', () => {
    expect(results[1].url).toBe('https://shop.example.ae/');
  });

  test('decodes HTML entities and strips tags in title', () => {
    expect(results[0].title).toContain('Luxury Abaya DXB');
    expect(results[0].title).not.toContain('<');
  });

  test('captures snippet text', () => {
    expect(results[0].description).toMatch(/Cash on delivery/i);
  });
});

describe('parseBingHtml', () => {
  const results = parseBingHtml(BING_HTML);

  test('extracts 2 results', () => {
    expect(results.length).toBe(2);
  });

  test('extracts direct URL and stripped title', () => {
    expect(results[0].url).toBe('https://instagram.com/dubai_oud');
    expect(results[0].title).toBe('Dubai Oud (@dubai_oud)');
  });

  test('strips inline tags from snippet', () => {
    expect(results[1].description).toMatch(/Tabby/);
    expect(results[1].description).not.toContain('<strong>');
  });
});

describe('detectCod', () => {
  test('detects English COD', () => {
    const r = detectCod('We only accept cash on delivery across UAE.');
    expect(r.isCod).toBe(true);
    expect(r.evidence.length).toBeGreaterThan(0);
  });

  test('detects Arabic COD', () => {
    const r = detectCod('الدفع نقداً عند الاستلام — كاش فقط');
    expect(r.isCod).toBe(true);
  });

  test('returns false for no match', () => {
    const r = detectCod('Online payments via credit card.');
    expect(r.isCod).toBe(false);
    expect(r.evidence).toEqual([]);
  });
});

describe('detectGateways', () => {
  test('detects Stripe script', () => {
    const r = detectGateways('<script src="https://js.stripe.com/v3/"></script>');
    expect(r.hasGateway).toBe(true);
    expect(r.gateways).toContain('stripe');
  });

  test('detects MyFatoorah', () => {
    const r = detectGateways('Checkout powered by myfatoorah.com');
    expect(r.gateways).toContain('myfatoorah');
  });

  test('detects multiple gateways at once', () => {
    const r = detectGateways('Pay with Tabby, Tamara, or Apple Pay');
    expect(r.gateways.sort()).toEqual(expect.arrayContaining(['tabby', 'tamara', 'apple_pay']));
  });

  test('returns empty for plain text', () => {
    const r = detectGateways('Just some product description');
    expect(r.hasGateway).toBe(false);
  });
});

describe('extractContacts', () => {
  test('extracts UAE mobile phone', () => {
    const c = extractContacts('Call us at +971 50 123 4567 for orders');
    expect(c.phone).toBe('+971501234567');
  });

  test('extracts email', () => {
    const c = extractContacts('Email info@shop.ae or orders@shop.ae');
    expect(c.email).toBe('info@shop.ae');
  });

  test('extracts WhatsApp link', () => {
    const c = extractContacts('<a href="https://wa.me/971501234567">WhatsApp</a>');
    expect(c.whatsapp).toBe('971501234567');
  });

  test('extracts Instagram handle', () => {
    const c = extractContacts('<a href="https://instagram.com/my_shop">IG</a>');
    expect(c.instagram).toBe('my_shop');
  });

  test('rejects instagram reserved paths', () => {
    const c = extractContacts('<a href="https://instagram.com/p/ABC123/">post</a>');
    expect(c.instagram).toBeNull();
  });
});

describe('html utils', () => {
  test('decodeHtml decodes common entities', () => {
    expect(decodeHtml('Tabby &amp; Tamara')).toBe('Tabby & Tamara');
    expect(decodeHtml('foo &#39;bar&#39;')).toBe("foo 'bar'");
  });

  test('stripTags removes HTML', () => {
    expect(stripTags('<strong>bold</strong> text')).toBe('bold text');
  });
});
