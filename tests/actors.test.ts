// tests/actors.test.ts — fixture-based tests for the new Apify-style actors.
// Pure, no network, no DB.
import { extractJsonLd, extractMeta } from '../server/actors/jsonLdExtractor';
import { parseNominatim } from '../server/actors/nominatimActor';
import { parseInstagramHtml } from '../server/actors/instagramActor';

// ---------- JSON-LD ----------

const JSON_LD_HTML = `
<!DOCTYPE html>
<html>
<head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Store",
  "name": "Luxury Abaya DXB",
  "telephone": "+971 50 123 4567",
  "email": "mailto:hello@luxury-abaya.ae",
  "url": "https://luxury-abaya.ae",
  "priceRange": "AED 250 - AED 3000",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "Shop 12, Dubai Mall",
    "addressLocality": "Dubai",
    "addressRegion": "Dubai",
    "addressCountry": "AE",
    "postalCode": "00000"
  },
  "sameAs": [
    "https://instagram.com/luxury_abaya_dxb",
    "https://facebook.com/luxuryabayadxb",
    "https://tiktok.com/@luxury_abaya"
  ],
  "openingHours": ["Mo-Su 10:00-22:00"],
  "paymentAccepted": "Cash, Credit Card",
  "currenciesAccepted": "AED"
}
</script>
</head>
<body>content</body>
</html>`;

const JSON_LD_GRAPH_HTML = `
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebSite", "name": "Site" },
    {
      "@type": ["LocalBusiness", "Restaurant"],
      "name": "Arabic Flavors",
      "telephone": "042223344",
      "address": { "@type": "PostalAddress", "addressLocality": "Abu Dhabi", "addressCountry": { "@type": "Country", "name": "United Arab Emirates" } }
    }
  ]
}
</script>`;

describe('extractJsonLd', () => {
  test('extracts Store with full address and socials', () => {
    const s = extractJsonLd(JSON_LD_HTML);
    expect(s).not.toBeNull();
    expect(s!.name).toBe('Luxury Abaya DXB');
    expect(s!.telephone).toBe('+971 50 123 4567');
    expect(s!.email).toBe('hello@luxury-abaya.ae');
    expect(s!.addressLocality).toBe('Dubai');
    expect(s!.addressCountry).toBe('AE');
    expect(s!.postalCode).toBe('00000');
    expect(s!.priceRange).toMatch(/AED/);
    expect(s!.sameAs).toContain('https://instagram.com/luxury_abaya_dxb');
    expect(s!.sameAs).toContain('https://tiktok.com/@luxury_abaya');
    expect(s!.types).toContain('Store');
  });

  test('walks @graph and picks the business node', () => {
    const s = extractJsonLd(JSON_LD_GRAPH_HTML);
    expect(s).not.toBeNull();
    expect(s!.name).toBe('Arabic Flavors');
    expect(s!.telephone).toBe('042223344');
    expect(s!.addressLocality).toBe('Abu Dhabi');
    expect(s!.addressCountry).toBe('United Arab Emirates');
  });

  test('returns null when no business node present', () => {
    const s = extractJsonLd(`
      <script type="application/ld+json">
        {"@type":"WebPage","name":"Home"}
      </script>`);
    expect(s).toBeNull();
  });

  test('recovers from trailing commas', () => {
    const s = extractJsonLd(`
      <script type="application/ld+json">
        {"@type":"LocalBusiness","name":"Souk Shop","telephone":"+97141234567",}
      </script>`);
    expect(s).not.toBeNull();
    expect(s!.name).toBe('Souk Shop');
  });
});

describe('extractMeta', () => {
  test('pulls OG and canonical tags', () => {
    const meta = extractMeta(`
      <title>Home | Store</title>
      <meta property="og:description" content="Best abayas in town" />
      <meta property="og:site_name" content="Abaya Shop" />
      <meta property="og:image" content="https://cdn.example.ae/banner.jpg" />
      <link rel="canonical" href="https://example.ae/" />
    `);
    expect(meta.title).toBe('Home | Store');
    expect(meta.description).toBe('Best abayas in town');
    expect(meta.ogSiteName).toBe('Abaya Shop');
    expect(meta.ogImage).toMatch(/banner\.jpg/);
    expect(meta.canonical).toBe('https://example.ae/');
  });
});

// ---------- Nominatim ----------

const NOMINATIM_RAW = [
  {
    osm_type: 'node',
    osm_id: 12345,
    lat: '25.197197',
    lon: '55.274376',
    class: 'shop',
    type: 'clothes',
    name: 'Abaya Boutique DXB',
    display_name: 'Abaya Boutique DXB, Sheikh Zayed Rd, Dubai, 00000, UAE',
    address: {
      road: 'Sheikh Zayed Rd',
      city: 'Dubai',
      state: 'Dubai',
      country: 'United Arab Emirates',
      country_code: 'ae',
      postcode: '00000',
    },
    extratags: {
      phone: '+971 4 123 4567',
      website: 'https://abaya-boutique.ae',
    },
  },
  {
    // missing lat/lon — must be filtered out
    osm_type: 'way',
    osm_id: 67890,
    name: 'Broken Place',
    class: 'amenity',
    type: 'cafe',
  },
  {
    osm_type: 'node',
    osm_id: 222,
    lat: '24.4539',
    lon: '54.3773',
    class: 'amenity',
    type: 'restaurant',
    display_name: 'Arabic Flavors, Abu Dhabi, UAE',
    address: { town: 'Abu Dhabi', country: 'UAE', country_code: 'ae' },
    extratags: {},
  },
];

describe('parseNominatim', () => {
  const places = parseNominatim(NOMINATIM_RAW);

  test('keeps only places with valid coordinates', () => {
    expect(places.length).toBe(2);
  });

  test('maps core fields + extratags', () => {
    const [first] = places;
    expect(first.name).toBe('Abaya Boutique DXB');
    expect(first.category).toBe('shop:clothes');
    expect(first.address.city).toBe('Dubai');
    expect(first.address.countryCode).toBe('ae');
    expect(first.phone).toBe('+971 4 123 4567');
    expect(first.website).toBe('https://abaya-boutique.ae');
  });

  test('falls back to display_name when name missing', () => {
    const [, second] = places;
    expect(second.name).toBe('Arabic Flavors');
    expect(second.category).toBe('amenity:restaurant');
    expect(second.address.city).toBe('Abu Dhabi');
  });

  test('returns empty array on bad input', () => {
    expect(parseNominatim(null as any)).toEqual([]);
    expect(parseNominatim('bad' as any)).toEqual([]);
  });
});

// ---------- Instagram ----------

const IG_PUBLIC_PROFILE = `
<!DOCTYPE html>
<html>
<head>
  <meta property="og:title" content="Luxury Abaya DXB (@luxury_abaya_dxb) • Instagram photos and videos" />
  <meta property="og:description" content="12.3K Followers, 456 Following, 789 Posts - See Instagram photos and videos from Luxury Abaya DXB (@luxury_abaya_dxb)" />
  <meta property="og:image" content="https://cdn.instagram.com/pic.jpg" />
</head>
<body>
<script>
  window._sharedData = {"external_url":"https:\\/\\/luxury-abaya.ae","category_name":"Clothing (Brand)"};
</script>
</body>
</html>`;

const IG_TINY_PROFILE = `
<meta property="og:title" content="Small Shop (@small_shop)" />
<meta property="og:description" content="234 Followers, 180 Following, 42 Posts - Handmade in Dubai 🇦🇪 WhatsApp +971 50 999 8888 - orders@small.ae" />
`;

describe('parseInstagramHtml', () => {
  test('extracts followers/following/posts + external url + category', () => {
    const p = parseInstagramHtml('luxury_abaya_dxb', IG_PUBLIC_PROFILE);
    expect(p).not.toBeNull();
    expect(p!.handle).toBe('luxury_abaya_dxb');
    expect(p!.displayName).toBe('Luxury Abaya DXB');
    expect(p!.followers).toBe(12300);
    expect(p!.following).toBe(456);
    expect(p!.posts).toBe(789);
    expect(p!.externalUrl).toBe('https://luxury-abaya.ae');
    expect(p!.category).toBe('Clothing (Brand)');
    expect(p!.profilePicUrl).toMatch(/instagram/);
  });

  test('parses small accounts and keeps bio line', () => {
    const p = parseInstagramHtml('small_shop', IG_TINY_PROFILE);
    expect(p).not.toBeNull();
    expect(p!.followers).toBe(234);
    expect(p!.bio).toMatch(/Handmade in Dubai/);
    expect(p!.bio).toMatch(/orders@small\.ae/);
  });

  test('returns null when meta tags missing', () => {
    expect(parseInstagramHtml('x', '<html><body>empty</body></html>')).toBeNull();
  });
});
