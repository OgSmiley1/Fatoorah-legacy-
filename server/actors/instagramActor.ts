// server/actors/instagramActor.ts
// Instagram public profile enrichment — reads the HTML <meta> tags that Instagram
// ships server-side. Works without auth for public accounts; yields the bio-line
// description (which typically contains phone / email / website / category) plus
// follower count from the og:description format: "X Followers, Y Following, Z Posts".
//
// Pure parser exported separately so tests don't hit Instagram.

export interface InstagramProfile {
  handle: string;
  displayName?: string;
  bio?: string;              // the og:description bio line
  followers?: number;
  following?: number;
  posts?: number;
  profilePicUrl?: string;
  externalUrl?: string;      // linktree / website — extracted from bio if present
  category?: string;
}

function parseFollowerCount(str: string): number | undefined {
  // Handles "1,234", "1.2k", "45K", "2.3M", " 12 800 "
  const trimmed = str.trim().replace(/,/g, '');
  const m = trimmed.match(/^([\d.]+)\s*([kmb])?$/i);
  if (!m) {
    const n = Number(trimmed.replace(/\s+/g, ''));
    return Number.isFinite(n) ? n : undefined;
  }
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return undefined;
  const suffix = (m[2] || '').toLowerCase();
  const mult = suffix === 'k' ? 1_000 : suffix === 'm' ? 1_000_000 : suffix === 'b' ? 1_000_000_000 : 1;
  return Math.round(n * mult);
}

// Parses the Instagram og:description line, which looks like:
//   "12.3K Followers, 456 Following, 789 Posts - See Instagram photos and videos from Shop Name (@shop_handle)"
const IG_STATS_RE =
  /([\d.,]+\s*[KMBkmb]?)\s*Followers?[,\s]+([\d.,]+\s*[KMBkmb]?)\s*Following[,\s]+([\d.,]+\s*[KMBkmb]?)\s*Posts?/i;

export function parseInstagramHtml(handle: string, html: string): InstagramProfile | null {
  if (!html || typeof html !== 'string') return null;

  const pick = (re: RegExp) => {
    const m = html.match(re);
    return m ? m[1].trim() : undefined;
  };

  const ogDesc = pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  const ogTitle = pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const ogImage = pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);

  if (!ogDesc && !ogTitle) return null;

  const profile: InstagramProfile = { handle };

  if (ogTitle) {
    // "Display Name (@handle) • Instagram photos and videos" — keep display name only
    profile.displayName = ogTitle.split('(@')[0].trim() || undefined;
  }

  if (ogDesc) {
    const statsMatch = ogDesc.match(IG_STATS_RE);
    if (statsMatch) {
      profile.followers = parseFollowerCount(statsMatch[1]);
      profile.following = parseFollowerCount(statsMatch[2]);
      profile.posts = parseFollowerCount(statsMatch[3]);
    }
    // The bio usually follows " - " after the stats+handle preamble
    const bioSplit = ogDesc.split(/ - /);
    if (bioSplit.length > 1) {
      profile.bio = bioSplit.slice(1).join(' - ').trim();
    } else {
      profile.bio = ogDesc.trim();
    }
  }

  if (ogImage) profile.profilePicUrl = ogImage;

  // Look for external_url in any embedded JSON/JSON-LD blob on the page
  const extUrlMatch = html.match(/"external_url":"([^"]+)"/);
  if (extUrlMatch) {
    try {
      profile.externalUrl = JSON.parse(`"${extUrlMatch[1]}"`);
    } catch {
      profile.externalUrl = extUrlMatch[1];
    }
  }

  const catMatch = html.match(/"category_name":"([^"]+)"/) || html.match(/"category":"([^"]+)"/);
  if (catMatch) profile.category = catMatch[1];

  return profile;
}
