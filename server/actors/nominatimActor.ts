// server/actors/nominatimActor.ts
// OpenStreetMap Nominatim actor — free, no API key, permissive usage policy
// (<=1 req/s, custom UA required). Returns structured place data: name, category,
// lat/lon, full display address, and — when available — contact tags (phone,
// website) from OSM's extratags.
//
// Pure parser is exported separately so tests don't hit the network.

import axios from 'axios';
import { logger } from '../logger';

export interface NominatimPlace {
  name: string;
  category: string;          // OSM class:type pair, e.g. "shop:clothes"
  displayName: string;
  lat: number;
  lon: number;
  address: {
    road?: string;
    suburb?: string;
    city?: string;
    state?: string;
    country?: string;
    countryCode?: string;
    postcode?: string;
  };
  phone?: string;
  website?: string;
  osmType: string;
  osmId: number;
}

// Pure parser — exported for unit tests. Accepts the raw Nominatim JSON array.
export function parseNominatim(raw: any[]): NominatimPlace[] {
  if (!Array.isArray(raw)) return [];
  const out: NominatimPlace[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const lat = Number(r.lat);
    const lon = Number(r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const extratags = (r.extratags && typeof r.extratags === 'object') ? r.extratags : {};
    const addr = (r.address && typeof r.address === 'object') ? r.address : {};

    out.push({
      name:
        (typeof r.name === 'string' && r.name.trim()) ||
        (typeof addr.shop === 'string' && addr.shop) ||
        (typeof addr.amenity === 'string' && addr.amenity) ||
        (typeof r.display_name === 'string' ? r.display_name.split(',')[0].trim() : ''),
      category: `${r.class || 'place'}:${r.type || 'unknown'}`,
      displayName: String(r.display_name || ''),
      lat,
      lon,
      address: {
        road: addr.road,
        suburb: addr.suburb || addr.neighbourhood,
        city: addr.city || addr.town || addr.village,
        state: addr.state,
        country: addr.country,
        countryCode: addr.country_code,
        postcode: addr.postcode,
      },
      phone: extratags.phone || extratags['contact:phone'] || undefined,
      website: extratags.website || extratags['contact:website'] || undefined,
      osmType: String(r.osm_type || ''),
      osmId: Number(r.osm_id || 0),
    });
  }
  return out.filter((p) => p.name && p.name.length >= 2);
}

interface SearchOpts {
  query: string;
  countryCode?: string;       // e.g. 'ae' to scope to UAE
  limit?: number;
  timeoutMs?: number;
}

export async function searchNominatim(opts: SearchOpts): Promise<NominatimPlace[]> {
  const {
    query,
    countryCode = 'ae',
    limit = 20,
    timeoutMs = 8000,
  } = opts;

  const url = 'https://nominatim.openstreetmap.org/search';
  try {
    const res = await axios.get(url, {
      timeout: timeoutMs,
      params: {
        q: query,
        format: 'jsonv2',
        addressdetails: 1,
        extratags: 1,
        limit,
        countrycodes: countryCode,
      },
      headers: {
        // Nominatim requires an identifying UA per their usage policy
        'User-Agent': 'FatoorahHunter/1.0 (+https://github.com/OgSmiley1/Fatoorah-legacy-)',
        Accept: 'application/json',
      },
      validateStatus: (s) => s >= 200 && s < 400,
    });
    return parseNominatim(res.data);
  } catch (e: any) {
    logger.debug('nominatim_search_failed', { query, error: e.message });
    return [];
  }
}
