<script setup lang="ts">
/**
 * app/LoginPanel - the guest-by-default login entry for the shell menu (Welle L).
 *
 * Gast ist Default: the app reads and operates without a login and this panel
 * never blocks anything - it only offers an *opt-in* JWT login that unlocks
 * per-user RBAC. It lives inside the shell's navigation menu:
 *
 *   - Guest → a single "Anmelden" entry that reveals a username/password form.
 *     Submit forwards the credentials to the host store's `login()` action; on
 *     success the form closes and the store re-fetches (now-writable devices +
 *     re-subscribe). A failure shows an INLINE note at the form - never a rote
 *     Fehler-Wand, never a crash - and the guest state is untouched.
 *   - Logged in → an "Angemeldet als …" indicator plus a "Abmelden" entry that
 *     calls the store's `logout()` (which returns to guest and re-fetches).
 *
 * The panel owns no device state (Goldene Regel): auth state lives in the store;
 * the panel only reads `store.authenticated` / `store.username` and calls the
 * actions. All user-facing text is translated (i18n hard gate).
 */
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { IonItem, IonLabel, IonInput, IonButton, IonNote } from '@ionic/vue';
import { useDeviceStore } from '../core/store';

const { t } = useI18n();
const store = useDeviceStore();

/** Whether the credential form is revealed (guest only). */
const open = ref(false);
const username = ref('');
const password = ref('');
/** Inline failure flag - a wrong credential (or an unsupported source). */
const failed = ref(false);
/** In-flight guard so a double submit cannot fire two logins. */
const submitting = ref(false);

const authenticated = computed(() => store.authenticated);
const displayName = computed(() => store.username);
const indicator = computed(() =>
  displayName.value ? t('auth.signedInAs', { user: displayName.value }) : t('auth.signedIn'),
);

function toggleForm(): void {
  open.value = !open.value;
  failed.value = false;
}

async function submit(): Promise<void> {
  if (submitting.value) return;
  submitting.value = true;
  failed.value = false;
  try {
    await store.login(username.value, password.value);
    // Success: close the form and drop the credentials from memory.
    open.value = false;
    username.value = '';
    password.value = '';
  } catch {
    // Inline failure only - guest stays, no crash, no global error banner.
    failed.value = true;
  } finally {
    submitting.value = false;
  }
}

async function onLogout(): Promise<void> {
  await store.logout();
}
</script>

<template>
  <div class="login-panel">
    <template v-if="authenticated">
      <IonItem
        lines="none"
        class="login-indicator"
      >
        <IonLabel>{{ indicator }}</IonLabel>
      </IonItem>
      <IonItem
        button
        :detail="false"
        class="login-logout"
        @click="onLogout"
      >
        <IonLabel>{{ t('auth.logout') }}</IonLabel>
      </IonItem>
    </template>

    <template v-else>
      <IonItem
        button
        :detail="false"
        class="login-open"
        @click="toggleForm"
      >
        <IonLabel>{{ t('auth.login') }}</IonLabel>
      </IonItem>

      <form
        v-if="open"
        class="login-form"
        @submit.prevent="submit"
      >
        <IonItem>
          <IonInput
            v-model="username"
            class="login-username"
            :label="t('auth.username')"
            label-placement="stacked"
            autocomplete="username"
          />
        </IonItem>
        <IonItem>
          <IonInput
            v-model="password"
            type="password"
            class="login-password"
            :label="t('auth.password')"
            label-placement="stacked"
            autocomplete="current-password"
          />
        </IonItem>

        <IonNote
          v-if="failed"
          color="warning"
          class="login-error"
          role="alert"
        >
          {{ t('auth.failed') }}
        </IonNote>

        <IonButton
          type="submit"
          expand="block"
          class="login-submit"
          :disabled="submitting"
        >
          {{ t('auth.submit') }}
        </IonButton>
      </form>
    </template>
  </div>
</template>

<style scoped>
.login-panel {
  padding: 8px 4px 16px;
}

.login-form {
  padding: 4px 12px 0;
}

/* Inline failure note - a quiet warning at the form, not a rote Fehler-Wand. */
.login-error {
  display: block;
  padding: 8px 4px 0;
  font-size: 0.85rem;
}

.login-submit {
  margin-top: 12px;
}
</style>
