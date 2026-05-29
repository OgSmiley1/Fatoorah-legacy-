import { parseSerpApiResponse, serpapiSearch, _resetSerpApiQuotaForTests } from '../server/actors/serpapiSearch';
import { parseNominatim, searchNominatim } from '../server/actors/nominatimActor';

describe('Search actor security and parser behavior', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    delete process.env.SERPAPI_KEY;
    delete process.env.SERPAPI_API_KEY;
    delete process.env.HERE_API_KEY;
    _resetSerpApiQuotaForTests();
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('skips SerpApi safely when no API key is configured', async () => {
    await expect(serpapiSearch('coffee dubai')).resolves.toEqual([]);
  });

  it('skips HERE safely when no API key is configured', async () => {
    await expect(searchNominatim({ query: 'coffee dubai' })).resolves.toEqual([]);
  });

  it('parses SerpApi local places before organic results', () => {
    const parsed = parseSerpApiResponse({
      local_results: {
        places: [
          {
            title: 'Houndstooth Coffee',
            type: 'Coffee shop',
            address: '401 Congress Ave. #100c',
            phone: '+1 512 555 0100',
            place_id: '11265938073076301333',
            place_id_search: 'https://serpapi.com/search.json?engine=google&ludocid=11265938073076301333',
            rating: 4.5,
            reviews: 1200,
            gps_coordinates: { latitude: 30.266216, longitude: -97.743065 },
          },
        ],
      },
      organic_results: [
        {
          title: 'Coffee Article',
          link: 'https://example.com/coffee-article',
          snippet: 'Article about coffee',
        },
      ],
    });

    expect(parsed[0].title).toBe('Houndstooth Coffee');
    expect((parsed[0] as any).businessName).toBe('Houndstooth Coffee');
    expect((parsed[0] as any).placeId).toBe('11265938073076301333');
    expect(parsed[1].url).toBe('https://example.com/coffee-article');
  });

  it('parses HERE geocode results without requiring network calls', () => {
    const parsed = parseNominatim({
      items: [
        {
          title: 'Al Reef Bakery',
          resultType: 'place',
          address: {
            label: 'Al Reef Bakery, Dubai, United Arab Emirates',
            city: 'Dubai',
            countryName: 'United Arab Emirates',
            countryCode: 'ARE',
          },
          position: { lat: 25.2048, lng: 55.2708 },
          categories: [{ id: 'restaurant', name: 'Bakery', primary: true }],
          contacts: [{ phone: [{ value: '+971501234567' }], www: [{ value: 'https://alreefbakery.ae' }] }],
        },
      ],
    });

    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('Al Reef Bakery');
    expect(parsed[0].category).toBe('Bakery');
    expect(parsed[0].phone).toBe('+971501234567');
    expect(parsed[0].website).toBe('https://alreefbakery.ae');
  });
});
