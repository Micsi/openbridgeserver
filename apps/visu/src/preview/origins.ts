/**
 * preview/origins - welche Herkuenfte die Vorschau ueberhaupt anspricht (C4).
 *
 * Bewusst KEINE Auswertung von URL/Query: eine Vorschau, die ihren erlaubten
 * Origin aus `?origin=` liest, prueft gar nichts mehr. Die Liste steht zur
 * BAUZEIT fest (`VITE_PREVIEW_ALLOWED_ORIGINS`); ohne Konfiguration gilt der
 * eigene Origin - der Normalfall, weil Admin-GUI und Visu vom selben Server
 * ausgeliefert werden.
 */

/** Die Teile der Bauzeit-Umgebung, die hier gelesen werden. */
export interface PreviewOriginEnv {
  readonly VITE_PREVIEW_ALLOWED_ORIGINS?: string;
}

/** Der Teil von `location`, der hier gelesen wird. */
export interface PreviewOriginLocation {
  readonly origin: string;
}

/**
 * Die erlaubten Herkuenfte, in Konfigurationsreihenfolge. Leere Eintraege
 * fallen heraus; bleibt nichts uebrig, gilt der eigene Origin.
 */
export function allowedPreviewOrigins(
  env: PreviewOriginEnv,
  location: PreviewOriginLocation,
): string[] {
  const configured = (env.VITE_PREVIEW_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return configured.length > 0 ? configured : [location.origin];
}
