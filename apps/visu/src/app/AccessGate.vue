<script setup lang="ts">
/**
 * app/AccessGate – the dezenter Zugriffs-Hinweis for gated pages (Welle 3b).
 *
 * Behebt Audit-Lücke 2: a PIN-`protected` page rendered forever locked, and a
 * `user`-level page was silently worthless. This panel is the *opt-in* gate the
 * app was missing – never a wall, never a red error:
 *
 *   - **protected** (PIN) → a quiet "PIN erforderlich für …" hint with an inline
 *     PIN field. Submit forwards the PIN to the host store's `authenticatePage()`;
 *     on success the store re-fetches (now-readable/operable devices + re-scoped
 *     live feed) and the recomputed gate list drops this page, so the hint simply
 *     disappears. A wrong PIN shows an INLINE "PIN falsch" note at that item – no
 *     crash, no global banner, guest state untouched.
 *   - **user** (login) → a quiet "Anmeldung erforderlich für …" hint. There is no
 *     inline unlock here: JWT login lives in {@link LoginPanel}. Once logged in the
 *     store re-fetches and the page drops off this list.
 *
 * Golden Rules honoured: reading is never forced (public/readonly pages never
 * appear here – the store's `pageGates` lists only gated pages); no red error
 * wall (dezente Hinweise + inline note only); concealment tolerated (a page the
 * server filtered out never reaches the gate list). The panel owns no device
 * state – auth state and the gate list live in the store; the panel only reads
 * `store.pageGates` and calls `authenticatePage()`. All text is translated (i18n
 * hard gate).
 */
import { computed, nextTick, reactive, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { IonItem, IonLabel, IonInput, IonButton, IonNote } from '@ionic/vue';
import { useDeviceStore } from '../core/store';
import type { PageGate } from '../core/datasource';

const { t } = useI18n();
const store = useDeviceStore();

/**
 * M5 R15 / §2.1: die Ids der gesperrten Seiten, die in die gerade gezeigte Seite
 * INKLUDIERT werden. Für sie ist dieses Panel die Include-Stelle: die PIN gehört
 * sichtbar zu der Seite, die man ansieht, nicht zu einem Seitennamen, den der
 * Nutzer nie aufgerufen hat. Der Host weiss das (er komponiert den Stapel), der
 * Skin könnte es nicht wissen.
 *
 * Gelesen wird `store.shownPageId`, NICHT `currentPageId`: letzteres hält nur,
 * was jemand ausdrücklich angesteuert hat, und ist bis zur ersten Navigation
 * null — die Zuordnung wirkte damit ausgerechnet auf der Startseite nicht, also
 * direkt nach jedem Laden der App. Die gezeigte Seite steht dagegen von Anfang
 * an fest (die erste normale Seite des Baums).
 *
 * Die zweite Hälfte von §2.1 — die Ebene AN ihrem Platz im Stapel als „gesperrt"
 * zeichnen — geht erst mit einer Vertragsergänzung (`PageLayer.locked`, notiert
 * in core/obs/compose): heute kann der Host dem Skin keine gesperrte Ebene
 * übergeben, nur diesen Hinweis daneben stellen.
 */
const includedGates = computed(() => {
  const page = store.shownPageId;
  return new Set(page ? store.gatedIncludesFor(page).map((g) => g.pageId) : []);
});

/**
 * Der Hinweistext über dem PIN-Feld: an der Include-Stelle benennt er die Ebene
 * DIESER Seite, sonst schlicht die Seite, die die PIN verlangt.
 */
function hintFor(gate: PageGate): string {
  return includedGates.value.has(gate.pageId)
    ? t('access.pinRequiredForLayer', { page: gate.name })
    : t('access.pinRequiredFor', { page: gate.name });
}

/** Per-page PIN entry buffer, keyed by page id (the panel owns only view input). */
const pins = reactive<Record<string, string>>({});
/** Per-page inline failure flag – a wrong PIN, shown at that item only. */
const failed = reactive<Record<string, boolean>>({});
/** Per-page in-flight guard so a double submit cannot fire two PIN attempts. */
const submitting = reactive<Record<string, boolean>>({});

/**
 * #1194: a page link that hit the PIN gate points here instead of jumping onto
 * the target page. V1 navigated to the viewer/PIN route, so the gate was
 * unmissable; this panel already sits above the page body, but it can be
 * scrolled out of view — a click would then look like a silent no-op. So when
 * the host reports a pending gate, bring its PIN form into view and put the
 * cursor in the field. That is the PIN path, made visible.
 */
watch(
  () => store.pendingGate,
  async (pageId) => {
    if (!pageId) return;
    await nextTick();
    // Match by dataset rather than by an interpolated attribute selector: a page
    // id is backend data, so it must never be spliced into a selector string
    // (and `CSS.escape` is not everywhere — it is absent under jsdom).
    const form = Array.from(document.querySelectorAll<HTMLElement>('.access-gate-pin')).find(
      (el) => el.dataset.page === pageId,
    );
    if (!form) return;
    // Optional-call: not every environment implements scrollIntoView (jsdom does
    // not); the marker + focus below still make the gate findable without it.
    form.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    // Focus the PIN field itself (IonInput renders a native input inside).
    form.querySelector<HTMLInputElement>('input')?.focus();
  },
);

async function submitPin(pageId: string): Promise<void> {
  if (submitting[pageId]) return;
  submitting[pageId] = true;
  failed[pageId] = false;
  try {
    await store.authenticatePage(pageId, pins[pageId] ?? '');
    // Success: the store re-fetched and this page dropped off `pageGates`, so the
    // item unmounts. Drop the entered PIN from memory in case it lingers.
    pins[pageId] = '';
  } catch {
    // Inline failure only – no crash, no global error, the gate stays.
    failed[pageId] = true;
  } finally {
    submitting[pageId] = false;
  }
}
</script>

<template>
  <div
    v-if="store.pageGates.length > 0"
    class="access-gate"
  >
    <template
      v-for="gate in store.pageGates"
      :key="gate.pageId"
    >
      <!-- protected → PIN prompt (inline). -->
      <form
        v-if="gate.access === 'protected'"
        class="access-gate-pin"
        :class="{ 'is-pending': gate.pageId === store.pendingGate }"
        :data-page="gate.pageId"
        :data-pending="gate.pageId === store.pendingGate ? 'true' : undefined"
        :data-include-of="includedGates.has(gate.pageId) ? store.shownPageId : undefined"
        @submit.prevent="submitPin(gate.pageId)"
      >
        <IonItem
          lines="none"
          class="access-gate-hint"
        >
          <IonLabel>{{ hintFor(gate) }}</IonLabel>
        </IonItem>
        <IonItem>
          <IonInput
            v-model="pins[gate.pageId]"
            type="password"
            inputmode="numeric"
            class="access-gate-input"
            :label="t('access.enterPin')"
            label-placement="stacked"
            autocomplete="off"
          />
        </IonItem>

        <IonNote
          v-if="failed[gate.pageId]"
          color="warning"
          class="access-gate-error"
          role="alert"
        >
          {{ t('access.pinWrong') }}
        </IonNote>

        <IonButton
          type="submit"
          expand="block"
          class="access-gate-unlock"
          :disabled="submitting[gate.pageId]"
        >
          {{ t('access.unlock') }}
        </IonButton>
      </form>

      <!-- user → login-required hint (JWT login lives in LoginPanel). -->
      <IonItem
        v-else
        lines="none"
        class="access-gate-login"
        :data-page="gate.pageId"
      >
        <IonLabel>{{ t('access.loginRequiredFor', { page: gate.name }) }}</IonLabel>
      </IonItem>
    </template>
  </div>
</template>

<style scoped>
/* A quiet hint strip, never a red error wall. */
.access-gate {
  /* The outlet that holds the routed page is a sibling in `app-shell-body` and
     carries Ionic's `z-index: 0`. Keep the gate on its own layer above it so its
     PIN/login controls stay clickable whatever the page paints. (It used to have
     to escape an `absolute; inset: 0` outlet that covered the whole body; the
     outlet is in flow now, but the stacking order is still the gate's to own.) */
  position: relative;
  z-index: 2;
  padding: 8px 12px;
  /* No ground of its own: the shell page carries the ACTIVE skin's surface, and
     the gate sits on it. `--ion-background-color` would be the ionic skin's
     ground — on a terminal page that token no longer resolves, so this painted a
     light strip across the black page: exactly the leak the skin-scoped shell
     root closed. Transparent follows whichever skin is on screen. */
  background: transparent;
}

.access-gate-pin {
  padding: 4px 0 8px;
}

/* #1194: a page link that hit the PIN gate points here instead of jumping onto
   the target page. The marker makes the gate findable once it is scrolled into
   view — a quiet accent, never a red error wall. */
.access-gate-pin.is-pending {
  border-inline-start: 3px solid var(--ion-color-warning, #d6a800);
  padding-inline-start: 9px;
  background: color-mix(in srgb, var(--ion-color-warning, #d6a800) 8%, transparent);
  border-radius: 6px;
}

.access-gate-error {
  display: block;
  padding: 8px 4px 0;
  font-size: 0.85rem;
}

.access-gate-unlock {
  margin-top: 10px;
}
</style>
