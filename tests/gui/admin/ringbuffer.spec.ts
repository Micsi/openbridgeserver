import { test, expect } from '@playwright/test'
import { apiPost, apiDelete } from '../helpers'

test('RingBuffer Live-Eintrag ohne Reload', async ({ page }) => {
  // Fixture: create a DataPoint
  const created = await apiPost('/api/v1/datapoints', {
    name: `E2E-RB-${Date.now()}`,
    data_type: 'FLOAT',
    tags: [],
  }) as { id: string }
  const dpId = created.id

  try {
    await page.goto('/ringbuffer')
    await page.waitForLoadState('networkidle')

    // Status badge must say "Live"
    await expect(page.locator('[data-testid="status-badge"]')).toContainText('Live', { timeout: 8_000 })

    // Filter by our DataPoint ID so the view only shows entries for this DP.
    // This avoids the 500-entry cap making before == after when the buffer is full.
    await page.fill('[data-testid="input-filter"]', dpId)
    await page.waitForTimeout(500) // debounce ~350 ms + server round-trip

    // Before the push, no entries for this brand-new DP should exist
    const before = await page.locator(`[data-testid="ringbuffer-entry"][data-dp="${dpId}"]`).count()

    // Push a value via API — server broadcasts ringbuffer_entry via WS
    await apiPost(`/api/v1/datapoints/${dpId}/value`, { value: 42.0, quality: 'good' })

    // The WS push must add the new row within 15 s (CI environments can be slow)
    await expect(page.locator(`[data-testid="ringbuffer-entry"][data-dp="${dpId}"]`))
      .toHaveCount(before + 1, { timeout: 15_000 })
  } finally {
    await apiDelete(`/api/v1/datapoints/${dpId}`)
  }
})

test('RingBuffer Pause/Resume stoppt Live-Append und holt Queue nach', async ({ page }) => {
  const created = await apiPost('/api/v1/datapoints', {
    name: `E2E-RB-Pause-${Date.now()}`,
    data_type: 'FLOAT',
    tags: [],
  }) as { id: string }
  const dpId = created.id

  try {
    await page.goto('/ringbuffer')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('[data-testid="status-badge"]')).toContainText('Live', { timeout: 8_000 })

    await page.fill('[data-testid="input-filter"]', dpId)
    await page.waitForTimeout(500)

    const rows = page.locator(`[data-testid="ringbuffer-entry"][data-dp="${dpId}"]`)
    await expect(rows).toHaveCount(0)

    await page.click('[data-testid="btn-live-pause"]')
    await expect(page.locator('[data-testid="live-mode-badge"]')).toContainText('Pausiert')

    await apiPost(`/api/v1/datapoints/${dpId}/value`, { value: 1.0, quality: 'good' })
    await apiPost(`/api/v1/datapoints/${dpId}/value`, { value: 2.0, quality: 'good' })
    await page.waitForTimeout(800)

    await expect(rows).toHaveCount(0)

    await page.click('[data-testid="btn-live-resume"]')
    await expect(page.locator('[data-testid="live-mode-badge"]')).toContainText('Live')
    await expect(rows).toHaveCount(2, { timeout: 12_000 })
  } finally {
    await apiDelete(`/api/v1/datapoints/${dpId}`)
  }
})

test('RingBuffer Auto-Scroll folgt Live, bleibt stabil bei Pause', async ({ page }) => {
  const created = await apiPost('/api/v1/datapoints', {
    name: `E2E-RB-Scroll-${Date.now()}`,
    data_type: 'FLOAT',
    tags: [],
  }) as { id: string }
  const dpId = created.id

  try {
    await page.goto('/ringbuffer')
    await page.waitForLoadState('networkidle')
    await page.fill('[data-testid="input-filter"]', dpId)
    await page.waitForTimeout(500)

    for (let i = 0; i < 45; i += 1) {
      await apiPost(`/api/v1/datapoints/${dpId}/value`, { value: i, quality: 'good' })
    }
    await page.click('[data-testid="btn-refresh-ringbuffer"]')
    await expect(page.locator(`[data-testid="ringbuffer-entry"][data-dp="${dpId}"]`)).toHaveCount(45, { timeout: 12_000 })

    const wrap = page.locator('[data-testid="ringbuffer-table-wrap"]')
    await wrap.evaluate((el) => { (el as HTMLElement).scrollTop = 500 })
    const beforeLivePush = await wrap.evaluate((el) => (el as HTMLElement).scrollTop)
    expect(beforeLivePush).toBeGreaterThan(0)

    await apiPost(`/api/v1/datapoints/${dpId}/value`, { value: 999, quality: 'good' })
    await expect.poll(async () => wrap.evaluate((el) => (el as HTMLElement).scrollTop), { timeout: 8_000 }).toBe(0)

    await page.click('[data-testid="btn-live-pause"]')
    await wrap.evaluate((el) => { (el as HTMLElement).scrollTop = 500 })
    const beforePausedPush = await wrap.evaluate((el) => (el as HTMLElement).scrollTop)
    expect(beforePausedPush).toBeGreaterThan(0)

    await apiPost(`/api/v1/datapoints/${dpId}/value`, { value: 1000, quality: 'good' })
    await page.waitForTimeout(800)
    const afterPausedPush = await wrap.evaluate((el) => (el as HTMLElement).scrollTop)
    expect(afterPausedPush).toBeGreaterThan(0)
  } finally {
    await apiDelete(`/api/v1/datapoints/${dpId}`)
  }
})

test('RingBuffer Zeitfilter unterstützt offene Ränder und absolute/relative Kombination', async ({ page }) => {
  const created = await apiPost('/api/v1/datapoints', {
    name: `E2E-RB-Time-${Date.now()}`,
    data_type: 'FLOAT',
    tags: [],
  }) as { id: string }
  const dpId = created.id

  try {
    await page.goto('/ringbuffer')
    await page.waitForLoadState('networkidle')
    await page.fill('[data-testid="input-filter"]', dpId)
    await page.waitForTimeout(500)

    await apiPost(`/api/v1/datapoints/${dpId}/value`, { value: 10.0, quality: 'good' })
    await page.waitForTimeout(150)
    await apiPost(`/api/v1/datapoints/${dpId}/value`, { value: 11.0, quality: 'good' })
    await page.click('[data-testid="btn-refresh-ringbuffer"]')
    await expect(page.locator(`[data-testid="ringbuffer-entry"][data-dp="${dpId}"]`)).toHaveCount(2, { timeout: 10_000 })

    await page.fill('[data-testid="time-from-relative-seconds"]', '-30')
    await page.click('[data-testid="btn-apply-ringbuffer-filters"]')
    await expect(page.locator(`[data-testid="ringbuffer-entry"][data-dp="${dpId}"]`)).toHaveCount(2, { timeout: 10_000 })

    const future = new Date(Date.now() + 2 * 60 * 1000)
    const localFuture = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}T${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`
    await page.fill('[data-testid="time-from-absolute"]', localFuture)
    await page.click('[data-testid="btn-apply-ringbuffer-filters"]')
    await expect(page.locator('[data-testid="ringbuffer-empty"]')).toBeVisible({ timeout: 10_000 })

    await page.fill('[data-testid="time-from-absolute"]', '')
    await page.click('[data-testid="btn-apply-ringbuffer-filters"]')
    await expect(page.locator(`[data-testid="ringbuffer-entry"][data-dp="${dpId}"]`)).toHaveCount(2, { timeout: 10_000 })
  } finally {
    await apiDelete(`/api/v1/datapoints/${dpId}`)
  }
})
