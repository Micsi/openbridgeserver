#!/usr/bin/env node
// Generates help/public/help-index.json from explicit heading anchor IDs
// (`## Heading {#some-help-id}`) found in the Markdown sources under help/.
//
// VitePress passes markdown-it-anchor's explicit-ID syntax through natively —
// `{#some-help-id}` on a heading line becomes that heading's rendered `id`
// attribute — so a help_id IS the heading's HTML anchor id. This script does
// not invent a separate metadata layer; it just indexes those ids so the
// Admin-GUI can resolve a `help_id` prop to a locale-specific help URL
// without knowing VitePress's file layout.
//
// A `help_id` must be assigned deliberately (not derived from heading text)
// because heading text changes with wording fixes and differs per locale —
// an auto-slug would silently break any GUI component referencing it.
//
// Output is written to help/public/help-index.json, which VitePress's
// publicDir passthrough copies verbatim to help_dist/help-index.json — so it
// ships alongside the built site with no separate build step to wire up.
//
// Locale layout must match help/.vitepress/config.mts: everything under
// `en/` is the `en` locale; everything else is the root (`de`) locale. When
// adding a new locale in config.mts, add its directory prefix to LOCALE_DIRS
// below too.

import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HELP_ROOT = fileURLToPath(new URL('..', import.meta.url))
const LOCALE_DIRS = { en: 'en' } // dir prefix -> locale code; anything else → 'de' (root)
const DEFAULT_LOCALE = 'de'
const EXCLUDED_TOP_LEVEL = new Set(['.vitepress', 'public', 'node_modules', 'scripts'])

const HEADING_RE = /^#{1,6}\s+.*\{#([A-Za-z][\w-]*)\}\s*$/gm

function findMarkdownFiles(dir, base = dir) {
  const entries = readdirSync(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (dir === base && EXCLUDED_TOP_LEVEL.has(entry.name)) continue
      files.push(...findMarkdownFiles(full, base))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(full)
    }
  }
  return files
}

export function localeAndRoutePath(relPath) {
  // The locale directory (e.g. `en/`) is only stripped from the URL for the
  // *root* locale — VitePress serves other locales at their own prefixed
  // path (e.g. `/help/en/...`), it does not relocate them to the site root.
  // routeParts therefore keeps the full path for a non-root locale.
  const parts = relPath.split(sep)
  const [maybeLocaleDir] = parts
  if (maybeLocaleDir in LOCALE_DIRS) {
    return { locale: LOCALE_DIRS[maybeLocaleDir], routeParts: parts }
  }
  return { locale: DEFAULT_LOCALE, routeParts: parts }
}

export function routePartsToUrl(routeParts) {
  const withoutExt = routeParts.join('/').replace(/\.md$/, '')
  if (withoutExt === 'index' || withoutExt.endsWith('/index')) {
    const dir = withoutExt.slice(0, withoutExt.length - 'index'.length)
    return `/help/${dir}`
  }
  return `/help/${withoutExt}.html`
}

function extractHelpIds(absPath) {
  const text = readFileSync(absPath, 'utf-8')
  const ids = []
  for (const match of text.matchAll(HEADING_RE)) {
    ids.push(match[1])
  }
  return ids
}

function generate() {
  // Sorted for deterministic output and reproducible duplicate-detection
  // messages — readdir order is not guaranteed across filesystems.
  const files = findMarkdownFiles(HELP_ROOT).sort()
  /** @type {Record<string, Record<string, string>>} */
  const helpIds = {}
  /** @type {Map<string, Set<string>>} locale -> set of help_ids seen in that locale */
  const seenPerLocale = new Map()
  const duplicates = []

  for (const absPath of files) {
    const relPath = relative(HELP_ROOT, absPath)
    const { locale, routeParts } = localeAndRoutePath(relPath)
    const url = routePartsToUrl(routeParts)
    const ids = extractHelpIds(absPath)

    if (!seenPerLocale.has(locale)) seenPerLocale.set(locale, new Set())
    const seen = seenPerLocale.get(locale)

    for (const id of ids) {
      if (seen.has(id)) {
        duplicates.push(`duplicate help_id "${id}" in locale "${locale}" (${relPath})`)
        continue
      }
      seen.add(id)
      helpIds[id] ??= {}
      helpIds[id][locale] = `${url}#${id}`
    }
  }

  if (duplicates.length > 0) {
    console.error('generate-help-index: duplicate help_id(s) found — fix before building:')
    for (const d of duplicates) console.error(`  - ${d}`)
    process.exit(1)
  }

  const allLocales = new Set([DEFAULT_LOCALE, ...Object.values(LOCALE_DIRS)])
  const incomplete = Object.entries(helpIds).filter(
    ([, byLocale]) => allLocales.difference(new Set(Object.keys(byLocale))).size > 0
  )
  if (incomplete.length > 0) {
    console.warn('generate-help-index: help_id(s) missing in at least one locale (non-blocking):')
    for (const [id, byLocale] of incomplete) {
      const missing = [...allLocales].filter((l) => !(l in byLocale))
      console.warn(`  - "${id}" missing in: ${missing.join(', ')}`)
    }
  }

  const outDir = join(HELP_ROOT, 'public')
  mkdirSync(outDir, { recursive: true })
  const outFile = join(outDir, 'help-index.json')
  writeFileSync(
    outFile,
    JSON.stringify({ generatedAt: new Date().toISOString(), helpIds }, null, 2) + '\n'
  )
  console.log(
    `generate-help-index: wrote ${Object.keys(helpIds).length} help_id(s) to ${relative(HELP_ROOT, outFile)}`
  )
}

// Only run when executed directly (`node generate-help-index.mjs`), not when
// imported for unit testing (see generate-help-index.test.mjs).
if (import.meta.url === `file://${process.argv[1]}`) {
  generate()
}
