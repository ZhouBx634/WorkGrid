import { expect, test, type Page } from '@playwright/test'

const key = 'workgrid.tasks.v2'
const base = { color: 'blue', duration: 60, start: null, createdAt: '2026-10-01T00:00:00.000Z', status: 'todo', completedAt: null, reminderMinutes: null, remindedAt: null, endReminder: false, endRemindedAt: null, tags: [], deletedAt: null }
const plan = { ...base, id: 'course', title: '六十节高数', planDefinition: { type: 'countable', totalUnits: 60, unitLabel: '节', deadline: null, notes: '', reminderMinutes: null } }
const lessons = Array.from({ length: 60 }, (_, i) => ({ ...base, id: `lesson-${i + 1}`, title: `高数第 ${i + 1} 节`, planAllocation: { planId: plan.id, units: [i + 1] } }))
const ordinary = { ...base, id: 'original', title: '原有工作' }
async function setup(page: Page, extra: object[] = []) {
  const tasks = [ordinary, { ...plan, planDefinition: { ...plan.planDefinition, totalUnits: 60 + extra.length } }, ...lessons, ...extra.map((task, i) => ({ ...task, planAllocation: { planId: plan.id, units: [61 + i] } }))]
  await page.addInitScript(({ key, tasks }) => { if (!localStorage.getItem('shortcut-seeded')) { localStorage.setItem(key, JSON.stringify(tasks)); localStorage.setItem('shortcut-seeded', '1') } }, { key, tasks })
  await page.goto('/')
  await page.getByRole('group', { name: '日历视图' }).getByRole('button', { name: '日', exact: true }).click()
  await page.locator('.calendar-panel').evaluate(node => window.scrollTo(0, node.getBoundingClientRect().top + window.scrollY - 12))
  return tasks
}
async function saved(page: Page) { return page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '[]'), key) }
async function open(page: Page) {
  if (await page.locator('.plan-shortcuts').count() === 0) {
    await page.getByRole('button', { name: '快捷安排 六十节高数', exact: true }).click()
    await page.locator('.calendar-panel').evaluate(node => window.scrollTo(0, node.getBoundingClientRect().top + window.scrollY - 12))
  }
}

test('shortcut is opt-in, overlays the left panel, and excludes scheduled or completed lessons', async ({ page }, testInfo) => {
  const original = await setup(page, [
    { ...lessons[0], id: 'scheduled', title: '已安排课程', start: new Date().toISOString() },
    { ...lessons[0], id: 'completed', title: '已完成课程', status: 'completed' },
    { ...lessons[0], id: 'deleted', title: '已删除课程', deletedAt: new Date().toISOString() },
  ])
  await expect(page.locator('.plan-shortcuts')).toHaveCount(0)
  const calendarBefore = (await page.locator('.calendar-panel').boundingBox())!
  await open(page)
  const quick = page.getByRole('complementary', { name: '快捷安排', exact: true })
  await expect(quick).toBeInViewport()
  expect((await quick.boundingBox())!.x).toBeLessThan(20)
  expect((await page.locator('.calendar-panel').boundingBox())!.width).toBe(calendarBefore.width)
  if (testInfo.project.name === 'mobile-chromium') {
    const quickBox = (await quick.boundingBox())!, toolbarBox = (await page.locator('.batch-toolbar').boundingBox())!
    expect(quickBox.y + quickBox.height).toBeLessThanOrEqual(toolbarBox.y)
  }
  await expect(quick.locator('.lesson-shortcut')).toHaveCount(60)
  const layout = await quick.locator('.shortcut-groups').evaluate(node => ({ client: node.clientHeight, scroll: node.scrollHeight }))
  expect(layout.client).toBeLessThan(600); expect(layout.scroll).toBeGreaterThan(layout.client)
  const last = quick.getByRole('button', { name: '拖动安排 高数第 60 节', exact: true })
  await last.scrollIntoViewIfNeeded(); await expect(last).toBeInViewport()
  await expect(quick).not.toContainText('已安排课程'); await expect(quick).not.toContainText('已完成课程'); await expect(quick).not.toContainText('已删除课程')
  expect(await saved(page)).toEqual(original)
  await page.screenshot({ path: testInfo.outputPath('pending-lessons.png') })
  await quick.getByRole('button', { name: '关闭快捷安排' }).click()
  await expect(quick).toHaveCount(0)
  await expect(page.getByRole('button', { name: '快捷安排 六十节高数', exact: true })).toBeFocused()
  expect(await saved(page)).toEqual(original)
})

for (const cancel of [true, false]) test(`shortcut mouse/touch drag ${cancel ? 'cancels safely' : 'schedules existing lesson and supports undo'}`, async ({ page }, testInfo) => {
  const original = await setup(page)
  const surface = page.locator('.calendar-surface')
  await surface.evaluate(node => { node.scrollTop = 40 * 22 - 100 })
  await open(page)
  const handle = page.getByRole('button', { name: '拖动安排 高数第 60 节', exact: true })
  await handle.scrollIntoViewIfNeeded()
  const fromBox = (await handle.boundingBox())!, toBox = (await page.locator('.day-track .drop-slot').nth(40).boundingBox())!
  const from = { x: fromBox.x + 12, y: fromBox.y + fromBox.height / 2 }, to = { x: toBox.x + toBox.width / 2, y: toBox.y + toBox.height / 2 }
  const mobile = testInfo.project.name === 'mobile-chromium'
  // Real browser touch input continues even after the drawer hides its source.
  const client = mobile ? await page.context().newCDPSession(page) : null
  if (client) await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] })
  else { await page.mouse.move(from.x, from.y); await page.mouse.down() }
  for (let i = 1; i <= 12; i++) { const point = { x: from.x + (to.x - from.x) * i / 12, y: from.y + (to.y - from.y) * i / 12 }; if (client) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] }); else await page.mouse.move(point.x, point.y) }
  await expect(page.locator('.drag-overlay')).toHaveCount(1)
  await expect(page.locator('.drag-time-guide')).toBeVisible()
  const guideTime = await page.locator('.drag-time-guide').getAttribute('data-time')
  if (mobile) await expect(page.locator('.shortcut-content')).toBeHidden()
  if (client) { await client.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] }); await client.detach() }
  else { if (cancel) await page.keyboard.press('Escape'); await page.mouse.up() }
  await expect(page.locator('.drag-overlay')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  if (cancel) expect(await saved(page)).toEqual(original)
  else {
    await expect(page.locator('.shortcut-plan-name span')).toHaveText('59 个待安排')
    const data = await saved(page)
    expect(data).toHaveLength(original.length)
    const scheduled = data.find((task: any) => task.id === 'lesson-60')
    expect(new Date(scheduled.start).toTimeString().slice(0, 5)).toBe(guideTime)
    expect({ ...scheduled, start: null }).toEqual(lessons[59])
    expect(data.filter((task: any) => task.id !== 'lesson-60')).toEqual(original.filter(task => task.id !== 'lesson-60'))
    await page.locator('.toast').getByRole('button', { name: '撤销' }).click()
    expect(await saved(page)).toEqual(original)
    await expect(page.locator('.shortcut-plan-name span')).toHaveText('60 个待安排')
  }
})

test('shortcut click-to-schedule and editing update the same lesson and survive reload', async ({ page }) => {
  const original = await setup(page)
  await open(page)
  const quick = page.locator('.plan-shortcuts')
  await quick.getByRole('button', { name: '快捷编辑 高数第 1 节', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '编辑工作方块' })
  await dialog.getByLabel('工作内容', { exact: true }).fill('改过名字的一节课')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await quick.getByRole('button', { name: '选择安排 改过名字的一节课', exact: true }).click()
  await page.locator('.day-track .drop-slot').nth(40).click()
  await expect(page.locator('.calendar-event')).toContainText('改过名字的一节课')
  if (await quick.count()) await expect(page.locator('.shortcut-plan-name span')).toHaveText('59 个待安排')
  await page.reload()
  const data = await saved(page)
  expect(data).toHaveLength(original.length)
  expect(data.find((task: any) => task.id === 'lesson-1').planAllocation).toEqual(lessons[0].planAllocation)
  expect(data.find((task: any) => task.id === ordinary.id)).toEqual(ordinary)
  await expect(page.locator('.plan-shortcuts')).toHaveCount(0)
  await open(page)
  await expect(page.locator('.shortcut-plan-name span')).toHaveText('59 个待安排')
})

test('phone scrolls the course list by its titles without accidentally dragging a lesson', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'Native touch scrolling is mobile-only')
  const original = await setup(page)
  await open(page)
  const list = page.locator('.shortcut-groups')
  const box = (await page.getByRole('button', { name: '选择安排 高数第 2 节', exact: true }).boundingBox())!
  const client = await page.context().newCDPSession(page)
  const x = box.x + box.width / 2, y = box.y + box.height / 2
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  for (let i = 1; i <= 8; i++) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - i * 12 }] })
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await client.detach()
  await expect.poll(() => list.evaluate(node => node.scrollTop)).toBeGreaterThan(20)
  await expect(page.locator('.drag-overlay')).toHaveCount(0)
  await expect(page.locator('.shortcut-content')).toBeVisible()
  expect(await saved(page)).toEqual(original)
})
