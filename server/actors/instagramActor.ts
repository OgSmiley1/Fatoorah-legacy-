// server/actors/instagramActor.ts
// Instagram public profile enrichment. Two data paths:
//   1. Instagram's public web_profile_info JSON endpoint (used by instagram.com
//      itself when rendering profile cards — accepts the fixed X-IG-App-ID).
//      This returns accurate follower / following / posts counts even when
//      Instagram gates the logged-out HTML behind a login wall.
//   2. Fallback: parse og:description from the profile HTML, which Instagram
//      still serves server-side for most public profiles.
//
// Pure parsers (parseInstagramHtml, parseInstagramWebProfileJson) are exported
// separately so tests don't touch the network.

export interface InstagramProfile {
  handle: string;
  displayName?: string;
  bio?: string;
  followers?: number;
  following?: number;
  posts?: number;
  profilePicUrl?: string;
  externalUrl?: string;
  category?: string;
  isVerified?: boolean;
  isBusinessAccount?: boolean;
}

// Handles "1,234", "1.2k", "45K", "2.3M", "12 800", " 12.345.678 " (EU-style).
function parseFollowerCount(str: string): number | undefined {
  if (str == null) return undefined;
  const trimmed = String(str).trim();
  if (!trimmed) return undefined;
  // Suffix-based shorthand (12.3K, 1.5M)
  const suffix = trimmed.match(/^([\d.,]+)\s*([kmb])\b/i);
  if (suffix) {
    const n = Number(suffix[1].replace(/,/g, ''));
    if (!Number.isFinite(n)) return undefined;
    const mult = suffix[2].toLowerCase() === 'k' ? 1_000
               : suffix[2].toLowerCase() === 'm' ? 1_000_000
               : 1_000_000_000;
    return Math.round(n * mult);
  }
  // Plain numerics — strip thousands separators (comma, period-as-thousands, NBSP, thin space)
  const cleaned = trimmed.replace(/[,\u00a0\u202f\s]/g, '').replace(/\.(?=\d{3}\b)/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

// og:description is the fallback. It ships in several shapes:
//   "12.3K Followers, 456 Following, 789 Posts - See Instagram photos and videos from Shop (@shop)"
//   "12,345 Followers, 456 Following, 789 Posts - Shop (@shop) on Instagram"
//   "12.3K followers, 456 following, 789 posts - @shop on Instagram: \"bio...\""
// We match case-insensitively and accept either '-' or '•' as the bio separator.
const IG_STATS_RE =
  /([\d.,\u00a0\u202f\s]+[KMBkmb]?)\s*followers?[,\s·•]+([\d.,\u00a0\u202f\s]+[KMBkmb]?)\s*following[,\s·•]+([\d.,\u00a0\u202f\s]+[KMBkmb]?)\s*posts?/i;

// Embedded JSON blob inside the Instagram profile HTML. Look-behind isn't needed;
// a simple substring scan captures edge_followed_by.count which is always correct.
const HTML_FOLLOWER_FIELDS: RegExp[] = [
  /"edge_followed_by":\{"count":(\d+)\}/,
  /"follower_count":(\d+)/,
];
const HTML_FOLLOWING_FIELDS: RegExp[] = [
  /"edge_follow":\{"count":(\d+)\}/,
  /"following_count":(\d+)/,
];
const HTML_POSTS_FIELDS: RegExp[] = [
  /"edge_owner_to_timeline_media":\{"count":(\d+)/,
  /"media_count":(\d+)/,
];

function pickNumber(html: string, patterns: RegExp[]): number | undefined {
  for (const re of patterns) {
    const m = html.match(re);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

export function parseInstagramHtml(handle: string, html: string): InstagramProfile | null {
  if (!html || typeof html !== 'string') return null;

  const pick = (re: RegExp) => {
    const m = html.match(re);
    return m ? m[1].trim() : undefined;
  };

  const ogDesc = pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  const ogTitle = pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const ogImage = pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);

  // Try structured JSON first (most accurate when Instagram inlines it)
  const followersFromJson = pickNumber(html, HTML_FOLLOWER_FIELDS);
  const followingFromJson = pickNumber(html, HTML_FOLLOWING_FIELDS);
  const postsFromJson = pickNumber(html, HTML_POSTS_FIELDS);

  if (!ogDesc && !ogTitle && followersFromJson === undefined) return null;

  const profile: InstagramProfile = { handle };

  if (ogTitle) {
    profile.displayName = ogTitle.split('(@')[0].trim() || undefined;
  }

  if (ogDesc) {
    const statsMatch = ogDesc.match(IG_STATS_RE);
    if (statsMatch) {
      profile.followers = parseFollowerCount(statsMatch[1]);
      profile.following = parseFollowerCount(statsMatch[2]);
      profile.posts = parseFollowerCount(statsMatch[3]);
    }
    const bioSplit = ogDesc.split(/\s[-–•]\s/);
    if (bioSplit.length > 1) {
      profile.bio = bioSplit.slice(1).join(' - ').trim();
    } else {
      profile.bio = ogDesc.trim();
    }
  }

  // JSON wins over og:description if both are present — it's the raw count
  if (followersFromJson !== undefined) profile.followers = followersFromJson;
  if (followingFromJson !== undefined) profile.following = followingFromJson;
  if (postsFromJson !== undefined) profile.posts = postsFromJson;

  if (ogImage) profile.profilePicUrl = ogImage;

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

  if (/"is_verified":true/.test(html)) profile.isVerified = true;
  if (/"is_business_account":true/.test(html)) profile.isBusinessAccount = true;

  return profile;
}

// Parses the shape returned by
//   GET https://i.instagram.com/api/v1/users/web_profile_info/?username=<h>
//   with header X-IG-App-ID: 936619743392459
// Response: { data: { user: { edge_followed_by: { count }, ...} } }
export function parseInstagramWebProfileJson(
  handle: string,
  raw: any
): InstagramProfile | null {
  const user = raw?.data?.user;
  if (!user || typeof user !== 'object') return null;
  const profile: InstagramProfile = { handle };
  if (typeof user.full_name === 'string' && user.full_name.trim()) {
    profile.displayName = user.full_name.trim();
  }
  if (typeof user.biography === 'string' && user.biography.trim()) {
    profile.bio = user.biography.trim();
  }
  if (user.edge_followed_by?.count != null) {
    profile.followers = Number(user.edge_followed_by.count);
  }
  if (user.edge_follow?.count != null) {
    profile.following = Number(user.edge_follow.count);
  }
  if (user.edge_owner_to_timeline_media?.count != null) {
    profile.posts = Number(user.edge_owner_to_timeline_media.count);
  }
  if (typeof user.profile_pic_url_hd === 'string') {
    profile.profilePicUrl = user.profile_pic_url_hd;
  } else if (typeof user.profile_pic_url === 'string') {
    profile.profilePicUrl = user.profile_pic_url;
  }
  if (typeof user.external_url === 'string' && user.external_url) {
    profile.externalUrl = user.external_url;
  }
  if (typeof user.category_name === 'string' && user.category_name) {
    profile.category = user.category_name;
  } else if (typeof user.business_category_name === 'string') {
    profile.category = user.business_category_name;
  }
  if (user.is_verified) profile.isVerified = true;
  if (user.is_business_account) profile.isBusinessAccount = true;
  return profile;
}
