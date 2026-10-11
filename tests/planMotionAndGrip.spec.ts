import { expect, test, type Locator, type Page } from '@playwright/test'

const key = 'workgrid.tasks.v2'
function task(id: string, hour: number | null, duration = 15) {
  const date = new Date(); date.setHours(hour ?? 0, 0, 0, 0)
  return { id, title: id, color: 'blue', duration, start: hour === null ? null : date.toISOString(), createdAt: '2026-10-01T00:00:00Z', status: 'todo', completedAt: null, reminderMinutes: null, remindedAt: null, endReminder: false, endRemindedAt: null, tags: [], deletedAt: null }
}
function plans() {
  const definition = { type: 'countable', totalUnits: 12, unitLabel: '节', deadline: null, notes: '', reminderMinutes: null }
  const plan = { ...task('动画计划', null, 45), planDefinition: definition }
  return [plan, ...Array.from({ length: 12 }, (_, index) => ({ ...task(`课时 ${index + 1}`, null, 45), planAllocation: { planId: plan.id, units: [index + 1] } })), { ...task('后续计划', null, 45), planDefinition: definition }]
}
async function setup(page: Page, tasks: unknown[]) {
  await page.addInitScript(({ key, tasks }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(tasks)) }, { key, tasks })
  await page.goto('/')
}
async function saved(page: Page) { return page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '[]'), key) }
async function settled(panel: Locator) {
  await expect.poll(() => panel.evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0)
}
async function sampleToggle(button: Locator) {
  return button.evaluate(async element => {
    const panel = document.getElementById(element.getAttribute('aria-controls')!)!
    const samples: number[] = [panel.getBoundingClientRect().height]
    ;(element as HTMLElement).click()
    const start = performance.now()
    while (performance.now() - start < 330) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      samples.push(panel.getBoundingClientRect().height)
    }
    return samples
  })
}

test('plan disclosure animates both directions, moves following cards, and disables hidden controls', async ({ page }) => {
  await setup(page, plans())
  const original = await saved(page)
  const card = page.locator('.plan-card', { hasText: '动画计划' })
  const button = card.getByRole('button', { name: '查看待安排方块（12）' })
  const panel = card.locator('.plan-disclosure')
  const next = page.locator('.plan-card', { hasText: '后续计划' })
  const before = (await next.boundingBox())!.y
  const opening = await sampleToggle(button)
  expect(opening[0]).toBe(0)
  expect(opening.at(-1)).toBeCloseTo(360, 0)
  expect(opening.some(value => value > 1 && value < 359)).toBe(true)
  expect((await next.boundingBox())!.y - before).toBeCloseTo(360, 0)
  expect(await panel.evaluate(element => element.inert)).toBe(false)
  const scrollable = card.locator('.plan-parts')
  expect(await scrollable.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
  await scrollable.evaluate(element => { element.scrollTop = 90 })
  const closing = await sampleToggle(button)
  expect(closing[0]).toBeCloseTo(360, 0)
  expect(closing.at(-1)).toBe(0)
  expect(closing.some(value => value > 1 && value < 359)).toBe(true)
  expect(await panel.evaluate(element => element.inert)).toBe(true)
  await expect(card.locator('.task-card').first()).toBeHidden()
  await expect(card.getByRole('button', { name: '编辑 课时 1', exact: true })).toHaveCount(0)
  await button.focus(); await page.keyboard.press('Tab')
  expect(await panel.evaluate(element => element.contains(document.activeElement))).toBe(false)
  await button.click(); await settled(panel)
  expect(await scrollable.evaluate(element => element.scrollTop)).toBe(90)
  expect(await saved(page)).toEqual(original)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('rapid disclosure reversal keeps its current height and reduced motion has no animation', async ({ page }) => {
  await setup(page, plans())
  const card = page.locator('.plan-card', { hasText: '动画计划' })
  const button = card.getByRole('button', { name: '查看待安排方块（12）' })
  const panel = card.locator('.plan-disclosure')
  const geometry = await button.evaluate(async element => {
    const panel = document.getElementById(element.getAttribute('aria-controls')!)!
    ;(element as HTMLElement).click()
    const start = performance.now()
    while (performance.now() - start < 65) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    const before = panel.getBoundingClientRect().height
    ;(element as HTMLElement).click()
    const after = panel.getBoundingClientRect().height
    ;(element as HTMLElement).click()
    return { before, after }
  })
  expect(geometry.before).toBeGreaterThan(0)
  expect(geometry.before).toBeLessThan(360)
  expect(Math.abs(geometry.after - geometry.before)).toBeLessThan(2)
  await settled(panel)
  await expect(button).toHaveAttribute('aria-expanded', 'true')
  await expect(card.locator('.task-card').first()).toBeVisible()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await button.click()
  expect(await panel.evaluate(element => element.getBoundingClientRect().height)).toBe(0)
  await button.click()
  expect(await panel.evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0)
  expect(await panel.evaluate(element => element.getBoundingClientRect().height)).toBeCloseTo(360, 0)
})

for (const focus of [false, true]) {
  test(`short event moves from its dedicated grip without resizing (${focus ? 'focus' : 'default'})`, async ({ page }, testInfo) => {
    const short = task('十五分钟任务', 9)
    const anchor = task('晚间锚点', 22, 60)
    await setup(page, [short, anchor])
    await page.getByRole('group', { name: '日历视图' }).getByRole('button', { name: '日', exact: true }).click()
    if (focus) {
      await page.getByRole('button', { name: '聚焦日程', exact: true }).click()
      await expect(page.locator('.duration-timeline')).toHaveAttribute('aria-busy', 'false')
    }
    const event = page.locator('.calendar-event', { hasText: short.title })
    const grip = event.getByRole('button', { name: `拖动移动 ${short.title}` })
    await event.scrollIntoViewIfNeeded()
    expect((await event.boundingBox())!.height).toBeLessThan(42)
    await expect(event.locator('.resize-handle')).toHaveCount(0)
    await expect(grip).toBeVisible()
    const timeline = page.locator('.duration-timeline')
    const rangeStart = Number(await timeline.getAttribute('data-range-start'))
    const slot = page.locator('.day-track').first().locator('.drop-slot').nth((9 * 60 + 30 - rangeStart) / 15)
    const fromBox = (await grip.boundingBox())!, toBox = (await slot.boundingBox())!
    expect(fromBox.x + fromBox.width).toBeLessThanOrEqual((await event.locator('.event-main').boundingBox())!.x)
    const from = { x: fromBox.x + fromBox.width / 2, y: fromBox.y + fromBox.height / 2 }
    const to = { x: toBox.x + 100, y: toBox.y + toBox.height / 2 }
    const mobile = testInfo.project.name === 'mobile-chromium'
    const touch = async (type: string, point: { x: number; y: number }) => grip.evaluate((element, { type, point }) => {
      const finger = new Touch({ identifier: 1, target: element, clientX: point.x, clientY: point.y })
      const touches = type === 'touchend' ? [] : [finger]
      element.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches, targetTouches: touches, changedTouches: [finger] }))
    }, { type, point })
    if (mobile) { await touch('touchstart', from); for (let i = 1; i <= 12; i++) await touch('touchmove', { x: from.x + (to.x - from.x) * i / 12, y: from.y + (to.y - from.y) * i / 12 }) }
    else { await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 12 }) }
    await expect(page.locator('.drag-overlay')).toHaveCount(1)
    await expect(page.locator('.drag-time-guide')).toBeVisible()
    const time = await page.locator('.drag-time-guide').getAttribute('data-time')
    expect(time).toBe('09:30')
    if (mobile) await touch('touchend', to); else await page.mouse.up()
    await expect.poll(async () => new Date((await saved(page))[0].start).toTimeString().slice(0, 5)).toBe(time)
    expect((await saved(page))[0].duration).toBe(15)
    expect((await saved(page))[1]).toEqual(anchor)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await event.locator('.event-main').click()
    await expect(page.getByRole('dialog', { name: '编辑工作方块' })).toBeVisible()
  })
}

test('resize visibility follows pixel height and the two handles never overlap', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop-only resizing')
  await setup(page, [task('短任务', 9), task('普通任务', 10, 60)])
  const short = page.locator('.calendar-event', { hasText: '短任务' })
  const ordinary = page.locator('.calendar-event', { hasText: '普通任务' })
  await expect(short.locator('.resize-handle')).toHaveCount(0)
  await ordinary.scrollIntoViewIfNeeded(); await ordinary.hover()
  const move = (await ordinary.locator('.event-move-handle').boundingBox())!
  const resize = (await ordinary.locator('.resize-handle').boundingBox())!
  expect(move.x + move.width).toBeLessThanOrEqual(resize.x)
  await page.getByRole('button', { name: '全天总览' }).click()
  await expect(ordinary.locator('.resize-handle')).toHaveCount(0)
  await page.setViewportSize({ width: 1440, height: 1600 })
  await page.getByRole('button', { name: '聚焦日程' }).click()
  await expect(page.locator('.duration-timeline')).toHaveAttribute('aria-busy', 'false')
  expect((await short.boundingBox())!.height).toBeGreaterThanOrEqual(42)
  await expect(short.locator('.resize-handle')).toHaveCount(1)
  await page.getByRole('button', { name: '批量管理' }).click()
  await expect(page.locator('.event-move-handle, .resize-handle')).toHaveCount(0)
})

test('real mouse resizing changes only duration, keeps capture when shrinking, and allows editing afterwards', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop-only resizing')
  const initial = task('真实拉伸任务', 9, 60)
  await setup(page, [initial])
  await page.getByRole('group', { name: '日历视图' }).getByRole('button', { name: '日', exact: true }).click()
  const event = page.locator('.calendar-event')
  await event.scrollIntoViewIfNeeded(); await event.hover()
  const handle = (await event.locator('.resize-handle').boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 - 3 * 22, { steps: 8 })
  await expect(event.locator('.resize-handle')).toHaveCount(1)
  await expect(page.locator('.drag-overlay')).toHaveCount(0)
  await page.mouse.up()
  await expect.poll(async () => (await saved(page))[0].duration).toBe(15)
  expect((await saved(page))[0].start).toBe(initial.start)
  await expect(event.locator('.resize-handle')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await event.locator('.event-main').click()
  await expect(page.getByRole('dialog', { name: '编辑工作方块' })).toBeVisible()
})

test('pointer cancellation or clicking a resize handle does not write data or block later actions', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop-only resizing')
  const initial = task('取消拉伸任务', 9, 60)
  await setup(page, [initial])
  const handle = page.locator('.resize-handle')
  await handle.evaluate(element => {
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', pointerId: 7, button: 0, clientY: 100 }))
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientY: 144 }))
    window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 7 }))
  })
  expect(await saved(page)).toEqual([initial])
  await handle.click()
  expect(await saved(page)).toEqual([initial])
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.locator('.calendar-event .event-main').click()
  await expect(page.getByRole('dialog', { name: '编辑工作方块' })).toBeVisible()
})
