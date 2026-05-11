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

test('RingBuffer Monitor-Modal öffnet stabil ohne separates Speicher-PopUp', async ({ page }) => {
  await page.route('**/api/v1/ringbuffer/query', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    })
  })
  await page.route('**/api/v1/ringbuffer/filtersets', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    })
  })
  await page.route('**/api/v1/ringbuffer/stats', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        total: 0,
        max_entries: 10000,
        storage: 'file',
        max_file_size_bytes: null,
        max_age: null,
        file_size_bytes: 0,
      }),
    })
  })

  await page.goto('/ringbuffer')
  await page.waitForLoadState('networkidle')
  await page.click('[data-testid="btn-open-monitor-config"]')

  await expect(page.locator('[data-testid="rb-config-max-size-value"]')).toBeVisible()
  await expect(page.locator('[data-testid="rb-config-retention-value"]')).toBeVisible()
  await expect(page.locator('[data-testid="rb-config-stats-total"]')).toContainText('0')
  await expect(page.getByRole('button', { name: /speicher.*popup/i })).toHaveCount(0)
})

test('RingBuffer Monitor-Modal hält Speicher-/Retention-State und sendet Limits korrekt', async ({ page }) => {
  await page.route('**/api/v1/ringbuffer/query', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    })
  })
  await page.route('**/api/v1/ringbuffer/filtersets', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    })
  })
  await page.route('**/api/v1/ringbuffer/stats', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        total: 12,
        max_entries: 10000,
        storage: 'file',
        max_file_size_bytes: 10485760,
        max_age: 86400,
        file_size_bytes: 4096,
      }),
    })
  })

  let postedBody: Record<string, unknown> | null = null
  await page.route('**/api/v1/ringbuffer/config', async (route) => {
    postedBody = route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        total: 12,
        max_entries: 50000,
        storage: 'file',
        max_file_size_bytes: 2147483648,
        max_age: 63072000,
        file_size_bytes: 8192,
      }),
    })
  })

  await page.goto('/ringbuffer')
  await page.waitForLoadState('networkidle')
  await page.click('[data-testid="btn-open-monitor-config"]')

  await page.fill('[data-testid="rb-config-max-size-value"]', '2')
  await page.selectOption('[data-testid="rb-config-max-size-unit"]', 'gb')
  await page.fill('[data-testid="rb-config-retention-value"]', '2')
  await page.selectOption('[data-testid="rb-config-retention-unit"]', 'years')
  await page.fill('[data-testid="rb-config-max-entries"]', '50000')

  await expect(page.locator('[data-testid="rb-config-max-size-value"]')).toHaveValue('2')
  await expect(page.locator('[data-testid="rb-config-retention-value"]')).toHaveValue('2')
  await expect(page.locator('[data-testid="rb-config-max-entries"]')).toHaveValue('50000')

  await page.click('[data-testid="rb-config-save"]')

  await expect.poll(() => postedBody).not.toBeNull()
  expect(postedBody).toEqual({
    storage: 'file',
    max_entries: 50000,
    max_file_size_bytes: 2147483648,
    max_age: 63072000,
  })
})

test('RingBuffer Monitor-Modal Statistik rendert stabil bei leerem und gefülltem Buffer', async ({ page }) => {
  let statsCalls = 0
  await page.route('**/api/v1/ringbuffer/query', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    })
  })
  await page.route('**/api/v1/ringbuffer/filtersets', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    })
  })
  await page.route('**/api/v1/ringbuffer/stats', async (route) => {
    statsCalls += 1
    if (statsCalls === 1) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          total: 0,
          max_entries: 10000,
          storage: 'file',
          max_file_size_bytes: null,
          max_age: null,
          file_size_bytes: 0,
        }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        total: 25,
        max_entries: 10000,
        storage: 'file',
        max_file_size_bytes: 52428800,
        max_age: 172800,
        file_size_bytes: 1048576,
      }),
    })
  })

  await page.goto('/ringbuffer')
  await page.waitForLoadState('networkidle')
  await page.click('[data-testid="btn-open-monitor-config"]')
  await expect(page.locator('[data-testid="rb-config-stats-total"]')).toContainText('0')
  await expect(page.locator('[data-testid="rb-config-stats-file-size"]')).toContainText('0 B')
  await expect(page.locator('[data-testid="rb-config-stats-retention"]')).toContainText('unbegrenzt')

  await page.reload()
  await page.waitForLoadState('networkidle')
  await page.click('[data-testid="btn-open-monitor-config"]')
  await expect(page.locator('[data-testid="rb-config-stats-total"]')).toContainText('25')
  await expect(page.locator('[data-testid="rb-config-stats-file-size"]')).toContainText('1.00 MB')
  await expect(page.locator('[data-testid="rb-config-stats-retention"]')).toContainText('2 Tage')
})
