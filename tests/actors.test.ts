// tests/actors.test.ts — fixture-based tests for the new Apify-style actors.
// Pure, no network, no DB.
import { extractJsonLd, extractMeta } from '../server/actors/jsonLdExtractor';
import { parseNominatim } from '../server/actors/nominatimActor';
import { parseSerperResponse } from '../server/actors/serperSearch';
import { parseInstagramHtml, parseInstagramWebProfileJson } from '../server/actors/instagramActor';

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

// ---------- HERE Geocoding (parseNominatim) ----------

const HERE_RAW = {
  items: [
    {
      title: 'Abaya Boutique DXB',
      id: 'here:pds:place:ae:001',
      resultType: 'place',
      address: {
        label: 'Abaya Boutique DXB, Sheikh Zayed Rd, Dubai, 00000, UAE',
        countryCode: 'ARE',
        countryName: 'United Arab Emirates',
        state: 'Dubai',
        city: 'Dubai',
        street: 'Sheikh Zayed Rd',
        postalCode: '00000',
      },
      position: { lat: 25.197197, lng: 55.274376 },
      categories: [{ id: '400-4100-0045', name: 'Clothing', primary: true }],
      contacts: [
        {
          phone: [{ value: '+971 4 123 4567' }],
          www: [{ value: 'https://abaya-boutique.ae' }],
        },
      ],
    },
    {
      // missing position — must be filtered out
      title: 'Broken Place',
      id: 'here:pds:place:ae:002',
      resultType: 'place',
      address: { label: 'Broken Place, Dubai, UAE' },
    },
    {
      title: 'Arabic Flavors',
      id: 'here:pds:place:ae:003',
      resultType: 'place',
      address: {
        label: 'Arabic Flavors, Abu Dhabi, UAE',
        countryCode: 'ARE',
        countryName: 'UAE',
        city: 'Abu Dhabi',
      },
      position: { lat: 24.4539, lng: 54.3773 },
      categories: [{ id: '100-1000-0000', name: 'Restaurant', primary: true }],
    },
  ],
};

describe('parseNominatim', () => {
  const places = parseNominatim(HERE_RAW);

  test('keeps only places with valid coordinates', () => {
    expect(places.length).toBe(2);
  });

  test('maps core fields from HERE response', () => {
    const [first] = places;
    expect(first.name).toBe('Abaya Boutique DXB');
    expect(first.category).toBe('Clothing');
    expect(first.address.city).toBe('Dubai');
    expect(first.address.countryCode).toBe('are');
    expect(first.phone).toBe('+971 4 123 4567');
    expect(first.website).toBe('https://abaya-boutique.ae');
  });

  test('parses second valid place correctly', () => {
    const [, second] = places;
    expect(second.name).toBe('Arabic Flavors');
    expect(second.category).toBe('Restaurant');
    expect(second.address.city).toBe('Abu Dhabi');
  });

  test('returns empty array on bad input', () => {
    expect(parseNominatim(null as any)).toEqual([]);
    expect(parseNominatim('bad' as any)).toEqual([]);
  });
});

// ---------- Serper (Google Search API) ----------

const SERPER_RAW = {
  organic: [
    {
      title: 'Abaya Boutique DXB',
      link: 'https://abaya-boutique.ae',
      snippet: 'Best abayas in Dubai, UAE.',
    },
    {
      title: 'No URL result',
      snippet: 'This should be skipped.',
    },
    {
      title: 'Arabic Flavors',
      link: 'https://arabicflavors.ae',
      snippet: 'Authentic Arabic cuisine in Abu Dhabi.',
    },
  ],
};

describe('parseSerperResponse', () => {
  const results = parseSerperResponse(SERPER_RAW);

  test('parses organic results and skips entries without link', () => {
    expect(results.length).toBe(2);
  });

  test('maps title, url, and description', () => {
    const [first] = results;
    expect(first.url).toBe('https://abaya-boutique.ae');
    expect(first.title).toBe('Abaya Boutique DXB');
    expect(first.description).toBe('Best abayas in Dubai, UAE.');
  });

  test('returns empty array on bad input', () => {
    expect(parseSerperResponse(null)).toEqual([]);
    expect(parseSerperResponse({ organic: 'bad' })).toEqual([]);
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

  test('pulls raw follower count from inlined edge_followed_by JSON (overrides og:description)', () => {
    const html = `
      <meta property="og:title" content="Big Shop (@big_shop)" />
      <meta property="og:description" content="12.3K Followers, 450 Following, 200 Posts - @big_shop on Instagram" />
      <script>"edge_followed_by":{"count":12456}</script>
      <script>"edge_follow":{"count":321}</script>
      <script>"edge_owner_to_timeline_media":{"count":199,"page_info":{}}</script>
    `;
    const p = parseInstagramHtml('big_shop', html);
    expect(p!.followers).toBe(12456);
    expect(p!.following).toBe(321);
    expect(p!.posts).toBe(199);
  });

  test('handles lowercase "followers" and bullet separators', () => {
    const html = `
      <meta property="og:title" content="Lower (@lower)" />
      <meta property="og:description" content="7,895 followers · 543 following · 234 posts — @lower on Instagram" />
    `;
    const p = parseInstagramHtml('lower', html);
    expect(p!.followers).toBe(7895);
    expect(p!.following).toBe(543);
    expect(p!.posts).toBe(234);
  });
});

// ---------- Instagram web_profile_info JSON parser ----------

describe('parseInstagramWebProfileJson', () => {
  test('pulls counts + bio + external_url from the API response shape', () => {
    const raw = {
      data: {
        user: {
          full_name: 'Luxury Abaya DXB',
          biography: 'Handmade abayas — order on WhatsApp +971 50 123 4567',
          edge_followed_by: { count: 12456 },
          edge_follow: { count: 321 },
          edge_owner_to_timeline_media: { count: 199 },
          external_url: 'https://luxury-abaya.ae',
          profile_pic_url_hd: 'https://cdn.instagram.com/big.jpg',
          category_name: 'Clothing (Brand)',
          is_verified: true,
          is_business_account: true,
        },
      },
    };
    const p = parseInstagramWebProfileJson('luxury_abaya_dxb', raw);
    expect(p).not.toBeNull();
    expect(p!.followers).toBe(12456);
    expect(p!.following).toBe(321);
    expect(p!.posts).toBe(199);
    expect(p!.externalUrl).toBe('https://luxury-abaya.ae');
    expect(p!.category).toBe('Clothing (Brand)');
    expect(p!.isVerified).toBe(true);
    expect(p!.isBusinessAccount).toBe(true);
    expect(p!.bio).toMatch(/WhatsApp/);
  });

  test('returns null when data.user is missing', () => {
    expect(parseInstagramWebProfileJson('x', {})).toBeNull();
    expect(parseInstagramWebProfileJson('x', { data: {} })).toBeNull();
    expect(parseInstagramWebProfileJson('x', null)).toBeNull();
  });
});
