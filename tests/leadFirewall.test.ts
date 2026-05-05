// tests/leadFirewall.test.ts — Jest coverage for the lead firewall stack.
// No network, no DB — pure logic tests.

import { describe, test, expect } from '@jest/globals';
import { cleanBusinessName, isBadBusinessName, evaluateLeadFirewall } from '../server/utils/leadFirewall';
import { classifyContent } from '../server/utils/contentClassifier';
import { extractSeedEntity } from '../server/utils/seedEntityExtractor';

// ─── cleanBusinessName ────────────────────────────────────────────────────────

describe('cleanBusinessName', () => {
  test('strips "on Instagram/Facebook/TikTok" suffix', () => {
    expect(cleanBusinessName("Naazme Gifts on Instagram")).toBe('Naazme Gifts');
    expect(cleanBusinessName("Dubai Abaya • on Facebook")).toBe('Dubai Abaya');
  });

  test("strips possessive post suffix", () => {
    expect(cleanBusinessName("Smiley's post")).toBe('Smiley');
    expect(cleanBusinessName("Al Reef’s post")).toBe('Al Reef');
  });

  test('cuts at pipe, bullet, and " - " separators', () => {
    expect(cleanBusinessName('Al Reef Bakery | Best Bread')).toBe('Al Reef Bakery');
    expect(cleanBusinessName('Dubai Flowers • Order Now')).toBe('Dubai Flowers');
    expect(cleanBusinessName('Luxury Abaya - Instagram Shop')).toBe('Luxury Abaya');
  });

  test('strips leading @', () => {
    expect(cleanBusinessName('@quikparcel')).toBe('Quikparcel');
  });

  test('replaces underscores and dots with spaces then title-cases', () => {
    expect(cleanBusinessName('naazme_corporate_gifts')).toBe('Naazme Corporate Gifts');
    expect(cleanBusinessName('al.reef.bakery')).toBe('Al Reef Bakery');
  });

  test('normalises smart-quotes and HTML entities', () => {
    expect(cleanBusinessName('“Luxury Store”')).toBe('"Luxury Store"');
    expect(cleanBusinessName('Tom’s Shop')).toBe("Tom's Shop");
  });

  test('handles empty/null-ish input', () => {
    expect(cleanBusinessName('')).toBe('');
    expect(cleanBusinessName(undefined)).toBe('');
  });
});

// ─── isBadBusinessName ───────────────────────────────────────────────────────

describe('isBadBusinessName', () => {
  test('rejects names shorter than 3 chars', () => {
    expect(isBadBusinessName('AB')).toBe(true);
    expect(isBadBusinessName('x')).toBe(true);
  });

  test('rejects names longer than 80 chars', () => {
    expect(isBadBusinessName('A'.repeat(81))).toBe(true);
  });

  test('rejects phone-only strings', () => {
    expect(isBadBusinessName('+971501234567')).toBe(true);
    expect(isBadBusinessName('0501234567')).toBe(true);
  });

  test('rejects numeric slugs', () => {
    expect(isBadBusinessName('12345')).toBe(true);
    expect(isBadBusinessName('42/')).toBe(true);
  });

  test('rejects generic single-word names', () => {
    expect(isBadBusinessName('home')).toBe(true);
    expect(isBadBusinessName('shop')).toBe(true);
    expect(isBadBusinessName('embed js')).toBe(true);
    expect(isBadBusinessName('khaleejtimes')).toBe(true);
    expect(isBadBusinessName('visa')).toBe(true);
  });

  test('rejects known bad patterns', () => {
    expect(isBadBusinessName('Customs Clearance')).toBe(true);
    expect(isBadBusinessName('Aani Instant Payments')).toBe(true);
    expect(isBadBusinessName('Move towards safe digital payment')).toBe(true);
    expect(isBadBusinessName('Used Car Scams')).toBe(true);
    expect(isBadBusinessName('How should e-commerce work')).toBe(true);
    expect(isBadBusinessName('If you want to order content')).toBe(true);
    expect(isBadBusinessName('Top 10 Shops in Dubai')).toBe(true);
    expect(isBadBusinessName('Best Services Directory')).toBe(true);
    expect(isBadBusinessName('embed.js')).toBe(true);
    expect(isBadBusinessName('Free Zone Company Formation')).toBe(true);
    expect(isBadBusinessName('Partners with MyFatoorah')).toBe(true);
  });

  test('accepts real business names', () => {
    expect(isBadBusinessName('Naazme Corporate Gifts')).toBe(false);
    expect(isBadBusinessName('Al Reef Bakery')).toBe(false);
    expect(isBadBusinessName('Quik Parcel Delivery Services')).toBe(false);
    expect(isBadBusinessName('Luxury Abaya DXB')).toBe(false);
    expect(isBadBusinessName('Dubai Oud')).toBe(false);
  });
});

// ─── classifyContent ─────────────────────────────────────────────────────────

describe('classifyContent', () => {
  test('classifies freezone taxonomy pages', () => {
    expect(classifyContent({
      url: 'https://meydanfz.ae/business-activities-list',
      title: 'Business Activities List',
      snippet: '',
    })).toBe('freezone_taxonomy');

    expect(classifyContent({
      url: 'https://example.com/activities-list',
      title: 'Business activities list',
      snippet: '',
    })).toBe('freezone_taxonomy');
  });

  test('classifies scam warning content', () => {
    expect(classifyContent({
      url: 'https://example.com/news',
      title: '9 Common Used Car Scams',
      snippet: 'These scams deceive buyers losing dh hundreds',
    })).toBe('scam_warning');

    expect(classifyContent({
      url: 'https://example.com/alert',
      title: 'Never return money to scammers',
      snippet: 'Fake manager cheque fraud warning',
    })).toBe('scam_warning');
  });

  test('classifies payment industry / fintech news', () => {
    expect(classifyContent({
      url: 'https://example.com',
      title: 'Visa announces new payment solution',
      snippet: '',
    })).toBe('payment_industry_content');

    expect(classifyContent({
      url: 'https://example.com',
      title: 'AANI Instant Payments UAE launch',
      snippet: 'Move towards safe digital payment',
    })).toBe('payment_industry_content');

    expect(classifyContent({
      url: 'https://example.com',
      title: 'Central Bank of UAE policy',
      snippet: '',
    })).toBe('payment_industry_content');
  });

  test('classifies government registry pages', () => {
    expect(classifyContent({
      url: 'https://investindubai.gov.ae/en/directory',
      title: 'Business Directory',
      snippet: '',
    })).toBe('government_registry');

    expect(classifyContent({
      url: 'https://meydanfz.ae/directory/company/123',
      title: 'Company Profile',
      snippet: '',
    })).toBe('government_registry');
  });

  test('classifies social post URLs', () => {
    expect(classifyContent({
      url: 'https://instagram.com/p/ABC123/',
      title: 'Photo post',
      snippet: '',
    })).toBe('social_post_seed');

    expect(classifyContent({
      url: 'https://instagram.com/reel/XYZ456/',
      title: 'Reel',
      snippet: '',
    })).toBe('social_post_seed');

    expect(classifyContent({
      url: 'https://facebook.com/posts/789',
      title: 'Post',
      snippet: '',
    })).toBe('social_post_seed');
  });

  test('classifies social profile URLs as merchant signals', () => {
    expect(classifyContent({
      url: 'https://instagram.com/luxury_abaya_dxb',
      title: 'Luxury Abaya DXB',
      snippet: '',
    })).toBe('merchant_profile');

    expect(classifyContent({
      url: 'https://tiktok.com/@quikparcel',
      title: 'Quik Parcel',
      snippet: '',
    })).toBe('merchant_profile');
  });

  test('classifies directory and listicle pages as seeds', () => {
    expect(classifyContent({
      url: 'https://example.com',
      title: 'Top 10 Abaya Shops in Dubai',
      snippet: '',
    })).toBe('directory_seed');

    expect(classifyContent({
      url: 'https://example.com',
      title: 'Best delivery services in UAE',
      snippet: 'directory of companies near me',
    })).toBe('directory_seed');
  });

  test('classifies blog/news/how-to as article seeds', () => {
    expect(classifyContent({
      url: 'https://khaleejtimes.com/article',
      title: 'How to start a business in UAE',
      snippet: '',
    })).toBe('article_seed');

    expect(classifyContent({
      url: 'https://example.com',
      title: 'What is cash on delivery',
      snippet: 'guide to understanding cod',
    })).toBe('article_seed');
  });

  test('classifies maps places with placeId or address', () => {
    expect(classifyContent({
      url: 'https://maps.example.com',
      title: 'Al Reef Bakery',
      snippet: '',
      placeId: 'ChIJ1234',
    })).toBe('maps_place');

    expect(classifyContent({
      url: 'https://example.com',
      title: 'Some Shop',
      snippet: '',
      address: 'Sheikh Zayed Rd, Dubai',
    })).toBe('maps_place');
  });

  test('classifies merchant websites by business type terms', () => {
    expect(classifyContent({
      url: 'https://some-restaurant.ae',
      title: 'Al Manara Restaurant LLC',
      snippet: 'Fine dining cafe services',
    })).toBe('merchant_website');

    expect(classifyContent({
      url: 'https://boutique.ae',
      title: 'Luxury Boutique FZE',
      snippet: '',
    })).toBe('merchant_website');
  });

  test('defaults to advertisement_seed for unclassified URLs', () => {
    expect(classifyContent({
      url: 'https://random-page.com',
      title: 'Random thing',
      snippet: '',
    })).toBe('advertisement_seed');
  });
});

// ─── evaluateLeadFirewall ────────────────────────────────────────────────────

describe('evaluateLeadFirewall — hard rejects', () => {
  test('rejects payment_industry_content immediately with score 0', () => {
    const r = evaluateLeadFirewall({
      businessName: 'AANI Instant Payments',
      contentType: 'payment_industry_content',
    });
    expect(r.allowed).toBe(false);
    expect(r.proofScore).toBe(0);
    expect(r.decision).toBe('REJECT');
  });

  test('rejects scam_warning immediately', () => {
    const r = evaluateLeadFirewall({
      businessName: 'Used Car Scams',
      contentType: 'scam_warning',
    });
    expect(r.allowed).toBe(false);
    expect(r.proofScore).toBe(0);
  });

  test('rejects freezone_taxonomy immediately', () => {
    const r = evaluateLeadFirewall({
      businessName: 'Business Activities List',
      contentType: 'freezone_taxonomy',
    });
    expect(r.allowed).toBe(false);
    expect(r.proofScore).toBe(0);
  });

  test('rejects bad business names even with strong content type', () => {
    const r = evaluateLeadFirewall({
      businessName: 'embed.js',
      contentType: 'merchant_website',
      phone: '+971501234567',
    });
    expect(r.allowed).toBe(false);
    expect(r.decision).toBe('REJECT');
  });
});

describe('evaluateLeadFirewall — proof scoring', () => {
  test('maps_place + phone + email exceeds threshold', () => {
    const r = evaluateLeadFirewall({
      businessName: 'Al Reef Bakery',
      contentType: 'maps_place',
      phone: '+971501234567',
      email: 'info@alreef.ae',
      herePlaceId: 'ChIJ1234',
    });
    expect(r.allowed).toBe(true);
    expect(r.proofScore).toBeGreaterThanOrEqual(55);
  });

  test('government_registry alone pushes above threshold', () => {
    const r = evaluateLeadFirewall({
      businessName: 'Deliverit',
      contentType: 'government_registry',
      dulNumber: 'DUL-123456',
    });
    expect(r.allowed).toBe(true);
    expect(r.proofScore).toBeGreaterThanOrEqual(55);
  });

  test('merchant_profile with DUL + phone gets ACCEPT', () => {
    const r = evaluateLeadFirewall({
      businessName: 'Quik Parcel Delivery',
      contentType: 'merchant_profile',
      instagramHandle: 'quikparcel',
      dulNumber: 'DUL-789',
      phone: '+971501234567',
    });
    expect(r.allowed).toBe(true);
    expect(r.decision).toBe('ACCEPT');
    expect(r.proofScore).toBeGreaterThanOrEqual(75);
  });

  test('merchant_website + phone + email + address hits ACCEPT', () => {
    const r = evaluateLeadFirewall({
      businessName: 'Naazme Corporate Gifts LLC',
      contentType: 'merchant_website',
      phone: '+971501234567',
      email: 'info@naazme.ae',
      physicalAddress: '123 Business St, Dubai',
    });
    expect(r.allowed).toBe(true);
    expect(r.decision).toBe('ACCEPT');
    expect(r.proofScore).toBeGreaterThanOrEqual(75);
  });

  test('directory_seed with no extra proof stays rejected', () => {
    const r = evaluateLeadFirewall({
      businessName: 'Best Shops UAE',
      contentType: 'directory_seed',
    });
    expect(r.allowed).toBe(false);
  });

  test('article_seed with only partial info stays rejected', () => {
    const r = evaluateLeadFirewall({
      businessName: 'Some Blog Post',
      contentType: 'article_seed',
      website: 'https://example.com/blog',
    });
    expect(r.allowed).toBe(false);
  });

  test('source agreement: 3+ sources adds 25 pts', () => {
    const withOne = evaluateLeadFirewall({
      businessName: 'Dubai Shop',
      contentType: 'merchant_website',
      website: 'https://shop.ae',
      phone: '+971501234567',
      sourceCount: 1,
    });
    const withThree = evaluateLeadFirewall({
      businessName: 'Dubai Shop',
      contentType: 'merchant_website',
      website: 'https://shop.ae',
      phone: '+971501234567',
      sourceCount: 3,
    });
    expect(withThree.proofScore).toBeGreaterThan(withOne.proofScore);
    expect(withThree.proofScore - withOne.proofScore).toBe(25);
  });

  test('existing gateway subtracts 5 pts', () => {
    const noGateway = evaluateLeadFirewall({
      businessName: 'Dubai Shop',
      contentType: 'merchant_website',
      phone: '+971501234567',
      hasGateway: false,
    });
    const hasGateway = evaluateLeadFirewall({
      businessName: 'Dubai Shop',
      contentType: 'merchant_website',
      phone: '+971501234567',
      hasGateway: true,
    });
    expect(noGateway.proofScore - hasGateway.proofScore).toBe(5);
  });

  test('cleanBusinessName appears in decision output', () => {
    const r = evaluateLeadFirewall({
      businessName: 'luxury_abaya_dxb',
      contentType: 'merchant_profile',
      instagramHandle: 'luxury_abaya_dxb',
      phone: '+971501234567',
    });
    expect(r.cleanBusinessName).toBe('Luxury Abaya Dxb');
  });
});

// ─── extractSeedEntity ───────────────────────────────────────────────────────

describe('extractSeedEntity', () => {
  test('extracts business name from "by X" pattern in title', () => {
    const r = extractSeedEntity({
      title: 'Custom gifts by Naazme Corporate Gifts',
      url: 'https://example.com',
      snippet: '',
    });
    expect(r.possibleBusinessName).toMatch(/Naazme/i);
    expect(r.confidence).toBeGreaterThan(0);
    expect(r.reasons).toContain('business_name_extracted_from_pattern');
  });

  test('extracts business name from "at X" pattern in snippet', () => {
    const r = extractSeedEntity({
      title: 'Order now',
      url: 'https://example.com',
      snippet: 'Available at Quik Parcel Delivery Services in Dubai',
    });
    expect(r.possibleBusinessName).toMatch(/Quik/i);
  });

  test('falls back to clean title when no pattern matches', () => {
    const r = extractSeedEntity({
      title: 'Luxury Abaya DXB',
      url: 'https://instagram.com/luxury_abaya_dxb',
      snippet: '',
    });
    // cleanBusinessName title-cases first letter of each word but keeps existing
    // uppercase letters (DXB stays DXB, not Dxb)
    expect(r.possibleBusinessName).toBe('Luxury Abaya DXB');
    expect(r.reasons).toContain('business_name_from_clean_title');
  });

  test('infers name from Instagram URL when title is bad', () => {
    const r = extractSeedEntity({
      title: 'embed.js', // bad name, rejected
      url: 'https://instagram.com/deliverit_uae',
      snippet: '',
    });
    expect(r.possibleBusinessName).toBe('Deliverit Uae');
    expect(r.reasons).toContain('business_name_from_url');
  });

  test('boosts confidence when phone is present', () => {
    const noPhone = extractSeedEntity({
      title: 'Al Reef Bakery',
      url: 'https://example.com',
      snippet: '',
    });
    const withPhone = extractSeedEntity({
      title: 'Al Reef Bakery',
      url: 'https://example.com',
      snippet: 'Call +971501234567',
    });
    expect(withPhone.confidence).toBeGreaterThan(noPhone.confidence);
    expect(withPhone.possiblePhone).toBeTruthy();
    expect(withPhone.reasons).toContain('phone_extracted');
  });

  test('extracts email and boosts confidence', () => {
    const r = extractSeedEntity({
      title: 'Some Shop',
      url: 'https://example.com',
      snippet: 'Email us at orders@someshop.ae for more info',
    });
    expect(r.possibleEmail).toBe('orders@someshop.ae');
    expect(r.reasons).toContain('email_extracted');
  });

  test('extracts Instagram handle from snippet URL', () => {
    const r = extractSeedEntity({
      title: 'Article about shops',
      url: 'https://news.ae/article',
      snippet: 'Follow them at instagram.com/luxury_abaya_dxb for updates',
    });
    expect(r.possibleInstagramHandle).toBe('luxury_abaya_dxb');
    expect(r.reasons).toContain('instagram_extracted');
  });

  test('confidence is capped at 100', () => {
    const r = extractSeedEntity({
      title: 'at Naazme Gifts',
      url: 'https://naazme.ae',
      snippet: 'Call +971501234567, email info@naazme.ae, instagram.com/naazme_gifts',
    });
    expect(r.confidence).toBeLessThanOrEqual(100);
  });

  test('returns empty business name for fully garbage input', () => {
    // embed.js title is rejected by isBadBusinessName.
    // The numeric-IP URL gives no usable hostname slug either.
    // Confidence may still be > 0 if a website URL is present, but no name is produced.
    const r = extractSeedEntity({
      title: 'embed.js',
      url: 'https://123.456.789.0/embed.js',
      snippet: '',
    });
    expect(r.possibleBusinessName).toBe('');
  });
});
