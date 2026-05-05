import { evaluateMerchantTruth, filterSalesReady } from '../server/merchantTruthEngine';

describe('Merchant Truth Engine', () => {
  it('rejects article and guide content', () => {
    const result = evaluateMerchantTruth({
      businessName: 'Customs Clearance in the UAE',
      url: 'https://example.com/blog/customs-clearance',
      snippet: 'Learn about customs clearance procedures in the UAE',
      contentType: 'article',
    });

    expect(result.decision).toBe('REJECT');
    expect(result.isSalesReady).toBe(false);
  });

  it('rejects generic directory seeds without merchant proof', () => {
    const result = evaluateMerchantTruth({
      businessName: 'Best Companies in Dubai',
      url: 'https://example.com/directory',
      snippet: 'Directory of companies in Dubai',
      contentType: 'directory_seed',
    });

    expect(result.decision).toBe('REJECT');
  });

  it('approves a real merchant with multiple proofs and buying signals', () => {
    const result = evaluateMerchantTruth({
      businessName: 'Al Reef Bakery',
      category: 'Bakery / Food Delivery',
      website: 'https://alreefbakery.ae',
      url: 'https://alreefbakery.ae',
      phone: '+971501234567',
      whatsapp: '+971501234567',
      email: 'orders@alreefbakery.ae',
      physicalAddress: 'Dubai, UAE',
      verifiedSources: ['serpapi', 'here-geocoding', 'website'],
      snippet: 'Order on WhatsApp. Same day delivery. Cash on delivery available.',
      isCOD: true,
      hasGateway: false,
      placeId: 'ChIJ1234567890',
    });

    expect(result.decision).toBe('APPROVE');
    expect(result.isSalesReady).toBe(true);
    expect(result.buyingSignals.map(s => s.key)).toEqual(expect.arrayContaining(['whatsapp_order', 'cod']));
    expect(result.salesPlan.bestChannel).toBe('whatsapp');
    expect(result.salesPlan.myFatoorahFit).toContain('Payment Links');
  });

  it('detects booking deposit opportunities', () => {
    const result = evaluateMerchantTruth({
      businessName: 'Luxe Aesthetic Clinic',
      category: 'Aesthetic Clinic',
      website: 'https://luxeclinic.ae',
      phone: '0501234567',
      physicalAddress: 'Jumeirah, Dubai, UAE',
      verifiedSources: ['website', 'here-geocoding'],
      snippet: 'Book appointment now. Deposit required for consultation.',
    });

    expect(result.buyingSignals.map(s => s.key)).toContain('booking_deposit');
    expect(result.salesPlan.myFatoorahFit).toContain('Booking Deposits');
    expect(result.salesPlan.bestChannel).toBe('whatsapp');
  });

  it('filters sales-ready merchants and removes garbage', () => {
    const ready = filterSalesReady([
      {
        businessName: 'How to Start E-commerce UAE',
        url: 'https://example.com/guide',
        snippet: 'A guide about ecommerce',
        contentType: 'article',
      },
      {
        businessName: 'Dubai Perfume House',
        category: 'Luxury perfume oud delivery',
        website: 'https://dubaiperfume.ae',
        phone: '+971551112233',
        physicalAddress: 'Dubai, UAE',
        verifiedSources: ['website', 'here-geocoding', 'serpapi'],
        snippet: 'DM to order. Worldwide shipping. Bank transfer accepted.',
        hasGateway: false,
      },
    ]);

    expect(ready).toHaveLength(1);
    expect(ready[0].businessName).toBe('Dubai Perfume House');
  });
});
