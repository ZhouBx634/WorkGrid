import { expect, test, type Locator, type Page } from '@playwright/test'

const TASKS_KEY = 'workgrid.tasks.v2'
const ZOOM_KEY = 'workgrid.calendarZoom.v1'

function task(id: string, hour: number | null, minutes = 0, duration = 60) {
  const start = new Date()
  start.setHours(hour ?? 0, minutes, 0, 0)
  return { id, title: id, color: 'blue', duration, start: hour === null ? null : start.toISOString(), createdAt: '2026-10-05T00:00:00.000Z', status: 'todo', completedAt: null, reminderMinutes: null, remindedAt: null, endReminder: false, endRemindedAt: null, tags: [], deletedAt: null }
}

async function setup(page: Page, tasks = [task('上午课程', 8, 12, 90), task('晚间日程', 23, 0, 45)]) {
  await page.addInitScript(({ key, value }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value))
  }, { key: TASKS_KEY, value: tasks })
  await page.goto('/')
}

async function height(page: Page) {
  return page.locator('.duration-timeline').evaluate((element) => Number.parseFloat((element as HTMLElement).style.getPropertyValue('--slot-height')))
}

async function saved(page: Page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]'), TASKS_KEY)
}

async function touch(target: Locator, type: 'touchstart' | 'touchmove' | 'touchend', point: { x: number; y: number }) {
  await target.evaluate((element, { type, x, y }) => {
    const finger = new Touch({ identifier: 1, target: element, clientX: x, clientY: y, screenX: x, screenY: y })
    element.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [finger], targetTouches: type === 'touchend' ? [] : [finger], changedTouches: [finger] }))
  }, { type, ...point })
}

test('zoom scales exact-minute events without changing data and persists across reloads', async ({ page }) => {
  await setup(page)
  const original = await saved(page)
  await page.getByRole('button', { name: '缩小日历', exact: true }).click()
  await page.getByRole('button', { name: '缩小日历', exact: true }).click()
  await expect(page.getByLabel('日历缩放比例')).toHaveText('50%')
  expect(await height(page)).toBe(11)
  const event = page.locator('.calendar-event', { hasText: '上午课程' })
  expect(await event.evaluate((element) => Number.parseFloat((element as HTMLElement).style.top))).toBeCloseTo((8 * 60 + 12) / 15 * 11)
  expect(await event.evaluate((element) => Number.parseFloat((element as HTMLElement).style.height))).toBe(66)
  expect(await saved(page)).toEqual(original)
  await page.reload()
  await expect(page.getByLabel('日历缩放比例')).toHaveText('50%')
  expect(await saved(page)).toEqual(original)
  await page.getByRole('button', { name: '恢复默认缩放' }).click()
  await expect(page.getByLabel('日历缩放比例')).toHaveText('100%')
})

test('all-day overview includes midnight to 24:00 and responds to viewport changes in all time views', async ({ page }, testInfo) => {
  await setup(page)
  const original = await saved(page)
  await page.getByRole('button', { name: '全天总览' }).click()
  await expect(page.getByRole('button', { name: '全天总览' })).toHaveAttribute('aria-pressed', 'true')
  await page.locator('.calendar-panel').screenshot({ path: testInfo.outputPath('calendar-overview.png') })
  for (const view of ['周', '日', '今日']) {
    await page.getByRole('button', { name: view, exact: true }).click()
    await expect.poll(() => page.locator('.calendar-surface').evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1)
    expect(await page.locator('.calendar-surface').evaluate((element) => element.scrollTop)).toBe(0)
    await expect(page.locator('.time-rail').getByText('00:00', { exact: true })).toBeVisible()
    await expect(page.locator('.time-rail').getByText('24:00', { exact: true })).toBeVisible()
    const labels = await page.locator('.time-rail span:not([hidden])').evaluateAll((elements) => elements.map((element) => {
      const box = element.getBoundingClientRect()
      return { top: box.top, bottom: box.bottom }
    }))
    for (let index = 1; index < labels.length; index++) expect(labels[index].top).toBeGreaterThanOrEqual(labels[index - 1].bottom)
    const late = await page.locator('.calendar-event', { hasText: '晚间日程' }).boundingBox()
    const surface = await page.locator('.calendar-surface').boundingBox()
    if (!late || !surface) throw new Error('Missing overview layout')
    expect(late.y + late.height).toBeLessThanOrEqual(surface.y + surface.height)
  }
  await page.locator('.calendar-panel').screenshot({ path: testInfo.outputPath('calendar-overview-day.png') })
  const viewport = page.viewportSize()!
  await page.setViewportSize({ width: viewport.width, height: viewport.height - 100 })
  await expect.poll(() => page.locator('.calendar-surface').evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1)
  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
  expect(noOverflow).toBe(true)
  for (const button of await page.getByRole('group', { name: '日历时间轴缩放' }).getByRole('button').all()) {
    const box = await button.boundingBox()
    expect(box?.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
  }
  expect(await saved(page)).toEqual(original)
  await page.reload()
  await expect(page.getByLabel('日历缩放比例')).toHaveText('全天')
})

test('overview keeps short midnight-boundary events inside the timeline', async ({ page }) => {
  await setup(page, [task('午夜任务', 0, 0, 1), task('最后一分钟', 23, 59, 1)])
  await page.getByRole('button', { name: '全天总览' }).click()
  await expect.poll(() => page.locator('.calendar-surface').evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1)
  const bounds = await page.locator('.calendar-surface').boundingBox()
  const last = await page.locator('.calendar-event', { hasText: '最后一分钟' }).boundingBox()
  expect(last!.y + last!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height)
  expect((await saved(page)).find((item: { id: string }) => item.id === '最后一分钟').duration).toBe(1)
})

test('invalid stored zoom uses the default safely', async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, '0'), ZOOM_KEY)
  await setup(page)
  await expect(page.getByLabel('日历缩放比例')).toHaveText('100%')
  expect(await height(page)).toBe(22)
})

test('mobile tap scheduling still uses the selected time in all-day overview', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'Mobile tap scheduling')
  await setup(page, [task('点选任务', null)])
  await page.getByRole('button', { name: '全天总览' }).click()
  await page.locator('.task-card', { hasText: '点选任务' }).tap()
  await page.locator('.day-track').first().locator('.drop-slot').nth(42).tap()
  await expect.poll(async () => new Date((await saved(page))[0].start).toTimeString().slice(0, 5)).toBe('10:30')
})

test('zoom limits, month view, and centered time remain stable', async ({ page }) => {
  await setup(page, [])
  await page.locator('.calendar-surface').evaluate((element) => { element.scrollTop = 600 })
  const center = await page.locator('.calendar-surface').evaluate((element) => (element.scrollTop + (element.clientHeight - 56) / 2) / 22)
  await page.getByRole('button', { name: '缩小日历', exact: true }).click()
  const scaledCenter = await page.locator('.calendar-surface').evaluate((element) => (element.scrollTop + (element.clientHeight - 56) / 2) / 16.5)
  expect(scaledCenter).toBeCloseTo(center, 0)
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: '缩小日历', exact: true }).click()
  await expect(page.getByLabel('日历缩放比例')).toHaveText('25%')
  await expect(page.getByRole('button', { name: '缩小日历', exact: true })).toBeDisabled()
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: '放大日历', exact: true }).click()
  await expect(page.getByLabel('日历缩放比例')).toHaveText('150%')
  await expect(page.getByRole('button', { name: '放大日历', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '月', exact: true }).click()
  await expect(page.getByRole('group', { name: '日历时间轴缩放' })).toHaveCount(0)
  await page.getByRole('button', { name: '周', exact: true }).click()
  await expect(page.getByLabel('日历缩放比例')).toHaveText('150%')
})

for (const zoom of ['50%', '全天', '150%', '聚焦']) {
  test(`dragging at ${zoom} aligns preview, guide, and saved time on desktop and touch`, async ({ page }, testInfo) => {
    await setup(page, [task('拖动任务', null), task('原有日程', 23), ...(zoom === '聚焦' ? [task('上午锚点', 8)] : [])])
    if (zoom === '聚焦') {
      await page.getByRole('button', { name: '聚焦日程' }).click()
      await expect(page.locator('.duration-timeline')).toHaveAttribute('aria-busy', 'false')
    } else if (zoom === '全天') await page.getByRole('button', { name: '全天总览' }).click()
    else for (let i = 0; i < 2; i++) await page.getByRole('button', { name: zoom === '50%' ? '缩小日历' : '放大日历', exact: true }).click()
    const slotHeight = await height(page)
    await page.locator('.calendar-surface').evaluate((element, size) => { element.scrollTop = 38 * size - 100 }, slotHeight)
    const slot = await page.locator('.day-track').first().locator('.drop-slot').nth(38).boundingBox()
    const card = page.locator('.task-card:not(.drag-overlay)', { hasText: '拖动任务' })
    const handle = await card.locator('.drag-handle').boundingBox()
    if (!slot || !handle) throw new Error('Missing drag layout')
    const from = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
    const to = { x: slot.x + slot.width / 2, y: slot.y + slot.height / 2 }
    const mobile = testInfo.project.name === 'mobile-chromium'
    if (mobile) {
      await touch(card, 'touchstart', from)
      for (let i = 1; i <= 12; i++) await touch(card, 'touchmove', { x: from.x + (to.x - from.x) * i / 12, y: from.y + (to.y - from.y) * i / 12 })
    } else {
      await page.mouse.move(from.x, from.y)
      await page.mouse.down()
      await page.mouse.move(to.x, to.y, { steps: 12 })
    }
    const guide = page.locator('.drag-time-guide')
    await expect(guide).toBeVisible()
    const guideTime = await guide.getAttribute('data-time')
    const [hours, minutes] = guideTime!.split(':').map(Number)
    const rangeStart = Number(await page.locator('.duration-timeline').getAttribute('data-range-start'))
    expect(await guide.evaluate((element) => Number.parseFloat((element as HTMLElement).style.top))).toBeCloseTo((hours * 60 + minutes - rangeStart) / 15 * slotHeight)
    await expect.poll(async () => Math.abs((await guide.boundingBox())!.y - (await page.locator('.drag-overlay').boundingBox())!.y)).toBeLessThanOrEqual(3)
    await expect(page.locator('.drag-overlay')).toHaveCount(1)
    await expect(page.getByRole('button', { name: '放大日历', exact: true })).toBeDisabled()
    if (mobile) await touch(card, 'touchend', to)
    else await page.mouse.up()
    await expect(guide).toHaveCount(0)
    await expect.poll(async () => {
      const value = (await saved(page)).find((item: { id: string }) => item.id === '拖动任务')
      return value.start ? new Date(value.start).toTimeString().slice(0, 5) : null
    }).toBe(guideTime)
    expect((await saved(page)).find((item: { id: string }) => item.id === '原有日程')).toEqual(task('原有日程', 23))
  })
}

for (const zoom of ['50%', '全天', '150%', '聚焦']) {
  test(`duration resizing respects usable event height at ${zoom}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Resize handle is desktop-only')
    await setup(page, [task('调整任务', 9)])
    if (zoom === '聚焦') {
      await page.getByRole('button', { name: '聚焦日程' }).click()
      await expect(page.locator('.duration-timeline')).toHaveAttribute('aria-busy', 'false')
    } else if (zoom === '全天') await page.getByRole('button', { name: '全天总览' }).click()
    else for (let i = 0; i < 2; i++) await page.getByRole('button', { name: zoom === '50%' ? '缩小日历' : '放大日历', exact: true }).click()
    const slotHeight = await height(page)
    const handle = page.getByRole('button', { name: '调整时长' })
    await handle.evaluate((element, delta) => {
      const box = element.getBoundingClientRect()
      const clientY = box.y + box.height / 2
      element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse', clientY }))
      window.dispatchEvent(new PointerEvent('pointermove', { clientY: clientY + delta }))
      window.dispatchEvent(new PointerEvent('pointerup', { clientY: clientY + delta }))
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    }, slotHeight)
    await expect.poll(async () => (await saved(page))[0].duration).toBe(75)
    await expect(page.getByRole('dialog', { name: '编辑工作方块' })).toHaveCount(0)
  })
}
