import { expect, test, type Page } from '@playwright/test'

const storageKey = 'workgrid.tasks.v2'
const today = new Date(); today.setHours(10, 12, 0, 0)
const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)
const farAway = new Date(today); farAway.setDate(farAway.getDate() + 60)
const base = { color: 'blue', duration: 60, start: null, createdAt: '2026-10-01T00:00:00.000Z', status: 'todo', completedAt: null, reminderMinutes: null, remindedAt: null, endReminder: false, endRemindedAt: null, tags: [], deletedAt: null }
const work = { ...base, id: 'work', title: '普通日程' }
const longEvent = { ...base, id: 'long-event', title: '长时间日程', start: today.toISOString(), duration: 480 }
const plan = { ...base, id: 'plan', title: '高数网课', planDefinition: { type: 'countable', totalUnits: 3, unitLabel: '节', deadline: null, notes: '', reminderMinutes: null } }
const child = { ...base, id: 'child', title: '高数网课 · 第 1 节', planAllocation: { planId: 'plan', units: [1] } }
const scheduledChild = { ...base, id: 'scheduled-child', title: '高数网课 · 第 2 节', start: tomorrow.toISOString(), planAllocation: { planId: 'plan', units: [2] } }
const trashChild = { ...base, id: 'trash-child', title: '高数网课 · 第 3 节', deletedAt: '2026-10-01T02:00:00.000Z', planAllocation: { planId: 'plan', units: [3] } }
const ddl = { ...base, id: 'ddl', title: '期中作业', planDefinition: { type: 'deadline', totalUnits: 0, unitLabel: '项', deadline: farAway.toISOString(), notes: '', reminderMinutes: null } }
const data = [work, longEvent, plan, child, scheduledChild, trashChild, ddl]

async function seed(page: Page, tasks: unknown[] = data) {
  await page.addInitScript(({ key, tasks }) => {
    if (!localStorage.getItem('batch-test-seeded')) {
      localStorage.setItem(key, JSON.stringify(tasks)); localStorage.setItem('batch-test-seeded', 'yes')
    }
  }, { key: storageKey, tasks })
  await page.goto('/')
}
async function saved(page: Page) { return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]') as typeof data, storageKey) }
async function ready(page: Page) {
  await expect(page.getByRole('button', { name: '批量管理', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '勾选删除', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '一键删除', exact: true })).toBeVisible()
}
const toolbar = (page: Page) => page.getByRole('region', { name: '日程批量管理' })

test('checkboxes delete ordinary and long-duration calendar events, cancel, undo, and restore after reload', async ({ page }, testInfo) => {
  await seed(page)
  await page.getByRole('group', { name: '日历视图' }).getByRole('button', { name: '日', exact: true }).click()
  await ready(page)
  const ordinary = page.getByRole('checkbox', { name: '选择日程 普通日程', exact: true })
  if (testInfo.project.name === 'mobile-chromium') await ordinary.tap()
  else await ordinary.check()
  await expect(ordinary).toBeChecked()
  await page.getByRole('checkbox', { name: '选择日程 长时间日程', exact: true }).check()
  await expect(toolbar(page)).toContainText('已选择 2 项')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.drag-overlay')).toHaveCount(0)
  const deleteBox = await toolbar(page).getByRole('button', { name: '一键删除', exact: true }).boundingBox()
  expect(deleteBox!.y + deleteBox!.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight))
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))
  page.once('dialog', (dialog) => dialog.dismiss())
  await toolbar(page).getByRole('button', { name: '一键删除', exact: true }).click()
  expect(await saved(page)).toEqual(data)
  page.once('dialog', (dialog) => dialog.accept())
  await toolbar(page).getByRole('button', { name: '一键删除', exact: true }).click()
  await expect.poll(async () => (await saved(page)).filter((task) => task.deletedAt).length).toBe(3)
  await expect(page.locator('.calendar-event', { hasText: longEvent.title })).toHaveCount(0)
  expect((await saved(page)).find((task) => task.id === plan.id)).toEqual(plan)
  await page.locator('.toast').getByRole('button', { name: '撤销' }).click()
  expect(await saved(page)).toEqual(data)
  await ordinary.check()
  page.once('dialog', (dialog) => dialog.accept())
  await toolbar(page).getByRole('button', { name: '一键删除', exact: true }).click()
  await page.reload()
  await expect(page.locator('.task-list .task-card', { hasText: work.title })).toHaveCount(0)
  await page.getByRole('button', { name: /回收站，2 项/ }).click()
  await page.getByRole('dialog', { name: '回收站' }).locator('.trash-item', { hasText: work.title }).getByRole('button', { name: '恢复', exact: true }).click()
  expect((await saved(page)).find((task) => task.id === work.id)).toEqual(work)
})

test('mixed plan deletion defaults to preserving children and supports complete undo', async ({ page }) => {
  await seed(page); await ready(page)
  await page.getByRole('checkbox', { name: '选择长期计划 高数网课', exact: true }).check()
  await page.getByRole('checkbox', { name: '选择日程 普通日程', exact: true }).check()
  await toolbar(page).getByRole('button', { name: '一键删除', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '确认批量删除' })
  await expect(dialog).toContainText('1 个长期计划、1 个日程')
  await expect(dialog.getByRole('checkbox')).not.toBeChecked()
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  expect(await saved(page)).toEqual(data)
  await toolbar(page).getByRole('button', { name: '一键删除', exact: true }).click()
  await dialog.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(page.locator('.plan-card', { hasText: plan.title })).toHaveCount(0)
  const after = await saved(page)
  expect(after.some((task) => task.id === plan.id)).toBe(false)
  for (const original of [child, scheduledChild, trashChild]) {
    const { planAllocation: _allocation, ...ordinary } = original
    expect(after.find((task) => task.id === original.id)).toEqual(ordinary)
  }
  expect(after.find((task) => task.id === ddl.id)).toEqual(ddl)
  expect(after.find((task) => task.id === longEvent.id)).toEqual(longEvent)
  await page.locator('.toast').getByRole('button', { name: '撤销' }).click()
  expect(await saved(page)).toEqual(data)
  await expect(page.getByRole('checkbox', { name: '选择长期计划 高数网课' })).not.toBeChecked()
})

test('all plans can be deleted with their children, without touching unselected ordinary schedules', async ({ page }) => {
  await seed(page); await ready(page)
  await toolbar(page).getByText('更多操作', { exact: true }).click()
  await toolbar(page).getByRole('button', { name: '全选长期计划', exact: true }).click()
  await expect(toolbar(page)).toContainText('已选择 2 项')
  await toolbar(page).getByRole('button', { name: '一键删除', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '确认批量删除' })
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(page.locator('.plan-card')).toHaveCount(0)
  await expect(page.locator('.deadline-strip')).toHaveCount(0)
  const after = await saved(page)
  expect(after.find((task) => task.id === work.id)).toEqual(work)
  expect(after.find((task) => task.id === longEvent.id)).toEqual(longEvent)
  expect(after.filter((task) => task.deletedAt)).toHaveLength(3)
  expect(after.some((task) => 'planAllocation' in task)).toBe(false)
  expect(after.find((task) => task.id === trashChild.id)?.deletedAt).toBe(trashChild.deletedAt)
  await page.reload()
  await expect(page.locator('.plan-card')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /回收站，3 项/ })).toBeVisible()
})

test('split children have one batch checkbox, delete to trash, and restore to the original plan', async ({ page }) => {
  await seed(page)
  const card = page.locator('.plan-card', { hasText: plan.title })
  await card.getByRole('button', { name: /查看待安排方块/ }).click()
  await expect(card.getByRole('checkbox', { name: `选择日程 ${child.title}`, exact: true })).toBeVisible()
  await ready(page)
  await expect(card.getByRole('checkbox')).toHaveCount(2)
  await card.getByRole('checkbox', { name: `选择日程 ${child.title}`, exact: true }).check()
  await expect(toolbar(page)).toContainText('已选择 1 项')
  page.once('dialog', (dialog) => dialog.accept())
  await toolbar(page).getByRole('button', { name: '一键删除', exact: true }).click()
  await expect(card.locator('.task-card')).toHaveCount(0)
  expect((await saved(page)).find((task) => task.id === child.id)).toMatchObject({ planAllocation: child.planAllocation })
  await page.getByRole('button', { name: /回收站，2 项/ }).click()
  await page.getByRole('dialog', { name: '回收站' }).locator('.trash-item', { hasText: child.title }).getByRole('button', { name: '恢复', exact: true }).click()
  await page.getByRole('button', { name: '关闭回收站' }).click()
  await expect(card.locator('.task-card')).toHaveCount(1)
  expect((await saved(page)).find((task) => task.id === child.id)).toEqual(child)
})

test('select all respects calendar dates and search, and cancel clears selection without hiding checkboxes', async ({ page }) => {
  const future = { ...work, id: 'future', title: '远期工作', start: farAway.toISOString() }
  await seed(page, [...data, future])
  await page.getByRole('group', { name: '日历视图' }).getByRole('button', { name: '日', exact: true }).click()
  await ready(page)
  if (!(await toolbar(page).locator('details').evaluate(element => element.open))) await toolbar(page).getByText('更多操作', { exact: true }).click()
  await toolbar(page).getByRole('button', { name: '全选当前日程', exact: true }).click()
  await expect(toolbar(page)).toContainText('已选择 2 项')
  await expect(page.getByRole('checkbox', { name: '选择长期计划 高数网课' })).not.toBeChecked()
  await toolbar(page).getByRole('button', { name: '取消选择', exact: true }).click()
  await page.getByRole('textbox', { name: '搜索工作', exact: true }).fill(work.title)
  if (!(await toolbar(page).locator('details').evaluate(element => element.open))) await toolbar(page).getByText('更多操作', { exact: true }).click()
  await toolbar(page).getByRole('button', { name: '全选当前日程', exact: true }).click()
  await expect(toolbar(page)).toContainText('已选择 1 项')
  await toolbar(page).getByRole('button', { name: '取消选择', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: '选择日程 普通日程', exact: true })).toBeVisible()
  await ready(page)
  await expect(toolbar(page)).toContainText('已选择 0 项')
  await expect(toolbar(page).getByRole('button', { name: '一键删除', exact: true })).toBeDisabled()
})

test('month checkboxes support keyboard selection without opening the editor or scheduling a task', async ({ page }) => {
  await seed(page)
  await page.getByRole('group', { name: '日历视图' }).getByRole('button', { name: '月', exact: true }).click()
  await ready(page)
  const choice = page.getByRole('checkbox', { name: '选择日程 长时间日程', exact: true })
  await choice.focus(); await choice.press('Space')
  await expect(choice).toBeChecked()
  await expect(toolbar(page)).toContainText('已选择 1 项')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await saved(page)).toEqual(data)
  await choice.press('Space')
  await expect(choice).not.toBeChecked()
  await expect(toolbar(page)).toContainText('已选择 0 项')
})

test('plan deletion confirmation traps focus, cancels with Escape, and clears the cascade option', async ({ page }) => {
  await seed(page); await ready(page)
  await page.getByRole('checkbox', { name: '选择长期计划 高数网课', exact: true }).check()
  await toolbar(page).getByRole('button', { name: '一键删除', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '确认批量删除' })
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('checkbox')).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('button', { name: '确认删除', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('checkbox')).toBeFocused()
  await dialog.getByRole('checkbox').check()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(toolbar(page).getByRole('button', { name: '一键删除', exact: true })).toBeFocused()
  expect(await saved(page)).toEqual(data)
  await toolbar(page).getByRole('button', { name: '一键删除', exact: true }).click()
  await expect(dialog.getByRole('checkbox')).not.toBeChecked()
})

test('a full browser store cannot discard selected schedules', async ({ page }) => {
  await seed(page); await ready(page)
  await page.getByRole('checkbox', { name: '选择日程 普通日程', exact: true }).check()
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (name, value) { if (name === key) throw new DOMException('full', 'QuotaExceededError'); original.call(this, name, value) }
  }, storageKey)
  page.once('dialog', (dialog) => dialog.accept())
  await toolbar(page).getByRole('button', { name: '一键删除', exact: true }).click()
  await expect(page.locator('.toast')).toContainText('删除未保存，原有日程保留')
  await expect(page.getByRole('checkbox', { name: '选择日程 普通日程', exact: true })).toBeChecked()
  expect(await saved(page)).toEqual(data)
})
