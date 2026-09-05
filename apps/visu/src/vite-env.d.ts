/// <reference types="vite/client" />

/**
 * Bauzeit-Konfiguration, die diese App liest. Der Vorschau-Modus (M5 C4, #171)
 * nimmt seine erlaubten Editor-Herkuenfte AUSSCHLIESSLICH von hier - nie aus der
 * URL, sonst waere die Origin-Pruefung der Bruecke keine Pruefung mehr.
 */
interface ImportMetaEnv {
  /** Kommaliste erlaubter Editor-Herkuenfte; leer = der eigene Origin. */
  readonly VITE_PREVIEW_ALLOWED_ORIGINS?: string;
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}
