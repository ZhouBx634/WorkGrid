import { expect, test, type Page } from '@playwright/test'

const key = 'workgrid.tasks.v2'
const ordinary = { id: 'unrelated', title: '原有日程保持不变', color: 'blue', duration: 60, start: null, createdAt: '2026-10-01T00:00:00.000Z', status: 'todo', completedAt: null, reminderMinutes: null, remindedAt: null, endReminder: false, endRemindedAt: null, tags: [], deletedAt: null }
const definition = { type: 'countable', totalUnits: 3, unitLabel: '节', deadline: null, notes: '', reminderMinutes: null }
const plan = (id: string) => ({ ...ordinary, id, title: `计划 ${id}`, planDefinition: { ...definition } })
const plans = [plan('A'), plan('B'), plan('C')]
const localTime = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
async function seed(page: Page, tasks: unknown[]) {
  await page.addInitScript(({ key, tasks }) => {
    if (!localStorage.getItem('improvement-test-seeded')) {
      localStorage.setItem(key, JSON.stringify(tasks)); localStorage.setItem('improvement-test-seeded', '1')
    }
  }, { key, tasks })
}
async function saved(page: Page) { return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]'), key) }
async function order(page: Page) { return page.locator('.plan-list > .plan-card').evaluateAll((cards) => cards.map((card) => card.getAttribute('data-plan-id'))) }

test('focused short overlapping cards keep visible title pixels outside their controls', async ({ page }) => {
  const date = new Date(); date.setHours(9, 0, 0, 0)
  const late = new Date(date); late.setHours(21, 0, 0, 0)
  const scheduled = [0, 1].map((i) => ({ ...ordinary, id: `focused-${i}`, title: `聚焦并排课程${i}`, duration: 45, start: date.toISOString() }))
  await seed(page, [...scheduled, { ...ordinary, id: 'late', title: '晚上课程', duration: 60, start: late.toISOString() }]); await page.goto('/')
  await page.getByRole('button', { name: '聚焦日程' }).click()
  await expect(page.locator('.duration-timeline')).toHaveAttribute('aria-busy', 'false')
  for (const card of await page.locator('.calendar-event[data-lanes="2"]').all()) {
    await expect(card).toHaveClass(/is-compact/)
    const visible = await card.evaluate((node) => {
      const title = node.querySelector('strong')!
      const range = document.createRange(); range.setStart(title.firstChild!, 0); range.setEnd(title.firstChild!, 2)
      const text = range.getBoundingClientRect(), outer = node.getBoundingClientRect()
      return text.width >= 16 && text.x >= outer.x && text.right <= outer.right && text.y >= outer.y && text.bottom <= outer.bottom
    })
    expect(visible).toBe(true)
  }
  expect(await saved(page)).toEqual([...scheduled, { ...ordinary, id: 'late', title: '晚上课程', duration: 60, start: late.toISOString() }])
})

test('one, two, and three overlapping events use readable titles and preserve their editing controls', async ({ page }, testInfo) => {
  const date = new Date(); date.setHours(10, 12, 0, 0)
  const title = '高等数学网课第三章微分中值定理'
  const scheduled = Array.from({ length: 3 }, (_, index) => ({ ...ordinary, id: `overlap-${index}`, title: `${title}${index}`, start: date.toISOString(), duration: 95 }))
  await seed(page, [scheduled[0]]); await page.goto('/')
  const event = page.locator('.calendar-event').first()
  await expect(event).toHaveAttribute('data-lanes', '1')
  const normalSize = await event.locator('strong').evaluate((node) => parseFloat(getComputedStyle(node).fontSize))
  await page.evaluate(({ key, tasks }) => { localStorage.setItem(key, JSON.stringify(tasks)) }, { key, tasks: scheduled.slice(0, 2) })
  await page.reload()
  await expect(page.locator('.calendar-event[data-lanes="2"]')).toHaveCount(2)
  expect(await event.locator('strong').evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeLessThan(normalSize)
  // The bottom status buttons must occupy their own row instead of covering a wrapped title.
  for (const overlappingEvent of await page.locator('.calendar-event[data-lanes="2"]').all()) {
    const titleBox = await overlappingEvent.locator('.event-main strong').boundingBox()
    const actionsBox = await overlappingEvent.locator('.event-actions').boundingBox()
    expect(titleBox && actionsBox && titleBox.y + titleBox.height <= actionsBox.y).toBe(true)
  }
  await page.getByRole('button', { name: '聚焦日程' }).click()
  for (const overlappingEvent of await page.locator('.calendar-event[data-lanes="2"]').all()) {
    await expect(overlappingEvent.locator('.event-main strong')).toBeVisible()
    expect((await overlappingEvent.locator('.event-main strong').boundingBox())?.width ?? 0).toBeGreaterThan(0)
  }
  await page.getByRole('button', { name: '聚焦日程' }).click()
  await event.scrollIntoViewIfNeeded()
  await expect(event.locator('strong')).toBeVisible()
  await page.evaluate(({ key, tasks }) => { localStorage.setItem(key, JSON.stringify(tasks)) }, { key, tasks: scheduled })
  await page.reload()
  await expect(page.locator('.calendar-event[data-lanes="3"]')).toHaveCount(3)
  const textStyle = await event.locator('strong').evaluate((node) => ({ overflow: getComputedStyle(node).textOverflow, wrap: getComputedStyle(node).whiteSpace, clipped: node.scrollWidth > node.clientWidth, width: node.clientWidth }))
  expect(textStyle).toMatchObject({ overflow: 'ellipsis', wrap: 'nowrap', clipped: true })
  expect(textStyle.width).toBeGreaterThan(0)
  await expect(event).toHaveAttribute('title', `${title}0 · 10:12 - 11:47`)
  await event.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('overlapping-events.png') })
  // Opening the main text shows the full title even on touch, without changing data.
  await event.locator('.event-main').click({ force: true })
  const dialog = page.getByRole('dialog', { name: '编辑工作方块' })
  await expect(dialog.getByLabel('工作内容', { exact: true })).toHaveValue(`${title}0`)
  expect(await saved(page)).toEqual(scheduled)
})

async function dragPlan(page: Page, mobile: boolean, fromId: string, toId: string, cancel = false) {
  const source = page.locator(`[data-plan-id="${fromId}"] .plan-sort-handle`)
  const target = page.locator(`[data-plan-id="${toId}"]`)
  await page.locator('.plan-list').scrollIntoViewIfNeeded()
  await source.scrollIntoViewIfNeeded()
  const from = (await source.boundingBox())!, to = (await target.boundingBox())!
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
  const end = { x: to.x + Math.min(to.width / 2, 80), y: to.y + to.height / 2 }
  async function touch(type: string, point: { x: number; y: number }) {
    await source.evaluate((node, { type, point }) => {
      const finger = new Touch({ identifier: 1, target: node, clientX: point.x, clientY: point.y })
      const touches = type === 'touchend' || type === 'touchcancel' ? [] : [finger]
      node.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches, targetTouches: touches, changedTouches: [finger] }))
    }, { type, point })
  }
  if (mobile) {
    await touch('touchstart', start)
    for (let step = 1; step <= 12; step++) await touch('touchmove', { x: start.x + (end.x - start.x) * step / 12, y: start.y + (end.y - start.y) * step / 12 })
  } else { await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 12 }) }
  await expect(page.locator('.plan-sort-overlay')).toHaveCount(1)
  await expect(page.locator('.drag-time-guide')).toHaveCount(0)
  await expect(target).toHaveClass(/is-sort-target/)
  if (mobile) await touch(cancel ? 'touchcancel' : 'touchend', end)
  else if (cancel) { await page.keyboard.press('Escape'); await page.mouse.up() }
  else await page.mouse.up()
  await expect(page.locator('.plan-sort-overlay')).toHaveCount(0)
}

test('plan handle sorts with mouse or touch, supports undo, keyboard order, and survives reload', async ({ page }, testInfo) => {
  await seed(page, [ordinary, ...plans]); await page.goto('/')
  // Saving a legacy plan without explicit ranks must not move it to the bottom.
  await page.getByRole('button', { name: '编辑计划 计划 B' }).click()
  await page.getByRole('dialog', { name: '编辑长期计划' }).getByRole('button', { name: '保存计划' }).click()
  await expect.poll(() => order(page)).toEqual(['A', 'B', 'C'])
  await dragPlan(page, testInfo.project.name === 'mobile-chromium', 'A', 'B')
  await expect.poll(() => order(page)).toEqual(['B', 'A', 'C'])
  expect((await saved(page)).find((task: { id: string }) => task.id === ordinary.id)).toEqual(ordinary)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.locator('.toast').getByRole('button', { name: '撤销' }).click()
  await expect.poll(() => order(page)).toEqual(['A', 'B', 'C'])
  const grip = page.getByRole('button', { name: '拖动排序 计划 C' })
  await grip.focus(); await grip.press('ArrowUp')
  await expect.poll(() => order(page)).toEqual(['A', 'C', 'B'])
  await page.reload()
  await expect.poll(() => order(page)).toEqual(['A', 'C', 'B'])
  const tasks = await saved(page)
  // Simulate JSONB/cloud payload ordering: only persisted rank controls the list.
  await page.evaluate(({ key, tasks }) => localStorage.setItem(key, JSON.stringify(tasks.reverse())), { key, tasks })
  await page.reload()
  await expect.poll(() => order(page)).toEqual(['A', 'C', 'B'])
})

test('cancelling sorting or failing storage preserves every original plan and schedule', async ({ page }, testInfo) => {
  const original = [ordinary, ...plans]
  await seed(page, original); await page.goto('/')
  await dragPlan(page, testInfo.project.name === 'mobile-chromium', 'A', 'B', true)
  expect(await saved(page)).toEqual(original)
  await page.evaluate((key) => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function (name, value) { if (name === key) throw new DOMException('Full', 'QuotaExceededError'); original.call(this, name, value) } }, key)
  await dragPlan(page, testInfo.project.name === 'mobile-chromium', 'A', 'B')
  await expect(page.locator('.toast')).toContainText('排序未保存')
  await expect.poll(() => order(page)).toEqual(['A', 'B', 'C'])
  expect(await saved(page)).toEqual(original)
})

test('a plan can set quantity and DDL together, split, complete a lesson, and retain the DDL on reload', async ({ page }) => {
  await seed(page, [ordinary]); await page.goto('/')
  await page.locator('.long-term-plans .sidebar-section-toggle').click()
  await page.locator('.long-term-plans .sidebar-section-toggle').click()
  await page.getByRole('button', { name: '新建计划', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建长期计划' })
  const deadline = new Date(); deadline.setDate(deadline.getDate() + 5); deadline.setHours(23, 59, 0, 0)
  await dialog.getByLabel('计划名称').fill('月底前三节网课')
  await dialog.getByLabel('总量', { exact: true }).fill('3')
  await dialog.getByLabel('截止日期与时间（可选）').fill(localTime(deadline))
  await dialog.getByLabel('截止提醒', { exact: true }).selectOption('1440')
  await dialog.getByRole('button', { name: '保存计划' }).click()
  const card = page.locator('.plan-card')
  await expect(page.locator('.deadline-strip')).toContainText('月底前三节网课')
  await card.getByRole('button', { name: '拆分为可安排日程' }).click()
  await card.getByRole('button', { name: '生成待安排日程' }).click()
  await expect(card.locator('.task-card')).toHaveCount(3)
  await card.locator('.task-edit').first().click()
  const edit = page.getByRole('dialog', { name: '编辑工作方块' })
  await edit.getByRole('group', { name: '任务状态' }).getByRole('button', { name: '已完成', exact: true }).click()
  await edit.getByRole('button', { name: '保存', exact: true }).click()
  await expect(card).toContainText('已完成 1/3')
  await page.reload()
  await expect(page.locator('.deadline-strip')).toContainText('月底前三节网课')
  const tasks = await saved(page)
  expect(tasks.find((task: any) => task.planDefinition).planDefinition).toMatchObject({ type: 'countable', totalUnits: 3, deadline: deadline.toISOString(), reminderMinutes: 1440 })
  expect(tasks.find((task: any) => task.id === ordinary.id)).toEqual(ordinary)
})

test('an existing DDL plan gains quantity without losing its work, time, progress, or deadline', async ({ page }) => {
  const date = new Date(); date.setHours(9, 12, 0, 0)
  const deadline = new Date(date); deadline.setDate(deadline.getDate() + 3)
  const old = { ...plan('legacy'), planDefinition: { ...definition, type: 'deadline', totalUnits: 0, deadline: deadline.toISOString() } }
  const child = { ...ordinary, id: 'existing-work', title: '已经完成的资料整理', start: date.toISOString(), status: 'completed', completedAt: date.toISOString(), planAllocation: { planId: old.id, units: [] } }
  await seed(page, [ordinary, old, child]); await page.goto('/')
  await page.getByRole('button', { name: '编辑计划 计划 legacy' }).click()
  const dialog = page.getByRole('dialog', { name: '编辑长期计划' })
  await dialog.getByLabel('启用数量拆分').check()
  await dialog.getByLabel('总量', { exact: true }).fill('3')
  await expect(dialog).toContainText('现有每个工作时段会计为 1 个单位')
  await dialog.getByRole('button', { name: '保存计划' }).click()
  const card = page.locator('.plan-card')
  await expect(card).toContainText('已完成 1/3')
  await card.getByRole('button', { name: '拆分为可安排日程' }).click()
  await card.getByRole('button', { name: '生成待安排日程' }).click()
  const tasks = await saved(page)
  expect(tasks.find((task: any) => task.id === child.id)).toEqual({ ...child, planAllocation: { planId: old.id, units: [1] } })
  expect(tasks.find((task: any) => task.id === old.id).planDefinition.deadline).toBe(deadline.toISOString())
  expect(tasks.filter((task: any) => task.planAllocation)).toHaveLength(3)
  await expect(page.locator('.deadline-strip')).toContainText(old.title)
  await card.getByRole('button', { name: '编辑计划 计划 legacy' }).click()
  await expect(page.getByLabel('启用数量拆分')).toBeDisabled()
})
