import { useSettingsStore } from '@/stores/settings'

export function useTz() {
  const settings = useSettingsStore()

  function fmtDate(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('de-CH', {
      timeZone: settings.timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
    })
  }

  return { fmtDate }
}
