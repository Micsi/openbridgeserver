/**
 * preview/values - die Live-Werte der Vorschau (C4, Issue #171).
 *
 * Der Entwurf beschreibt die STRUKTUR (Seiten, Widgets, Positionen, Seitentyp);
 * die WERTE kommen wie in der echten Visu vom Backend, seitenbezogen
 * (`X-Page-Id`). Autorisiert wird mit der Admin-Session, die per `postMessage`
 * hereinkam.
 *
 * Die Session lebt ausschliesslich in einer Closure des Aufrufers: sie wird
 * nicht persistiert, nicht in eine URL geschrieben und nirgends geloggt. Jeder
 * Fehler bleibt lokal und stumm - eine Vorschau, die einen Datenpunkt nicht
 * lesen darf, zeigt die Struktur ohne Wert statt einer Fehlerwand.
 */

import type { PreviewSession } from './protocol';
import type { PreviewValueBackend } from './PreviewDataSource';

export interface PreviewBackendConfig {
  /** REST-Basis, Vorgabe `/api/v1` (identisch zur Visu). */
  readonly apiBase?: string;
  /** Fuer Tests injizierbar; sonst das globale `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

const DEFAULT_API_BASE = '/api/v1';

/**
 * Ein Backend ueber die REST-Naht des obs-Servers. `getSession` wird bei JEDEM
 * Aufruf gefragt, damit eine spaeter eintreffende Session sofort greift und eine
 * abgelaufene nicht zwischengespeichert bleibt.
 */
export function createHttpValueBackend(
  getSession: () => PreviewSession | null,
  config: PreviewBackendConfig = {},
): PreviewValueBackend {
  const apiBase = config.apiBase ?? DEFAULT_API_BASE;
  const doFetch: typeof fetch = config.fetchImpl ?? ((...args) => globalThis.fetch(...args));

  function headers(pageId: string): Record<string, string> {
    const out: Record<string, string> = { 'Content-Type': 'application/json', 'X-Page-Id': pageId };
    const session = getSession();
    // Der einzige Ort, an dem das Token je das Modul verlaesst: als Header einer
    // Anfrage an den eigenen Server. Nie in der URL, nie im Query-String.
    if (session) out['Authorization'] = `Bearer ${session.accessToken}`;
    return out;
  }

  return {
    async read(datapointIds, pageId): Promise<ReadonlyMap<string, unknown>> {
      const out = new Map<string, unknown>();
      const results = await Promise.all(
        datapointIds.map(async (id) => {
          try {
            const res = await doFetch(`${apiBase}/datapoints/${encodeURIComponent(id)}/value`, {
              headers: headers(pageId),
            });
            if (!res.ok) return null;
            const body = (await res.json()) as { value?: unknown };
            return [id, body.value] as const;
          } catch {
            return null;
          }
        }),
      );
      for (const entry of results) if (entry) out.set(entry[0], entry[1]);
      return out;
    },

    async write(datapointId, value, pageId): Promise<void> {
      try {
        await doFetch(`${apiBase}/datapoints/${encodeURIComponent(datapointId)}/value`, {
          method: 'POST',
          headers: headers(pageId),
          body: JSON.stringify({ value }),
        });
      } catch {
        // Ein fehlgeschlagener Schreibversuch in der Vorschau ist kein Grund,
        // die Vorschau zu beenden; der naechste `list()` korrigiert den Wert.
      }
    },
  };
}
