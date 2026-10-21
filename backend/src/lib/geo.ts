export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_008.8; // mean Earth radius (IUGG)

/** Great-circle distance in metres (haversine). Accurate to well under 1 m at office scale. */
export function haversineM(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface GeofenceResult {
  distanceM: number; // rounded to whole metres
  inside: boolean;
}

export function checkGeofence(point: LatLng, office: LatLng, radiusM: number): GeofenceResult {
  const distanceM = Math.round(haversineM(point, office));
  return { distanceM, inside: distanceM <= radiusM };
}
