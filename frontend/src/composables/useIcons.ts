import { ref } from 'vue'
import { icons as iconsApi } from '@/api/client'

// Module-level shared state – one fetch for all components
const iconNames = ref<string[]>([])
const svgCache: Record<string, string> = {}
let listPromise: Promise<void> | null = null

export function useIcons() {
  function loadList(): Promise<void> {
    if (listPromise) return listPromise
    listPromise = iconsApi
      .list()
      .then((names) => {
        iconNames.value = names
      })
      .catch(() => {
        // Icons endpoint may require admin auth – treat as empty list in viewer context
        iconNames.value = []
      })
    return listPromise
  }

  async function getSvg(name: string): Promise<string> {
    if (name in svgCache) return svgCache[name]
    try {
      const raw = await iconsApi.getSvg(name)
      // Strip fixed width/height from root <svg> so CSS can control the size
      svgCache[name] = raw.replace(/<svg([^>]*)>/, (_, attrs: string) => {
        const cleaned = attrs
          .replace(/\s+width="[^"]*"/g, '')
          .replace(/\s+height="[^"]*"/g, '')
        return `<svg${cleaned}>`
      })
    } catch {
      svgCache[name] = ''
    }
    return svgCache[name]
  }

  /** Returns true if the icon value refers to an imported SVG icon */
  function isSvgIcon(value: string | null | undefined): value is string {
    return typeof value === 'string' && value.startsWith('svg:')
  }

  /** Extracts the icon name from a `svg:{name}` value */
  function svgIconName(value: string): string {
    return value.slice(4)
  }

  return { iconNames, loadList, getSvg, isSvgIcon, svgIconName }
}
