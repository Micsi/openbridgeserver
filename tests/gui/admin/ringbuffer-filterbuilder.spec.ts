import { test, expect } from '@playwright/test'
import { apiPost, apiDelete } from '../helpers'

function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`
}

test('FE-02: Gruppenlogik (AND zwischen Gruppen, OR innerhalb Listenfilter)', async ({ page }) => {
  const dpA = await apiPost('/api/v1/datapoints', {
    name: uniqueName('E2E-RB-FE02-A'),
    data_type: 'FLOAT',
    tags: ['fe02'],
  }) as { id: string }
  const dpB = await apiPost('/api/v1/datapoints', {
    name: uniqueName('E2E-RB-FE02-B'),
    data_type: 'FLOAT',
    tags: ['fe02'],
  }) as { id: string }

  try {
    await apiPost(`/api/v1/datapoints/${dpA.id}/value`, { value: 11.0, quality: 'good' })
    await apiPost(`/api/v1/datapoints/${dpB.id}/value`, { value: 22.0, quality: 'good' })

    await page.goto('/ringbuffer')
    await page.waitForLoadState('networkidle')

    await page.click('[data-testid="btn-filterset-new"]')
    await page.fill('[data-testid="input-filterset-name"]', uniqueName('FS-AND-OR'))

    await page.fill('[data-testid="rule-adapters-input-0-0"]', 'api,knx')
    await page.click('[data-testid="btn-filterset-add-group"]')
    await page.fill('[data-testid="rule-datapoints-input-1-0"]', dpA.id)

    await page.click('[data-testid="btn-filterset-save"]')
    await page.click('[data-testid="btn-filterset-apply"]')

    await expect(page.locator(`[data-testid="ringbuffer-entry"][data-dp="${dpA.id}"]`)).toHaveCount(1, { timeout: 12_000 })
    await expect(page.locator(`[data-testid="ringbuffer-entry"][data-dp="${dpB.id}"]`)).toHaveCount(0)
  } finally {
    await apiDelete(`/api/v1/datapoints/${dpA.id}`)
    await apiDelete(`/api/v1/datapoints/${dpB.id}`)
  }
})

test('FE-02: Set aktiv/inaktiv und Regel aktiv/inaktiv', async ({ page }) => {
  const dp = await apiPost('/api/v1/datapoints', {
    name: uniqueName('E2E-RB-FE02-ACTIVE'),
    data_type: 'FLOAT',
    tags: ['fe02-active'],
  }) as { id: string }

  try {
    await apiPost(`/api/v1/datapoints/${dp.id}/value`, { value: 10.0, quality: 'good' })

    await page.goto('/ringbuffer')
    await page.waitForLoadState('networkidle')

    await page.click('[data-testid="btn-filterset-new"]')
    await page.fill('[data-testid="input-filterset-name"]', uniqueName('FS-ACTIVE'))
    await page.fill('[data-testid="base-datapoints-input"]', dp.id)

    await page.fill('[data-testid="rule-datapoints-input-0-0"]', '00000000-0000-0000-0000-000000000000')

    await page.click('[data-testid="btn-filterset-save"]')
    await expect(page.getByText('Filterset gespeichert')).toBeVisible({ timeout: 10_000 })
    await page.click('[data-testid="btn-filterset-apply"]')
    await expect(page.locator('[data-testid="ringbuffer-empty"]')).toBeVisible({ timeout: 10_000 })

    await page.uncheck('[data-testid="rule-active-checkbox-0-0"]')
    await page.click('[data-testid="btn-filterset-save"]')
    await expect(page.getByText('Filterset gespeichert')).toBeVisible({ timeout: 10_000 })
    await page.click('[data-testid="btn-filterset-apply"]')
    await expect(page.locator(`[data-testid="ringbuffer-entry"][data-dp="${dp.id}"]`)).toHaveCount(1, { timeout: 10_000 })

    await page.uncheck('[data-testid="filterset-active-checkbox"]')
    await page.click('[data-testid="btn-filterset-save"]')
    await expect(page.getByText('Filterset gespeichert')).toBeVisible({ timeout: 10_000 })
    await page.click('[data-testid="btn-filterset-apply"]')
    await expect(page.locator('[data-testid="ringbuffer-empty"]')).toBeVisible({ timeout: 10_000 })
  } finally {
    await apiDelete(`/api/v1/datapoints/${dp.id}`)
  }
})

test('FE-02: Vorfilter-Vorschlag aus #355 ohne Autogruppenzwang', async ({ page }) => {
  const dp = await apiPost('/api/v1/datapoints', {
    name: uniqueName('E2E-RB-FE02-PREFILTER'),
    data_type: 'FLOAT',
    tags: ['fe02-prefilter'],
  }) as { id: string }

  const tree = await apiPost('/api/v1/hierarchy/trees', {
    name: uniqueName('FE02-Tree'),
    description: 'E2E',
  }) as { id: string }

  const node = await apiPost('/api/v1/hierarchy/nodes', {
    tree_id: tree.id,
    parent_id: null,
    name: uniqueName('FE02-Node'),
    description: 'E2E',
    order: 0,
  }) as { id: string }

  await apiPost('/api/v1/hierarchy/links', {
    node_id: node.id,
    datapoint_id: dp.id,
  })

  try {
    await apiPost(`/api/v1/datapoints/${dp.id}/value`, { value: 123.0, quality: 'good' })

    await page.goto('/ringbuffer')
    await page.waitForLoadState('networkidle')

    await page.click('[data-testid="btn-filterset-new"]')
    await page.fill('[data-testid="input-filterset-name"]', uniqueName('FS-PREFILTER'))

    await expect(page.locator('[data-testid="filterset-group-card"]')).toHaveCount(1)

    await page.click('[data-testid="btn-open-prefilter-assistant-0-0"]')
    await page.fill('[data-testid="prefilter-tags-input"]', 'fe02-prefilter')
    await page.selectOption('[data-testid="prefilter-node-select"]', node.id)
    await page.click('[data-testid="btn-apply-prefilter-suggestion"]')

    await expect(page.locator('[data-testid="rule-datapoints-input-0-0"]')).toHaveValue(new RegExp(dp.id))
    await expect(page.locator('[data-testid="filterset-group-card"]')).toHaveCount(1)

    await page.click('[data-testid="btn-filterset-save"]')
    await page.click('[data-testid="btn-filterset-apply"]')
    await expect(page.locator(`[data-testid="ringbuffer-entry"][data-dp="${dp.id}"]`)).toHaveCount(1, { timeout: 12_000 })
  } finally {
    await apiDelete(`/api/v1/hierarchy/links?node_id=${encodeURIComponent(node.id)}&datapoint_id=${encodeURIComponent(dp.id)}`)
    await apiDelete(`/api/v1/hierarchy/trees/${tree.id}`)
    await apiDelete(`/api/v1/datapoints/${dp.id}`)
  }
})

test('FE-02: Basis-Query bleibt bei Live-Events wirksam', async ({ page }) => {
  const dpIn = await apiPost('/api/v1/datapoints', {
    name: uniqueName('Waschküche E2E'),
    data_type: 'FLOAT',
    tags: ['fe02-baseq'],
  }) as { id: string }
  const dpOut = await apiPost('/api/v1/datapoints', {
    name: uniqueName('Keller E2E'),
    data_type: 'FLOAT',
    tags: ['fe02-baseq'],
  }) as { id: string }

  try {
    await apiPost(`/api/v1/datapoints/${dpIn.id}/value`, { value: 10.0, quality: 'good' })
    await apiPost(`/api/v1/datapoints/${dpOut.id}/value`, { value: 20.0, quality: 'good' })

    await page.goto('/ringbuffer')
    await page.waitForLoadState('networkidle')

    await page.click('[data-testid="btn-filterset-new"]')
    await page.fill('[data-testid="input-filterset-name"]', uniqueName('FS-BASE-Q'))
    await page.fill('[data-testid="base-datapoints-input"]', dpIn.id)
    await page.click('[data-testid="btn-filterset-save"]')
    await page.click('[data-testid="btn-filterset-apply"]')

    await expect(page.locator(`[data-testid="ringbuffer-entry"][data-dp="${dpIn.id}"]`)).toHaveCount(1, { timeout: 10_000 })
    await expect(page.locator(`[data-testid="ringbuffer-entry"][data-dp="${dpOut.id}"]`)).toHaveCount(0)

    // Live update for an unrelated datapoint must not bypass the active filterset.
    await apiPost(`/api/v1/datapoints/${dpOut.id}/value`, { value: 21.0, quality: 'good' })
    await page.waitForTimeout(1500)
    await expect(page.locator(`[data-testid="ringbuffer-entry"][data-dp="${dpOut.id}"]`)).toHaveCount(0)
  } finally {
    await apiDelete(`/api/v1/datapoints/${dpIn.id}`)
    await apiDelete(`/api/v1/datapoints/${dpOut.id}`)
  }
})
