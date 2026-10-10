import { expect, test, type Page } from '@playwright/test'

const KEY = 'workgrid.tasks.v2'
const ordinary = { id: 'experience-ordinary', title: '原有日程', color: 'purple', duration: 45, start: '2026-10-12T00:30:00.000Z', createdAt: '2026-10-01T00:00:00.000Z', status: 'todo', completedAt: null, reminderMinutes: 10, remindedAt: null, endReminder: true, endRemindedAt: null, tags: ['重要'], deletedAt: null }
function calendar(title = '数学', count = 8, start = '20261012T083000') {
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Experience Fixture//CN\r\nX-WR-CALNAME:交互测试课表\r\nBEGIN:VEVENT\r\nUID:experience-math\r\nSUMMARY:${title}\r\nDTSTART;TZID=Asia/Shanghai:${start}\r\nDURATION:PT90M\r\nRRULE:FREQ=WEEKLY;COUNT=${count}\r\nLOCATION:教室A101\r\nDESCRIPTION:教师: 林老师\\n教学班: 数学一班\r\nEND:VEVENT\r\nEND:VCALENDAR`
}
async function saved(page: Page) { return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]'), KEY) }
async function open(page: Page) {
  await page.getByRole('button', { name: '数据管理', exact: true }).click()
  await page.getByRole('menuitem', { name: '导入课表', exact: false }).click()
}
async function setup(page: Page) {
  await page.clock.setFixedTime(new Date('2026-10-09T02:30:00Z'))
  await page.addInitScript(({ key, task }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify([task])) }, { key: KEY, task: ordinary })
  await page.goto('/')
  await open(page)
}
async function upload(page: Page, contents = calendar()) {
  await page.locator('#course-file').setInputFiles({ name: '课程.ics', mimeType: 'text/calendar', buffer: Buffer.from(contents) })
  await expect(page.locator('.course-preview-row')).not.toHaveCount(0)
}
async function drop(page: Page, contents: string, name = '拖入课表.ics', count = 1) {
  await page.locator('.course-import-dialog').evaluate((element, value) => {
    const transfer = new DataTransfer()
    for (let index = 0; index < value.count; index++) transfer.items.add(new File([value.contents], value.name, { type: 'text/calendar' }))
    element.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }))
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  }, { contents, name, count })
}

test('preview search and per-lesson choices persist across ranges, course filters and colors', async ({ page }) => {
  await setup(page)
  await upload(page)
  const first = page.getByRole('checkbox', { name: '导入数学，10/12 08:30', exact: true })
  await first.uncheck()
  await page.getByLabel('课表导入范围').selectOption('4weeks')
  await expect(page.locator('.course-preview-row')).toHaveCount(4)
  await expect(first).not.toBeChecked()
  await page.getByLabel('数学', { exact: true }).uncheck()
  await expect(page.getByRole('button', { name: '确认导入课表' })).toBeDisabled()
  await page.getByLabel('数学', { exact: true }).check()
  await expect(first).not.toBeChecked()
  await page.getByLabel('数学颜色').selectOption('green')
  for (const query of ['A101', '林老师', '数学一班', '数学']) {
    await page.getByLabel('搜索课表', { exact: true }).fill(query)
    await expect(page.locator('.course-preview-row')).toHaveCount(4)
  }
  await page.getByLabel('搜索课表', { exact: true }).fill('无匹配课程')
  await expect(page.locator('.course-preview-row')).toHaveCount(0)
  await expect(page.locator('.course-selection-summary')).toContainText('已选新增 3 节')
  await expect(page.getByRole('button', { name: '确认导入课表' })).toBeEnabled()
  expect(await saved(page)).toEqual([ordinary])
  await page.getByRole('button', { name: '确认导入课表' }).click()
  await expect.poll(async () => (await saved(page)).length).toBe(4)
  const tasks = await saved(page)
  expect(tasks[0]).toEqual(ordinary)
  expect(tasks.slice(1).every((task: { color: string }) => task.color === 'green')).toBe(true)
  expect(tasks.slice(1).some((task: { start: string }) => task.start === '2026-10-12T00:30:00.000Z')).toBe(false)
  await page.getByRole('button', { name: '数据管理', exact: true }).click()
  await page.getByRole('menuitem', { name: /撤销上次课表导入/ }).click()
  await expect.poll(() => saved(page)).toEqual([ordinary])
})

test('time windows use today through an exclusive whole-day boundary', async ({ page }) => {
  await setup(page)
  await upload(page, calendar('数学', 16, '20261009T000000'))
  for (const [range, count] of [['4weeks', 4], ['6weeks', 6], ['14weeks', 14], ['future', 16], ['all', 16]] as const) {
    await page.getByLabel('课表导入范围').selectOption(range)
    await expect(page.locator('.course-preview-row')).toHaveCount(count)
    await expect(page.locator('.course-selection-summary')).toContainText(`已选新增 ${count} 节`)
  }
  expect(await saved(page)).toEqual([ordinary])
})

test('search-result bulk controls affect only matching new lessons', async ({ page }) => {
  await setup(page)
  await page.getByRole('button', { name: '试试示例课表', exact: true }).click()
  await expect(page.locator('.course-preview-row')).toHaveCount(12)
  await page.getByRole('button', { name: '取消选择搜索结果', exact: true }).click()
  await expect(page.getByRole('button', { name: '确认导入课表' })).toBeDisabled()
  await page.getByLabel('搜索课表', { exact: true }).fill('程序设计')
  await expect(page.locator('.course-preview-row')).toHaveCount(4)
  await page.getByRole('button', { name: '全选搜索结果中的新增课程', exact: true }).click()
  await page.getByLabel('搜索课表', { exact: true }).fill('')
  await expect(page.locator('.course-preview-row input:checked')).toHaveCount(4)
  await expect(page.locator('.course-selection-summary')).toContainText('已选新增 4 节')
  await page.getByRole('button', { name: '确认导入课表' }).click()
  await expect.poll(async () => (await saved(page)).length).toBe(5)
  expect((await saved(page)).slice(1).every((task: { title: string }) => task.title === '示例 · 程序设计')).toBe(true)
  expect((await saved(page))[0]).toEqual(ordinary)
})

test('bulk preview selection never approves a course update or a local edit', async ({ page }) => {
  await setup(page)
  await upload(page, calendar('数学', 2))
  await page.getByRole('button', { name: '确认导入课表' }).click()
  await page.evaluate((key) => {
    const tasks = JSON.parse(localStorage.getItem(key) ?? '[]')
    tasks[1].title = '用户手动修改'
    localStorage.setItem(key, JSON.stringify(tasks))
  }, KEY)
  await page.reload()
  const before = await saved(page)
  await open(page)
  // A real recurring-course move retains the original occurrence identity via RECURRENCE-ID.
  const changes = ['20261012', '20261019'].map((date) => `BEGIN:VEVENT\r\nUID:experience-math\r\nRECURRENCE-ID;TZID=Asia/Shanghai:${date}T083000\r\nSUMMARY:数学\r\nDTSTART;TZID=Asia/Shanghai:${date}T103000\r\nDURATION:PT90M\r\nLOCATION:教室A101\r\nDESCRIPTION:教师: 林老师\\n教学班: 数学一班\r\nEND:VEVENT`)
  await upload(page, calendar('数学', 3).replace('END:VCALENDAR', `${changes.join('\r\n')}\r\nEND:VCALENDAR`))
  await expect(page.getByLabel('确认替换本节课的手动修改')).toHaveCount(1)
  await page.getByRole('button', { name: '取消选择搜索结果', exact: true }).click()
  await page.getByRole('button', { name: '全选搜索结果中的新增课程', exact: true }).click()
  await expect(page.getByLabel('确认替换本节课的手动修改')).not.toBeChecked()
  await expect(page.getByLabel('确认更新本节课')).not.toBeChecked()
  await expect(page.locator('.course-selection-summary')).toContainText('确认更新 0 节')
  await page.getByRole('button', { name: '确认导入课表' }).click()
  await expect.poll(async () => (await saved(page)).length).toBe(4)
  expect((await saved(page)).slice(0, 3)).toEqual(before)
})

test('paste requires explicit parsing, invalidates edits, and safely displays errors', async ({ page }) => {
  await setup(page)
  await page.getByRole('button', { name: '粘贴 ICS 文本', exact: true }).click()
  let choosers = 0
  page.on('filechooser', () => { choosers++ })
  await page.getByLabel('ICS 文本', { exact: true }).fill(calendar('文本课程', 3))
  await expect(page.getByRole('button', { name: '确认导入课表' })).toBeDisabled()
  expect(choosers).toBe(0)
  await page.getByRole('button', { name: '解析文本', exact: true }).click()
  await expect(page.locator('.course-preview-row')).toHaveCount(3)
  await page.getByLabel('ICS 文本', { exact: true }).fill('https://school.invalid/calendar?token=not-a-real-token')
  await expect(page.getByRole('button', { name: '确认导入课表' })).toBeDisabled()
  await expect(page.locator('.course-preview-row')).toHaveCount(0)
  await page.getByRole('button', { name: '解析文本', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('完整')
  const malicious = '<img src=x onerror=alert(1)>'
  await page.getByLabel('ICS 文本', { exact: true }).fill(calendar(malicious, 1).replace('DURATION:PT90M', 'DURATION:PT0M'))
  await page.getByRole('button', { name: '解析文本', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText(malicious)
  await expect(page.locator('.course-import-dialog img')).toHaveCount(0)
  expect(await saved(page)).toEqual([ordinary])
  await page.getByLabel('ICS 文本', { exact: true }).fill(calendar('文本课程', 3))
  await page.getByRole('button', { name: '解析文本', exact: true }).click()
  await expect(page.locator('.course-preview-row')).toHaveCount(3)
  await page.getByRole('button', { name: '确认导入课表' }).click()
  await expect.poll(async () => (await saved(page)).length).toBe(4)
  expect((await saved(page))[0]).toEqual(ordinary)
})

test('dropped files preview safely and reject multiple or oversized sources', async ({ page }) => {
  await setup(page)
  await drop(page, calendar('拖入课程', 3))
  await expect(page.locator('.course-preview-row')).toHaveCount(3)
  expect(await saved(page)).toEqual([ordinary])
  await drop(page, calendar(), '课表.ics', 2)
  await expect(page.getByRole('alert')).toContainText('一个 ICS 文件')
  await expect(page.getByRole('button', { name: '确认导入课表' })).toBeDisabled()
  await drop(page, calendar(), '课表.txt')
  await expect(page.getByRole('alert')).toContainText('请选择')
  await page.locator('#course-file').setInputFiles({ name: 'large.ics', mimeType: 'text/calendar', buffer: Buffer.alloc(2 * 1024 * 1024 + 1, 32) })
  await expect(page.getByRole('alert')).toContainText('2MB')
  expect(await saved(page)).toEqual([ordinary])
  await drop(page, calendar('拖入课程', 3))
  await page.getByRole('button', { name: '确认导入课表' }).click()
  await expect.poll(async () => (await saved(page)).length).toBe(4)
  expect((await saved(page))[0]).toEqual(ordinary)
})

test('a slower replaced file cannot overwrite the latest preview', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => {
    const native = File.prototype.text
    File.prototype.text = function () {
      if (this.name !== 'slow.ics') return native.call(this)
      return new Promise<string>((resolve) => {
        (window as unknown as { releaseSlow: () => Promise<void> }).releaseSlow = async () => resolve(await native.call(this))
      })
    }
  })
  await page.locator('#course-file').setInputFiles({ name: 'slow.ics', mimeType: 'text/calendar', buffer: Buffer.from(calendar('过时课程', 8)) })
  await expect(page.getByText('正在解析课表…', { exact: true })).toBeVisible()
  await drop(page, calendar('最新课程', 2))
  await expect(page.locator('.course-preview-row')).toHaveCount(2)
  await page.evaluate(() => (window as unknown as { releaseSlow: () => Promise<void> }).releaseSlow())
  await page.waitForTimeout(150)
  await expect(page.locator('.course-preview-row')).toHaveCount(2)
  await expect(page.locator('.course-preview')).not.toContainText('过时课程')
  expect(await saved(page)).toEqual([ordinary])
})

test('synthetic sample is dated dynamically, previews without writing, and remains undoable', async ({ page }, testInfo) => {
  await setup(page)
  await page.getByRole('button', { name: '试试示例课表', exact: true }).click()
  await expect(page.locator('.course-import-controls')).toContainText('3 门 · 12 节')
  await expect(page.getByRole('button', { name: '选择文件', exact: true })).toBeHidden()
  await expect(page.getByRole('button', { name: '更换来源', exact: true })).toBeVisible()
  await expect(page.locator('.course-sample-note')).toContainText('不是真实课程')
  await expect(page.locator('.course-preview-row')).toHaveCount(12)
  expect(await saved(page)).toEqual([ordinary])
  await page.getByRole('button', { name: '取消', exact: true }).click()
  expect(await saved(page)).toEqual([ordinary])
  await open(page)
  await page.getByRole('button', { name: '试试示例课表', exact: true }).click()
  await expect(page.locator('.course-preview-row')).toHaveCount(12)
  await page.getByLabel('搜索课表', { exact: true }).fill('程序设计')
  await expect(page.locator('.course-preview-row')).toHaveCount(4)
  const viewport = page.viewportSize()!
  const bounds = await page.locator('.course-import-dialog').boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width)
  expect(bounds!.y).toBeGreaterThanOrEqual(0)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.locator('.course-preview-row').first().scrollIntoViewIfNeeded()
  const row = await page.locator('.course-preview-row').first().boundingBox()
  const actions = await page.locator('.course-import-actions').boundingBox()
  expect(row!.y + row!.height).toBeLessThanOrEqual(actions!.y)
  await expect(page.getByRole('button', { name: '关闭课表导入', exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('course-import-experience.png') })
  await page.getByRole('button', { name: '确认导入课表' }).click()
  await expect.poll(async () => (await saved(page)).length).toBe(13)
  await page.getByRole('button', { name: '数据管理', exact: true }).click()
  await page.getByRole('menuitem', { name: /撤销上次课表导入/ }).click()
  await expect.poll(() => saved(page)).toEqual([ordinary])
})
