import { ref } from 'vue'
import { icons as iconsApi } from '@/api/client'

// Module-level shared state – one fetch for all components
const iconNames = ref<string[]>([])
const svgCache: Record<string, string> = {}  // name → normalised SVG string
let listPromise: Promise<void> | null = null
const BLOCKED_URL_SCHEMES = ['javascript:', 'data:', 'http:', 'https:']

function normalizeSvg(raw: string): string {
  // Parse and sanitize untrusted SVG to prevent script execution via v-html.
  const parser = new DOMParser()
  const doc = parser.parseFromString(raw, 'image/svg+xml')
  const root = doc.documentElement

  if (!root || root.tagName.toLowerCase() !== 'svg') return ''

  // Drop executable, externally embeddable, or dynamic mutation content.
  root.querySelectorAll('script,foreignObject,iframe,object,embed,audio,video,animate,set,animateMotion,animateTransform').forEach((el) => el.remove())

  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase()
      const localName = (attr.localName || attr.name).toLowerCase()
      const normalizedValue = attr.value.toLowerCase().replace(/[\u0000-\u0020]+/g, '')

      // Remove event handlers and dangerous URL-bearing attributes.
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name)
        continue
      }
      if ((localName === 'href' || localName === 'src') && BLOCKED_URL_SCHEMES.some((scheme) => normalizedValue.startsWith(scheme))) {
        el.removeAttribute(attr.name)
      }
    }
  }

  // Strip fixed width/height from root <svg> so CSS can control the size
  return root.outerHTML.replace(/<svg([^>]*)>/, (_, attrs: string) => {
    const cleaned = attrs
      .replace(/\s+width="[^"]*"/g, '')
      .replace(/\s+height="[^"]*"/g, '')
    return `<svg${cleaned}>`
  })
}

export function useIcons() {
  function loadList(): Promise<void> {
    if (listPromise) return listPromise
    listPromise = iconsApi
      .list()
      .then(({ icons }) => {
        // Populate cache from the list response (content is already included)
        for (const icon of icons) {
          svgCache[icon.name] = normalizeSvg(icon.content)
        }
        iconNames.value = icons.map((i) => i.name)
      })
      .catch(() => {
        // Icons endpoint requires auth — treat as empty list in unauthenticated context
        listPromise = null  // allow retry after login
        iconNames.value = []
      })
    return listPromise
  }

  async function getSvg(name: string): Promise<string> {
    if (name in svgCache) return svgCache[name]
    // Cache miss — load the full list (which includes content for all icons)
    await loadList()
    return svgCache[name] ?? ''
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
