// server/actors/jsonLdExtractor.ts
// Pure JSON-LD + microdata extractor. No network, no DB — safe to unit-test.
// Pulls structured data (Organization / LocalBusiness / Store / Restaurant / Product)
// from page HTML. This is the single biggest data-quality lever: when a site ships
// schema.org JSON-LD it typically carries canonical name, telephone, address,
// sameAs (social links), and openingHours — all in one blob.

export interface StructuredBusiness {
  name?: string;
  legalName?: string;
  telephone?: string;
  email?: string;
  url?: string;
  address?: string;
  addressLocality?: string;
  addressRegion?: string;
  addressCountry?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  sameAs: string[];          // social links (instagram, facebook, tiktok, etc.)
  priceRange?: string;
  openingHours?: string[];
  types: string[];            // e.g. ['LocalBusiness', 'Store']
  currenciesAccepted?: string;
  paymentAccepted?: string;
}

const BUSINESS_TYPE_RE =
  /^(Organization|LocalBusiness|Store|Restaurant|Cafe|Bakery|ClothingStore|HomeGoodsStore|JewelryStore|PerfumeStore|BeautySalon|HairSalon|SpaSalon|HealthAndBeautyBusiness|HomeAndConstructionBusiness|Corporation|Brand|Hotel|FoodEstablishment|ShoppingCenter|Dentist|Physician|MedicalBusiness|ProfessionalService|FinancialService|AutomotiveBusiness|Florist|LegalService|RealEstateAgent|TravelAgency|SportingGoodsStore|ElectronicsStore|FurnitureStore|GardenStore|HardwareStore|LiquorStore|MensClothingStore|MobilePhoneStore|PetStore|ShoeStore|SportingGoodsStore|TireShop|ToyStore|WholesaleStore|WomensClothingStore|Online(Store|Business))$/i;

function isBusinessNode(node: any): boolean {
  if (!node || typeof node !== 'object') return false;
  const t = node['@type'];
  if (!t) return false;
  if (Array.isArray(t)) return t.some((x) => typeof x === 'string' && BUSINESS_TYPE_RE.test(x));
  return typeof t === 'string' && BUSINESS_TYPE_RE.test(t);
}

function toArray(v: any): any[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function flattenGraph(root: any): any[] {
  const out: any[] = [];
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    out.push(n);
    if (n['@graph']) toArray(n['@graph']).forEach(walk);
  };
  walk(root);
  return out;
}

function mergeBusiness(node: any, acc: StructuredBusiness) {
  if (!acc.name && typeof node.name === 'string') acc.name = node.name.trim();
  if (!acc.legalName && typeof node.legalName === 'string') acc.legalName = node.legalName.trim();
  if (!acc.telephone && node.telephone) acc.telephone = String(node.telephone).trim();
  if (!acc.email && node.email) acc.email = String(node.email).trim().replace(/^mailto:/i, '');
  if (!acc.url && typeof node.url === 'string') acc.url = node.url.trim();
  if (!acc.priceRange && typeof node.priceRange === 'string') acc.priceRange = node.priceRange;

  const addr = node.address;
  if (addr) {
    const a = Array.isArray(addr) ? addr[0] : addr;
    if (typeof a === 'string') {
      if (!acc.address) acc.address = a;
    } else if (a && typeof a === 'object') {
      if (!acc.address && typeof a.streetAddress === 'string') acc.address = a.streetAddress;
      if (!acc.addressLocality && typeof a.addressLocality === 'string')
        acc.addressLocality = a.addressLocality;
      if (!acc.addressRegion && typeof a.addressRegion === 'string')
        acc.addressRegion = a.addressRegion;
      if (!acc.addressCountry) {
        const c = a.addressCountry;
        if (typeof c === 'string') acc.addressCountry = c;
        else if (c && typeof c === 'object' && typeof c.name === 'string') acc.addressCountry = c.name;
      }
      if (!acc.postalCode && (typeof a.postalCode === 'string' || typeof a.postalCode === 'number'))
        acc.postalCode = String(a.postalCode);
    }
  }

  const geo = node.geo;
  if (geo && typeof geo === 'object') {
    const lat = Number(geo.latitude);
    const lon = Number(geo.longitude);
    if (Number.isFinite(lat) && !acc.latitude) acc.latitude = lat;
    if (Number.isFinite(lon) && !acc.longitude) acc.longitude = lon;
  }

  for (const s of toArray(node.sameAs)) {
    if (typeof s === 'string' && s.startsWith('http') && !acc.sameAs.includes(s)) {
      acc.sameAs.push(s);
    }
  }

  const hours = toArray(node.openingHours);
  if (hours.length && (!acc.openingHours || !acc.openingHours.length)) {
    acc.openingHours = hours.filter((h) => typeof h === 'string');
  }

  const types = toArray(node['@type']).filter((t) => typeof t === 'string');
  for (const t of types) if (!acc.types.includes(t)) acc.types.push(t);

  if (!acc.currenciesAccepted && typeof node.currenciesAccepted === 'string')
    acc.currenciesAccepted = node.currenciesAccepted;
  if (!acc.paymentAccepted && typeof node.paymentAccepted === 'string')
    acc.paymentAccepted = node.paymentAccepted;
}

export function extractJsonLd(html: string): StructuredBusiness | null {
  const acc: StructuredBusiness = { sameAs: [], types: [] };
  const scriptRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  let found = false;

  while ((m = scriptRe.exec(html)) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Some sites embed JS comments or trailing commas — try to recover
      try {
        parsed = JSON.parse(raw.replace(/,\s*([\]}])/g, '$1'));
      } catch {
        continue;
      }
    }

    const nodes = flattenGraph(parsed);
    for (const node of nodes) {
      if (isBusinessNode(node)) {
        mergeBusiness(node, acc);
        found = true;
      }
    }
  }

  return found ? acc : null;
}

// Also pull Open Graph / Twitter Card / bio-style meta tags as a cheap fallback.
// These are usually present on Instagram/Facebook/shop pages even without JSON-LD.
export interface MetaSignals {
  title?: string;
  description?: string;
  ogSiteName?: string;
  ogImage?: string;
  canonical?: string;
}

export function extractMeta(html: string): MetaSignals {
  const out: MetaSignals = {};
  const pick = (re: RegExp) => {
    const m = html.match(re);
    return m ? m[1].trim() : undefined;
  };
  out.title = pick(/<title[^>]*>([^<]+)<\/title>/i);
  out.description =
    pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
    pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
    pick(/<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["']/i);
  out.ogSiteName = pick(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);
  out.ogImage = pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  out.canonical = pick(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
  return out;
}
