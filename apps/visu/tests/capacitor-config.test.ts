// @vitest-environment node
// (Dateisystem-Test gegen das Build-Artefakt — kein DOM nötig; unter jsdom ist
//  `import.meta.url` keine file:-URL und `fileURLToPath` schlägt fehl.)

// M4 · Issue #103 — Capacitor-Konfiguration gegen die Realität geprüft.
//
// `webDir` ist die einzige Stelle, an der die native Hülle und der Web-Build
// zusammenkommen. Zeigt sie ins Leere, meldet `cap sync` erst beim ersten
// nativen Build einen Fehler — deshalb wird das Ziel hier aus der echten
// Vite-Konfiguration erhoben und gegen das gebaute Verzeichnis geprüft, statt es
// als Literal zu behaupten.

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { resolveConfig } from 'vite';
import capacitorConfig from '../capacitor.config';

const appRoot = fileURLToPath(new URL('..', import.meta.url));

// Einmal erheben statt pro Test: `resolveConfig` lädt und transpiliert die echte
// vite.config.ts, was auf ausgelasteten Maschinen mehrere Sekunden dauert —
// deshalb der grosszügige Hook-Timeout statt vitests 5s-Default.
let viteOutDir: string;

beforeAll(async () => {
  const config = await resolveConfig({ configFile: resolve(appRoot, 'vite.config.ts'), root: appRoot }, 'build');
  viteOutDir = resolve(appRoot, config.build.outDir);
}, 120_000);

describe('capacitor.config.ts', () => {
  it('trägt die Platzhalter-App-ID und einen App-Namen (U4 offen)', () => {
    expect(capacitorConfig.appId).toBe('com.obs.visu');
    expect(capacitorConfig.appName).toBeTruthy();
  });

  it('zeigt mit webDir auf das Verzeichnis, in das Vite wirklich baut', () => {
    expect(capacitorConfig.webDir, 'capacitor.config.ts ohne webDir').toBeTruthy();
    expect(resolve(appRoot, capacitorConfig.webDir!)).toBe(viteOutDir);
  });

  it('findet unter webDir einen echten Web-Build', () => {
    const entry = resolve(appRoot, capacitorConfig.webDir!, 'index.html');
    expect(existsSync(entry), `webDir enthält keinen Build: ${entry} — vorher \`pnpm build\` laufen lassen`).toBe(true);
  });
});
