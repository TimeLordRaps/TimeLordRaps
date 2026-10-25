// Rough coordinates for common IANA zones, so the sky instrument can show a plausible
// sky for the visitor without asking for their location. The browser only tells us a zone
// name; we map that to a city. Nothing here is a lookup of the visitor's IP or GPS.

const T = {
  'America/Los_Angeles': [34.05, -118.24], 'America/Denver': [39.74, -104.99], 'America/Chicago': [41.88, -87.63],
  'America/New_York': [40.71, -74.01], 'America/Phoenix': [33.45, -112.07], 'America/Anchorage': [61.22, -149.9],
  'America/Halifax': [44.65, -63.57], 'America/Toronto': [43.65, -79.38], 'America/Vancouver': [49.28, -123.12],
  'America/Edmonton': [53.55, -113.49], 'America/Winnipeg': [49.9, -97.14], 'America/Mexico_City': [19.43, -99.13],
  'America/Bogota': [4.71, -74.07], 'America/Lima': [-12.05, -77.04], 'America/Santiago': [-33.45, -70.67],
  'America/Sao_Paulo': [-23.55, -46.63], 'America/Argentina/Buenos_Aires': [-34.6, -58.38], 'America/Buenos_Aires': [-34.6, -58.38],
  'America/Caracas': [10.48, -66.9], 'America/Havana': [23.11, -82.37], 'America/Panama': [8.98, -79.52],
  'Pacific/Honolulu': [21.31, -157.86], 'Pacific/Auckland': [-36.85, 174.76], 'Pacific/Fiji': [-18.14, 178.44],
  'Europe/London': [51.51, -0.13], 'Europe/Dublin': [53.35, -6.26], 'Europe/Lisbon': [38.72, -9.14], 'Europe/Madrid': [40.42, -3.7],
  'Europe/Paris': [48.86, 2.35], 'Europe/Berlin': [52.52, 13.4], 'Europe/Rome': [41.9, 12.5], 'Europe/Amsterdam': [52.37, 4.9],
  'Europe/Zurich': [47.37, 8.54], 'Europe/Stockholm': [59.33, 18.07], 'Europe/Warsaw': [52.23, 21.01], 'Europe/Athens': [37.98, 23.73],
  'Europe/Helsinki': [60.17, 24.94], 'Europe/Istanbul': [41.01, 28.98], 'Europe/Moscow': [55.76, 37.62], 'Europe/Kyiv': [50.45, 30.52],
  'Europe/Kiev': [50.45, 30.52], 'Europe/Brussels': [50.85, 4.35], 'Europe/Vienna': [48.21, 16.37], 'Europe/Prague': [50.08, 14.44],
  'Africa/Cairo': [30.04, 31.24], 'Africa/Johannesburg': [-26.2, 28.05], 'Africa/Lagos': [6.52, 3.38], 'Africa/Nairobi': [-1.29, 36.82],
  'Africa/Casablanca': [33.57, -7.59], 'Africa/Accra': [5.6, -0.19], 'Africa/Addis_Ababa': [9.03, 38.74],
  'Asia/Dubai': [25.2, 55.27], 'Asia/Tehran': [35.69, 51.39], 'Asia/Karachi': [24.86, 67.0], 'Asia/Kolkata': [22.57, 88.36],
  'Asia/Calcutta': [22.57, 88.36], 'Asia/Dhaka': [23.81, 90.41], 'Asia/Bangkok': [13.76, 100.5], 'Asia/Jakarta': [-6.21, 106.85],
  'Asia/Singapore': [1.35, 103.82], 'Asia/Hong_Kong': [22.32, 114.17], 'Asia/Shanghai': [31.23, 121.47], 'Asia/Taipei': [25.03, 121.57],
  'Asia/Manila': [14.6, 120.98], 'Asia/Seoul': [37.57, 126.98], 'Asia/Tokyo': [35.68, 139.65], 'Asia/Riyadh': [24.71, 46.68],
  'Asia/Jerusalem': [31.77, 35.22], 'Asia/Kathmandu': [27.72, 85.32], 'Asia/Tashkent': [41.3, 69.24], 'Asia/Almaty': [43.24, 76.89],
  'Asia/Ho_Chi_Minh': [10.82, 106.63], 'Asia/Kuala_Lumpur': [3.14, 101.69],
  'Australia/Sydney': [-33.87, 151.21], 'Australia/Melbourne': [-37.81, 144.96], 'Australia/Brisbane': [-27.47, 153.03],
  'Australia/Perth': [-31.95, 115.86], 'Australia/Adelaide': [-34.93, 138.6],
  UTC: [51.48, 0], 'Etc/UTC': [51.48, 0],
};

/** @returns {{lat:number, lon:number, exact:boolean}} exact = a known city for this zone */
export function placeForZone(tz, offsetMinutes = 0) {
  const hit = T[tz];
  if (hit) return { lat: hit[0], lon: hit[1], exact: true };
  return { lat: 35, lon: (offsetMinutes / 60) * 15, exact: false };
}
