// Regression tests for generate-help-index.mjs's pure URL-mapping functions.
// Run via `node --test scripts/` (Node's built-in test runner — no extra
// devDependency needed, matching this package's otherwise-empty test setup).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sep } from 'node:path'

import { localeAndRoutePath, routePartsToUrl } from './generate-help-index.mjs'

test('root locale (de) URLs have no locale prefix', () => {
  const relPath = ['settings', 'general.md'].join(sep)
  const { locale, routeParts } = localeAndRoutePath(relPath)
  assert.equal(locale, 'de')
  assert.equal(routePartsToUrl(routeParts), '/help/settings/general.html')
})

test('en locale URLs keep the /en/ prefix, distinct from the de URL', () => {
  const relPath = ['en', 'settings', 'general.md'].join(sep)
  const { locale, routeParts } = localeAndRoutePath(relPath)
  assert.equal(locale, 'en')
  const url = routePartsToUrl(routeParts)
  assert.equal(url, '/help/en/settings/general.html')

  const deUrl = routePartsToUrl(localeAndRoutePath(['settings', 'general.md'].join(sep)).routeParts)
  assert.notEqual(url, deUrl, 'en and de must resolve to different URLs, or English readers get German content')
})

test('root-level index.md maps to the /help/ root, per locale', () => {
  assert.equal(routePartsToUrl(localeAndRoutePath('index.md').routeParts), '/help/')
  assert.equal(routePartsToUrl(localeAndRoutePath(['en', 'index.md'].join(sep)).routeParts), '/help/en/')
})
