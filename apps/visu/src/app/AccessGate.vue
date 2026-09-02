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
import { reactive } from 'vue';
import { useI18n } from 'vue-i18n';
import { IonItem, IonLabel, IonInput, IonButton, IonNote } from '@ionic/vue';
import { useDeviceStore } from '../core/store';

const { t } = useI18n();
const store = useDeviceStore();

/** Per-page PIN entry buffer, keyed by page id (the panel owns only view input). */
const pins = reactive<Record<string, string>>({});
/** Per-page inline failure flag – a wrong PIN, shown at that item only. */
const failed = reactive<Record<string, boolean>>({});
/** Per-page in-flight guard so a double submit cannot fire two PIN attempts. */
const submitting = reactive<Record<string, boolean>>({});

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
        @submit.prevent="submitPin(gate.pageId)"
      >
        <IonItem
          lines="none"
          class="access-gate-hint"
        >
          <IonLabel>{{ t('access.pinRequiredFor', { page: gate.name }) }}</IonLabel>
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
  /* The shell's page body is an `ion-router-outlet`, which Ionic positions
     `absolute; inset: 0` over `app-shell-body`. As an in-flow sibling the gate
     would be painted UNDER that outlet, so its PIN/login controls would not
     receive clicks (the tile grid intercepts them). Lift the gate onto its own
     layer above the outlet, on a solid ground, so it is actually operable. */
  position: relative;
  z-index: 2;
  padding: 8px 12px;
  background: var(--ion-background-color, #fff);
}

.access-gate-pin {
  padding: 4px 0 8px;
}

/* #1194: a page link that hit the PIN gate points here instead of jumping onto
   the target page. The marker only makes the already-visible gate findable — a
   quiet accent bar, never a red error wall. */
.access-gate-pin.is-pending {
  border-inline-start: 3px solid var(--ion-color-warning, #d6a800);
  padding-inline-start: 9px;
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
