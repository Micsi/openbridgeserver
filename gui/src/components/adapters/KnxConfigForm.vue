<template>
  <div class="flex flex-col gap-4">

    <!-- Connection Type -->
    <div class="form-group">
      <label class="label">Connection Type</label>
      <select v-model="cfg.connection_type" class="input" @change="onTypeChange">
        <option value="automatic">automatic (GatewayScanner)</option>
        <option value="tunneling">tunneling (UDP)</option>
        <option value="tunneling_tcp">tunneling_tcp (TCP)</option>
        <option value="tunneling_secure">tunneling_secure (TCP+Secure)</option>
        <option value="routing">routing (Multicast)</option>
        <option value="routing_secure">routing_secure (Multicast+Secure)</option>
      </select>
    </div>

    <!-- ── Automatic ─────────────────────────────────────────────────────── -->
    <template v-if="isAutomatic">
      <div class="flex items-start gap-2 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg text-sm text-blue-300">
        <svg class="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        xknx sucht automatisch nach KNX/IP-Interfaces im Netzwerk (GatewayScanner).
      </div>
      <div class="form-group">
        <label class="label">Local IP <span class="text-xs text-slate-400">(Netzwerkinterface einschränken, optional)</span></label>
        <input
          :value="cfg.local_ip ?? ''"
          type="text"
          class="input"
          placeholder="(leer = alle Interfaces)"
          @input="setLocalIp($event.target.value)"
        />
      </div>
    </template>

    <!-- ── Tunneling ──────────────────────────────────────────────────────── -->
    <template v-if="isTunneling">
      <div class="form-group">
        <label class="label">Host <span class="text-xs text-slate-400">(IP des KNX/IP-Interfaces)</span></label>
        <input v-model="cfg.host" type="text" class="input" placeholder="192.168.1.100" @input="emitUpdate" />
      </div>
      <div class="form-group">
        <label class="label">Port</label>
        <input v-model.number="cfg.port" type="number" step="1" class="input" placeholder="3671" @change="emitUpdate" />
      </div>
      <div class="form-group">
        <label class="label">Local IP <span class="text-xs text-slate-400">(optional)</span></label>
        <input
          :value="cfg.local_ip ?? ''"
          type="text"
          class="input"
          placeholder="(leer = nicht gesetzt)"
          @input="setLocalIp($event.target.value)"
        />
      </div>

      <!-- Plain tunneling: individual address here -->
      <div v-if="!isSecure" class="form-group">
        <label class="label">Individual Address</label>
        <input v-model="cfg.individual_address" type="text" class="input" placeholder="1.1.255" @input="emitUpdate" />
      </div>
    </template>

    <!-- ── Routing ────────────────────────────────────────────────────────── -->
    <template v-if="isRouting">
      <div class="form-group">
        <label class="label">Multicast-Gruppe <span class="text-xs text-slate-400">(KNX-Standard: 224.0.23.12)</span></label>
        <input v-model="cfg.multicast_group" type="text" class="input" placeholder="224.0.23.12" @input="emitUpdate" />
      </div>
      <div class="form-group">
        <label class="label">Local IP <span class="text-xs text-slate-400">(Netzwerkinterface für Multicast, optional)</span></label>
        <input
          :value="cfg.local_ip ?? ''"
          type="text"
          class="input"
          placeholder="(leer = nicht gesetzt)"
          @input="setLocalIp($event.target.value)"
        />
      </div>

      <!-- Plain routing: individual address here -->
      <div v-if="!isSecure" class="form-group">
        <label class="label">Individual Address <span class="text-xs text-slate-400">(Quelladresse)</span></label>
        <input v-model="cfg.individual_address" type="text" class="input" placeholder="1.1.255" @input="emitUpdate" />
      </div>
    </template>

    <!-- ── Secure keyfile section ─────────────────────────────────────────── -->
    <template v-if="isSecure">

      <!-- Existing keyfile (edit case) -->
      <div
        v-if="existingKeyfilePath && !uploadResult"
        class="flex flex-col gap-3 p-3 bg-slate-700/40 border border-slate-600 rounded-lg"
      >
        <div class="flex items-center justify-between">
          <span class="text-sm text-slate-300 font-mono truncate">{{ keyfileFilename }}</span>
          <button type="button" class="text-xs text-blue-400 hover:text-blue-300 shrink-0 ml-2" @click="startReupload">Neu hochladen</button>
        </div>
        <p class="text-xs text-slate-400">Keyfile gespeichert. Zum Ändern ein neues hochladen.</p>
        <!-- tunneling_secure: individual address from saved config, still editable -->
        <div v-if="isTunnelSecure" class="form-group">
          <label class="label">Individual Address <span class="text-xs text-slate-400">(aus Keyfile)</span></label>
          <input v-model="cfg.individual_address" type="text" class="input" placeholder="1.1.255" @input="emitUpdate" />
        </div>
      </div>

      <!-- Upload done: show parsed result -->
      <div
        v-else-if="uploadResult"
        class="flex flex-col gap-3 p-3 bg-green-500/10 border border-green-500/30 rounded-lg"
      >
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium text-green-400">{{ uploadResult.project_name }}</span>
          <button type="button" class="text-xs text-slate-400 hover:text-slate-200" @click="clearUpload">Ändern</button>
        </div>

        <!-- tunneling_secure: select tunnel -->
        <template v-if="isTunnelSecure">
          <div v-if="uploadResult.tunnels.length === 0" class="text-sm text-amber-400">
            Keine Tunneling-Interfaces im Keyfile gefunden.
          </div>
          <div v-else class="form-group">
            <label class="label">Tunnel auswählen</label>
            <div class="flex flex-col gap-2">
              <label
                v-for="t in uploadResult.tunnels"
                :key="t.individual_address"
                :class="[
                  'flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-colors select-none',
                  selectedTunnel?.individual_address === t.individual_address
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-slate-600 hover:border-slate-400'
                ]"
              >
                <input type="radio" :value="t" v-model="selectedTunnel" class="sr-only" @change="onTunnelSelected" />
                <div class="grid grid-cols-3 gap-2 text-sm flex-1">
                  <span><span class="text-slate-400">PA: </span>{{ t.individual_address }}</span>
                  <span><span class="text-slate-400">User: </span>{{ t.user_id }}</span>
                  <span><span class="text-slate-400">Secure GAs: </span>{{ t.secure_ga_count }}</span>
                </div>
              </label>
            </div>
          </div>
        </template>

        <!-- routing_secure: backbone info -->
        <template v-else>
          <div v-if="!uploadResult.backbone" class="text-sm text-amber-400">
            Kein Backbone im Keyfile gefunden.
          </div>
          <div v-else class="text-sm text-slate-300">
            Backbone: {{ uploadResult.backbone.multicast_address }}
            · Latenz: {{ uploadResult.backbone.latency_ms }} ms
          </div>
          <div class="form-group">
            <label class="label">Individual Address <span class="text-xs text-slate-400">(Quelladresse des Routers)</span></label>
            <input v-model="cfg.individual_address" type="text" class="input" placeholder="1.1.255" @input="emitUpdate" />
          </div>
        </template>
      </div>

      <!-- Upload form -->
      <div v-else class="flex flex-col gap-3 p-3 bg-slate-800/50 border border-slate-600 rounded-lg">
        <p class="text-sm text-slate-400">ETS-Schlüsselbackup (.knxkeys) hochladen</p>
        <div class="form-group">
          <label class="label">Keyfile</label>
          <input
            ref="fileInputRef"
            type="file"
            accept=".knxkeys"
            class="input text-sm file:mr-3 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-slate-700 file:text-slate-200 hover:file:bg-slate-600"
            @change="onFileSelected"
          />
        </div>
        <div class="form-group">
          <label class="label">Passwort</label>
          <input v-model="uploadPw" type="password" class="input" placeholder="Keyfile-Passwort" @keyup.enter="doUpload" />
        </div>
        <div v-if="uploadError" class="text-xs text-red-400">{{ uploadError }}</div>
        <button
          type="button"
          class="btn-primary btn-sm self-start"
          :disabled="!uploadFile || !uploadPw || uploading"
          @click="doUpload"
        >
          <Spinner v-if="uploading" size="xs" color="white" />
          Hochladen &amp; Parsen
        </button>
      </div>

    </template>

  </div>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue'
import Spinner from '@/components/ui/Spinner.vue'
import { knxKeyfileApi } from '@/api/client.js'

const props = defineProps({
  modelValue: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['update:modelValue'])

// ── Computed ───────────────────────────────────────────────────────────────
const isAutomatic    = computed(() => cfg.connection_type === 'automatic')
const isSecure       = computed(() => ['tunneling_secure', 'routing_secure'].includes(cfg.connection_type))
const isTunneling    = computed(() => ['tunneling', 'tunneling_tcp', 'tunneling_secure'].includes(cfg.connection_type))
const isRouting      = computed(() => ['routing', 'routing_secure'].includes(cfg.connection_type))
const isTunnelSecure = computed(() => cfg.connection_type === 'tunneling_secure')

const existingKeyfilePath = computed(() => cfg.knxkeys_file_path ?? null)
const keyfileFilename     = computed(() => {
  if (!existingKeyfilePath.value) return ''
  return existingKeyfilePath.value.split(/[\\/]/).pop()
})

// ── Local state ────────────────────────────────────────────────────────────
const cfg = reactive({
  connection_type: 'tunneling',
  host: '192.168.1.100',
  port: 3671,
  individual_address: '1.1.255',
  local_ip: null,
  multicast_group: '224.0.23.12',
  multicast_port: 3671,
  user_id: 2,
  knxkeys_file_path: null,
  knxkeys_password: null,
  user_password: null,
  device_authentication_password: null,
  backbone_key: null,
})

const selectedTunnel = ref(null)
const uploadResult   = ref(null)
const uploadFile     = ref(null)
const uploadPw       = ref('')
const uploading      = ref(false)
const uploadError    = ref('')
const fileInputRef   = ref(null)

// ── Init ───────────────────────────────────────────────────────────────────
function applyModelValue(val) {
  for (const k of Object.keys(cfg)) {
    if (k in val && val[k] !== undefined) cfg[k] = val[k]
  }
}

applyModelValue(props.modelValue)

watch(() => props.modelValue, (val) => {
  applyModelValue(val)
}, { deep: true })

// ── Handlers ───────────────────────────────────────────────────────────────
function onTypeChange() {
  if (!isSecure.value) clearUpload()
  emitUpdate()
}

function onFileSelected(e) {
  uploadFile.value = e.target.files[0] ?? null
  uploadError.value = ''
}

async function doUpload() {
  if (!uploadFile.value || !uploadPw.value) return
  uploading.value = true
  uploadError.value = ''
  try {
    const fd = new FormData()
    fd.append('file', uploadFile.value)
    fd.append('password', uploadPw.value)
    const res = await knxKeyfileApi.upload(fd)
    uploadResult.value = res.data
    cfg.knxkeys_file_path = res.data.file_path
    cfg.knxkeys_password = uploadPw.value
    // Auto-select single tunnel
    if (isTunnelSecure.value && res.data.tunnels.length === 1) {
      selectedTunnel.value = res.data.tunnels[0]
      applyTunnel(res.data.tunnels[0])
    }
    // Auto-set multicast for routing_secure
    if (isRouting.value && res.data.backbone?.multicast_address) {
      cfg.multicast_group = res.data.backbone.multicast_address
    }
    emitUpdate()
  } catch (err) {
    uploadError.value = err.response?.data?.detail ?? 'Upload fehlgeschlagen'
  } finally {
    uploading.value = false
  }
}

function clearUpload() {
  uploadResult.value = null
  uploadFile.value = null
  uploadPw.value = ''
  uploadError.value = ''
  selectedTunnel.value = null
  cfg.knxkeys_file_path = null
  cfg.knxkeys_password = null
  cfg.individual_address = '1.1.255'
  cfg.user_id = 2
  if (fileInputRef.value) fileInputRef.value.value = ''
  emitUpdate()
}

function startReupload() {
  uploadResult.value = null
  uploadFile.value = null
  uploadPw.value = ''
  uploadError.value = ''
  if (fileInputRef.value) fileInputRef.value.value = ''
}

function onTunnelSelected() {
  if (selectedTunnel.value) applyTunnel(selectedTunnel.value)
}

function applyTunnel(t) {
  cfg.individual_address = t.individual_address
  cfg.user_id = t.user_id
  emitUpdate()
}

function setLocalIp(val) {
  cfg.local_ip = val === '' ? null : val
  emitUpdate()
}

// ── Emit ───────────────────────────────────────────────────────────────────
function emitUpdate() {
  emit('update:modelValue', { ...cfg })
}
</script>
