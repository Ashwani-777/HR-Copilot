export type Coords = { lat: number; lng: number };

export class LocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocationError';
  }
}

/** Promise wrapper around navigator.geolocation with human messages for each failure mode. */
export function getCurrentCoords(timeoutMs = 12_000): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new LocationError('This browser can’t share your location. Use the office location for the demo.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => {
        const messages: Record<number, string> = {
          1: 'Location access is turned off. Allow it in your browser settings, or use the office location for the demo.',
          2: 'Your location isn’t available right now. Try again in a moment.',
          3: 'Finding your location took too long. Try again.',
        };
        reject(new LocationError(messages[err.code] ?? 'Couldn’t get your location.'));
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    );
  });
}
