// Site-side copy of the facts in profile.config.json (kept in sync by test/site.test.mjs).

export const CONFIG = {
  login: 'TimeLordRaps',
  displayName: 'Tyler Roost',
  wordmark: ['TIMELORD', 'RAPS'],
  assetBase: 'https://raw.githubusercontent.com/TimeLordRaps/TimeLordRaps/chronos',
  home: { id: 'home', label: 'SAN DIEGO', tz: 'America/Los_Angeles', lat: 32.7157, lon: -117.1611 },
  taglines: [
    'Independent researcher · systems architect · creative technologist',
    'I build things that shouldn’t exist yet. Then I make them rigorous.',
    'Auditable AI · formal tools · interactive media',
    'Evidence before confidence.',
  ],
  accountCreated: '2023-01-26T23:17:33Z',
};

/** Places the clock can show. `you` is filled in from the browser at start-up. */
export const WORLD = [
  { id: 'home', label: 'SAN DIEGO', tz: 'America/Los_Angeles', lat: 32.7157, lon: -117.1611 },
  { id: 'utc', label: 'UTC', tz: 'UTC', lat: 51.4769, lon: 0 },
  { id: 'tokyo', label: 'TOKYO', tz: 'Asia/Tokyo', lat: 35.6762, lon: 139.6503 },
  { id: 'london', label: 'LONDON', tz: 'Europe/London', lat: 51.5072, lon: -0.1276 },
  { id: 'nyc', label: 'NEW YORK', tz: 'America/New_York', lat: 40.7128, lon: -74.006 },
  { id: 'sydney', label: 'SYDNEY', tz: 'Australia/Sydney', lat: -33.8688, lon: 151.2093 },
  { id: 'delhi', label: 'DELHI', tz: 'Asia/Kolkata', lat: 28.6139, lon: 77.209 },
  { id: 'saopaulo', label: 'SAO PAULO', tz: 'America/Sao_Paulo', lat: -23.5505, lon: -46.6333 },
];
