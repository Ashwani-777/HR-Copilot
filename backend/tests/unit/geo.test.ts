import { describe, expect, it } from 'vitest';
import { checkGeofence, haversineM } from '../../src/lib/geo.js';

const OFFICE = { lat: 28.627, lng: 77.3727 }; // Acme, Noida Sector 62
const metresNorth = (m: number) => ({ lat: OFFICE.lat + m / 111_195, lng: OFFICE.lng });

describe('haversine distance', () => {
  it('is zero for the same point', () => {
    expect(haversineM(OFFICE, OFFICE)).toBe(0);
  });

  it('matches a known distance (Noida Sector 62 → Connaught Place ≈ 15.2 km)', () => {
    const d = haversineM(OFFICE, { lat: 28.6315, lng: 77.2167 });
    expect(d).toBeGreaterThan(15_100);
    expect(d).toBeLessThan(15_350);
  });

  it('one degree of latitude is ~111.2 km', () => {
    expect(haversineM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111_195, -2);
  });
});

describe('geofence', () => {
  it('accepts a check-in 150 m from the office (radius 200 m)', () => {
    const r = checkGeofence(metresNorth(150), OFFICE, 200);
    expect(r.inside).toBe(true);
    expect(r.distanceM).toBeGreaterThanOrEqual(149);
    expect(r.distanceM).toBeLessThanOrEqual(151);
  });

  it('rejects a check-in 250 m away', () => {
    const r = checkGeofence(metresNorth(250), OFFICE, 200);
    expect(r.inside).toBe(false);
    expect(r.distanceM).toBeGreaterThan(200);
  });

  it('treats the boundary as inside', () => {
    expect(checkGeofence(metresNorth(199.6), OFFICE, 200).inside).toBe(true);
  });
});
