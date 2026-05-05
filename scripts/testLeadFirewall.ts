import { classifyContent } from '../server/utils/contentClassifier';
import { evaluateLeadFirewall } from '../server/utils/leadFirewall';
import { extractSeedEntity } from '../server/utils/seedEntityExtractor';

const testCases = [
  // Bad examples that should be REJECTED
  {
    name: 'Article: Customs Clearance',
    input: {
      title: 'Customs Clearance in the UAE',
      url: 'https://example.com/blog/customs-clearance',
      snippet: 'Learn about customs clearance procedures in the UAE',
    },
    shouldAllow: false,
  },
  {
    name: 'Payment News: Aani Instant Payments',
    input: {
      title: 'Aani Instant Payments Launches',
      url: 'https://example.com/news/aani',
      snippet: 'AANI instant payments launch with Visa support',
    },
    shouldAllow: false,
  },
  {
    name: 'Payment Industry: Safe Digital Payment',
    input: {
      title: 'Move Towards Safe Digital Payment',
      url: 'https://example.com/news/payment-safety',
      snippet: 'Move towards safe digital payment with banks',
    },
    shouldAllow: false,
  },
  {
    name: 'Scam Warning: Used Car Scams',
    input: {
      title: '9 Common Used Car Scams',
      url: 'https://example.com/guide/car-scams',
      snippet: 'These scams deceive people losing dh hundreds',
    },
    shouldAllow: false,
  },
  {
    name: 'Scam Warning: Never Return Money',
    input: {
      title: 'How to Protect Your Personal',
      url: 'https://example.com/scam-alert',
      snippet: 'Never return money if you are scammed',
    },
    shouldAllow: false,
  },
  {
    name: 'Bad Name: How Should E',
    input: {
      title: 'How should e-commerce work',
      url: 'https://example.com/article',
      snippet: 'How should e-commerce work in 2024',
    },
    shouldAllow: false,
  },
  {
    name: 'Bad Name: If You Want To Order',
    input: {
      title: 'If you want to order content on WhatsApp',
      url: 'https://example.com/guide',
      snippet: 'If you want to order content on WhatsApp',
    },
    shouldAllow: false,
  },
  {
    name: 'Bad Name: Embed.js',
    input: {
      title: 'embed.js',
      url: 'https://example.com/embed.js',
      snippet: 'JavaScript library',
    },
    shouldAllow: false,
  },
  {
    name: 'Generic Name: Khaleejtimes',
    input: {
      title: 'khaleejtimes',
      url: 'https://khaleejtimes.com',
      snippet: 'News about Dubai',
    },
    shouldAllow: false,
  },
  {
    name: 'Directory Seed: Best Companies',
    input: {
      title: 'Best Companies in Dubai',
      url: 'https://example.com/directory',
      snippet: 'Directory of companies',
      contentType: 'directory_seed',
    },
    shouldAllow: false, // seeds need extra proof
  },
  // Good examples that should be ACCEPTED or REVIEWED
  {
    name: 'Real Merchant: Website with Phone + Email + Address',
    input: {
      title: 'Naazme Corporate Gifts LLC',
      url: 'https://naazme.ae',
      snippet: 'Corporate gifts and merchandise',
      contentType: 'merchant_website',
      phone: '+971501234567',
      email: 'info@naazme.ae',
      address: '123 Business St, Dubai, UAE',
    },
    shouldAllow: true,
  },
  {
    name: 'Real Merchant: Instagram Profile with DUL',
    input: {
      title: 'Quik Parcel Delivery Services',
      url: 'https://instagram.com/quikparcel',
      snippet: 'Fast parcel delivery in Dubai',
      contentType: 'merchant_profile',
      instagramHandle: 'quikparcel',
      dulNumber: '123456',
      phone: '+971501234567',
    },
    shouldAllow: true, // social profile + DUL + phone is strong
  },
  {
    name: 'Real Merchant: Government Registry',
    input: {
      title: 'Deliverit',
      url: 'https://investindubai.gov.ae/business/deliverit',
      snippet: 'Delivery services company',
      contentType: 'government_registry',
      phone: '+971501234567',
    },
    shouldAllow: true, // government_registry is strong signal
  },
  {
    name: 'Real Merchant: Maps Place',
    input: {
      title: 'Al Reef Bakery',
      url: 'https://maps.google.com/place/al-reef',
      snippet: 'Bakery in Dubai',
      contentType: 'maps_place',
      placeId: 'ChIJ1234567890',
      phone: '+971501234567',
      address: 'Dubai, UAE',
    },
    shouldAllow: true, // maps_place is strong signal
  },
];

function runTests() {
  console.log('🧪 Lead Firewall Test Suite\n');

  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    const contentType =
      (testCase.input as any).contentType ||
      classifyContent(testCase.input);

    const decision = evaluateLeadFirewall({
      businessName: testCase.input.title,
      title: testCase.input.title,
      url: testCase.input.url,
      snippet: testCase.input.snippet,
      contentType,
      phone: (testCase.input as any).phone,
      email: (testCase.input as any).email,
      instagramHandle: (testCase.input as any).instagramHandle,
      facebookUrl: (testCase.input as any).facebookUrl,
      tiktokHandle: (testCase.input as any).tiktokHandle,
      linkedinUrl: (testCase.input as any).linkedinUrl,
      website: (testCase.input as any).website,
      physicalAddress: (testCase.input as any).address,
      herePlaceId: (testCase.input as any).placeId,
      mapsPlaceId: (testCase.input as any).placeId,
      dulNumber: (testCase.input as any).dulNumber,
      sourceCount: (testCase.input as any).sourceCount || 1,
      evidence: [],
      hasGateway: false,
      isCOD: false,
      extractionMode: 'direct_merchant',
    });

    const passed_test = decision.allowed === testCase.shouldAllow;

    if (passed_test) {
      console.log(`✅ ${testCase.name}`);
      console.log(`   Content: ${contentType} | Decision: ${decision.decision} | Score: ${decision.proofScore}`);
      passed++;
    } else {
      console.log(`❌ ${testCase.name}`);
      console.log(`   Expected: ${testCase.shouldAllow ? 'ALLOW' : 'REJECT'}`);
      console.log(`   Got: ${decision.allowed ? 'ALLOW' : 'REJECT'}`);
      console.log(`   Content: ${contentType} | Decision: ${decision.decision} | Score: ${decision.proofScore}`);
      console.log(`   Reasons: ${decision.reasons.join(', ')}`);
      failed++;
    }
    console.log();
  }

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${testCases.length}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
