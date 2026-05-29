// server/actors/nominatimActor.ts
// HERE Geocoding & Search API actor — replaces OpenStreetMap Nominatim.
// Returns structured place data: name, category, lat/lon, full display address,
// and contact info when available.
//
// Pure parser is exported separately so tests don't hit the network.
// Production rule: never hardcode API keys. If HERE_API_KEY is missing,
// searchNominatim returns [] and the wider hunt continues with other engines.

import axios from 'axios';
import { logger } from '../logger';

export interface NominatimPlace {
  name: string;
  category: string;
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

interface HereItem {
  title?: string;
  id?: string;
  resultType?: string;
  houseNumberType?: string;
  address?: {
    label?: string;
    countryCode?: string;
    countryName?: string;
    state?: string;
    county?: string;
    city?: string;
    district?: string;
    street?: string;
    postalCode?: string;
    houseNumber?: string;
  };
  position?: {
    lat: number;
    lng: number;
  };
  categories?: { id: string; name: string; primary?: boolean }[];
  contacts?: {
    phone?: { value: string }[];
    www?: { value: string }[];
  }[];
}

// Pure parser — exported for unit tests. Accepts the raw HERE geocode JSON response.
export function parseNominatim(raw: any): NominatimPlace[] {
  const items: HereItem[] = Array.isArray(raw?.items) ? raw.items : [];
  const out: NominatimPlace[] = [];

  for (const item of items) {
    const pos = item.position;
    if (!pos || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) continue;

    const addr = item.address || {};
    const primaryCategory = item.categories?.find((c) => c.primary) || item.categories?.[0];
    const category = primaryCategory ? primaryCategory.name : (item.resultType || 'place');

    const phone = item.contacts?.[0]?.phone?.[0]?.value;
    const website = item.contacts?.[0]?.www?.[0]?.value;

    const name = item.title || addr.label?.split(',')[0].trim() || '';
    if (!name || name.length < 2) continue;

    out.push({
      name,
      category,
      displayName: addr.label || name,
      lat: pos.lat,
      lon: pos.lng,
      address: {
        road: addr.street
          ? `${addr.street}${addr.houseNumber ? ' ' + addr.houseNumber : ''}`
          : undefined,
        suburb: addr.district,
        city: addr.city || addr.county,
        state: addr.state,
        country: addr.countryName,
        countryCode: addr.countryCode?.toLowerCase(),
        postcode: addr.postalCode,
      },
      phone,
      website,
      osmType: '',
      osmId: 0,
    });
  }

  return out;
}

interface SearchOpts {
  query: string;
  countryCode?: string;
  limit?: number;
  timeoutMs?: number;
}

export async function searchNominatim(opts: SearchOpts): Promise<NominatimPlace[]> {
  const apiKey = process.env.HERE_API_KEY;
  if (!apiKey) {
    logger.debug('here_geocode_skipped_missing_key', { query: opts.query });
    return [];
  }

  const {
    query,
    countryCode = 'AE',
    limit = 20,
    timeoutMs = 8000,
  } = opts;

  const url = 'https://geocode.search.hereapi.com/v1/geocode';
  try {
    const res = await axios.get(url, {
      timeout: timeoutMs,
      params: {
        q: query,
        in: `countryCode:${countryCode.toUpperCase()}`,
        limit,
        apiKey,
      },
      headers: {
        Accept: 'application/json',
      },
      validateStatus: (s) => s >= 200 && s < 400,
    });
    return parseNominatim(res.data);
  } catch (e: any) {
    logger.debug('here_geocode_search_failed', { query, error: e.message });
    return [];
  }
}
