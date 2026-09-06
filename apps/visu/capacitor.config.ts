import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor-Hülle der obs Visu (Issue #103, Milestone M4).
 *
 * `appId` und `appName` sind bewusst Platzhalter, bis U4 geklärt ist (Bundle-IDs,
 * Signaturen, Store-Namen — siehe Issue #103 „Risiken / offene Fragen").
 *
 * `webDir` zeigt auf denselben Vite-Build, den auch die PWA ausliefert: iOS,
 * Android und Web laufen damit auf genau einem Code-Stand. Es gibt bewusst KEINE
 * `server.url` — eine eingetragene Live-Reload-/Remote-URL würde die native Hülle
 * auf einen anderen Stand umlenken. Für Live-Reload in der Entwicklung
 * `npx cap run <platform> --live-reload` verwenden; das setzt die URL zur
 * Laufzeit, nicht in dieser Datei.
 *
 * Die iOS-/Android-Feinjustage aus MOBILE_SPEC §4 (contentInset, allowMixedContent,
 * cleartext, SplashScreen) ist hier absichtlich noch nicht gesetzt: sie lässt sich
 * ohne Xcode/Android SDK nicht verifizieren und gehört an den ersten echten
 * nativen Build.
 */
const config: CapacitorConfig = {
  appId: 'com.obs.visu',
  appName: 'obs Visu',
  webDir: 'dist',
};

export default config;
