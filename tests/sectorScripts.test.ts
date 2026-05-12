// tests/sectorScripts.test.ts
import { getSectorTemplate, interpolate } from '../server/templates/sectorScripts';

describe('getSectorTemplate', () => {
  test('exact match for Driving School returns the specialised template', () => {
    const t = getSectorTemplate('Driving School');
    expect(t.painAngle.toLowerCase()).toContain('course fees');
    expect(t.opportunity.toLowerCase()).toContain('tabby');
  });

  test('partial match (Photography Studio) hits photography override', () => {
    const t = getSectorTemplate('Photography Studio');
    expect(t.painAngle.toLowerCase()).toContain('booking deposit');
  });

  test('moving / mover matches', () => {
    expect(getSectorTemplate('Moving Company').painAngle.toLowerCase()).toContain('deposit');
    expect(getSectorTemplate('movers Dubai').painAngle.toLowerCase()).toContain('deposit');
  });

  test('AC repair / electrician / plumber match the technicians template', () => {
    expect(getSectorTemplate('AC Repair').whatsappEn.toLowerCase()).toContain('technician');
    expect(getSectorTemplate('Plumber').whatsappEn.toLowerCase()).toContain('technician');
  });

  test('unknown sector falls back to generic', () => {
    const t = getSectorTemplate('Underwater Basket Weaving');
    expect(t.painAngle.toLowerCase()).toContain('no online payment');
  });

  test('null / empty falls back to generic', () => {
    const t = getSectorTemplate(null);
    expect(t.painAngle).toBeTruthy();
    expect(t.whatsappAr).toContain('السلام عليكم');
  });

  test('every template defines all six fields', () => {
    for (const sector of ['Driving School', 'Moving Company', 'Car Wash', 'Photography', 'Home Cleaning', 'AC Repair', 'Restaurant', 'Salon', 'Clinic', 'Real Estate', 'Unknown']) {
      const t = getSectorTemplate(sector);
      expect(t.painAngle).toBeTruthy();
      expect(t.opportunity).toBeTruthy();
      expect(t.whatsappEn).toBeTruthy();
      expect(t.whatsappAr).toBeTruthy();
      expect(t.emailSubject).toBeTruthy();
      expect(t.emailBody).toBeTruthy();
    }
  });
});

describe('interpolate', () => {
  test('replaces {{businessName}} and {{emirate}} placeholders', () => {
    const out = interpolate('Hi {{businessName}} in {{emirate}}!', {
      businessName: 'Zenith Car Wash',
      emirate: 'Dubai',
    });
    expect(out).toBe('Hi Zenith Car Wash in Dubai!');
  });

  test('leaves unknown placeholders untouched', () => {
    expect(interpolate('Hello {{name}} from {{place}}', { name: 'Maaz' }))
      .toBe('Hello Maaz from {{place}}');
  });

  test('idempotent on empty placeholder set', () => {
    expect(interpolate('no placeholders here', {})).toBe('no placeholders here');
  });
});
