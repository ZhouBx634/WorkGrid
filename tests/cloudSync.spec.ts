import { expect, test, type Page, type WebSocketRoute } from '@playwright/test'
import { taskFingerprint } from '../src/cloudData'
import type { Task } from '../src/types'

const USER = '00000000-0000-4000-8000-000000000006'
const KEY = 'workgrid.tasks.v2'
const BASE_KEY = `workgrid.cloud-base.v1:${USER}`
const API = 'http://127.0.0.1:54321/rest/v1/workgrid_data**'
const base: Task = { id: 'sync-test', title: '自动同步原任务', color: 'blue', duration: 60, start: null, createdAt: '2026-10-05T00:00:00.000Z', status: 'todo', completedAt: null, reminderMinutes: null, remindedAt: null, endReminder: false, endRemindedAt: null, tags: [], deletedAt: null }

async function seed(page: Page, tasks = [base]) {
  const user = { id: USER, email: 'tester@example.com', aud: 'authenticated', role: 'authenticated' }
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ sub: USER, role: 'authenticated', exp: 4102444800 })).toString('base64url')
  await page.addInitScript(({ tasks, session, baseline, key, baseKey }) => {
    // Seed once, so reload really tests the persisted user edits and baseline.
    if (!localStorage.getItem('cloud-test-seeded')) {
      localStorage.setItem(key, JSON.stringify(tasks))
      localStorage.setItem(baseKey, baseline)
      localStorage.setItem('sb-127-auth-token', JSON.stringify(session))
      localStorage.setItem('cloud-test-seeded', 'true')
    }
  }, { tasks, key: KEY, baseKey: BASE_KEY, baseline: taskFingerprint([base]), session: { access_token: `${header}.${payload}.signature`, refresh_token: 'test-refresh-token', expires_in: 3600, expires_at: 4102444800, token_type: 'bearer', user } })
}

async function add(page: Page, title: string) {
  await page.getByRole('button', { name: '添加普通日程', exact: true }).click()
  await page.getByPlaceholder('输入工作内容').fill(title)
  await page.getByRole('button', { name: '创建工作方块' }).click()
}

async function synced(page: Page) {
  await expect(page.getByRole('button', { name: '云同步', exact: true })).toHaveAttribute('title', '云同步：已同步')
}

async function noChoice(page: Page) {
  await expect(page.getByRole('dialog', { name: '发现同步冲突' })).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: '选择首次同步数据' })).toHaveCount(0)
}

function snapshot(tasks: Task[], revision: number) {
  return { tasks, revision, updated_at: new Date().toISOString() }
}

async function realtime(page: Page) {
  let socket: WebSocketRoute | null = null
  let topic = ''
  let joinRef: string | null = null
  await page.routeWebSocket('ws://127.0.0.1:54321/realtime/v1/websocket**', (ws) => {
    ws.onMessage((message) => {
      const [join, ref, incomingTopic, event, payload] = JSON.parse(String(message))
      if (event === 'phx_join') {
        topic = incomingTopic; joinRef = join; socket = ws
        ws.send(JSON.stringify([join, ref, topic, 'phx_reply', { status: 'ok', response: { postgres_changes: payload.config.postgres_changes.map((filter: unknown) => ({ ...(filter as object), id: 1 })) } }]))
      } else if (event === 'heartbeat' || event === 'phx_leave') {
        ws.send(JSON.stringify([join, ref, incomingTopic, 'phx_reply', { status: 'ok', response: {} }]))
      }
    })
  })
  return {
    async send(tasks: Task[], revision: number) {
      await expect.poll(() => socket !== null).toBe(true)
      socket!.send(JSON.stringify([joinRef, null, topic, 'postgres_changes', { ids: [1], data: { schema: 'public', table: 'workgrid_data', type: 'UPDATE', commit_timestamp: new Date().toISOString(), columns: [], record: snapshot(tasks, revision), old_record: {}, errors: null } }]))
    },
  }
}

test('twenty consecutive edits and reload sync without a version prompt', async ({ page }) => {
  test.setTimeout(90_000)
  await seed(page)
  let cloud = [base]
  let revision = 1
  const revisions: string[] = []
  await page.route(API, async (route) => {
    if (route.request().method() === 'PATCH') {
      revisions.push(new URL(route.request().url()).searchParams.get('revision') ?? '')
      cloud = route.request().postDataJSON().tasks
      revision++
    }
    await route.fulfill({ json: snapshot(cloud.map((task) => Object.fromEntries(Object.entries(task).reverse()) as Task), revision) })
  })
  await page.goto('/')
  await synced(page)
  for (let index = 0; index < 20; index++) {
    await add(page, `连续修改 ${index}`)
    await expect.poll(() => cloud.length).toBe(index + 2)
    await synced(page)
    await noChoice(page)
  }
  expect(revisions).toEqual(Array.from({ length: 20 }, (_, index) => `eq.${index + 1}`))
  await page.reload()
  await synced(page)
  await noChoice(page)
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]').length, KEY)).toBe(21)
})

test('slow response, self echo, duplicate and out-of-order notifications preserve later edits', async ({ page }) => {
  await seed(page)
  const remote = await realtime(page)
  let cloud = [base]
  let revision = 1
  let release: (() => void) | undefined
  const gate = new Promise<void>((resolve) => { release = resolve })
  let firstCommitted = false
  let writes = 0
  await page.route(API, async (route) => {
    if (route.request().method() === 'PATCH') {
      writes++
      expect(new URL(route.request().url()).searchParams.get('revision')).toBe(`eq.${revision}`)
      cloud = route.request().postDataJSON().tasks; revision++
      const row = snapshot(cloud, revision)
      if (writes === 1) {
        await remote.send(cloud, revision)
        firstCommitted = true
        await gate
      }
      await route.fulfill({ json: row }); return
    }
    await route.fulfill({ json: snapshot(cloud, revision) })
  })
  await page.goto('/')
  await synced(page)
  await add(page, '慢网第一次修改')
  await expect.poll(() => firstCommitted).toBe(true)
  await add(page, '上传中继续修改')
  release!()
  await expect.poll(() => cloud.length).toBe(3)
  await synced(page)
  await remote.send(cloud, revision)
  await remote.send([base], 1)
  await noChoice(page)
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]').length, KEY)).toBe(3)
  expect(writes).toBe(2)
})

test('revision-only mismatch retries silently and an already-committed write is acknowledged', async ({ page }) => {
  await seed(page)
  let cloud = [base]
  let revision = 1
  let writes = 0
  await page.route(API, async (route) => {
    if (route.request().method() === 'PATCH') {
      writes++
      revision++
      if (writes === 1) { await route.fulfill({ json: [] }); return }
      cloud = route.request().postDataJSON().tasks
      // Simulate a committed write whose response was lost: the retry reads it.
      if (writes === 3) { await route.fulfill({ json: [] }); return }
    }
    await route.fulfill({ json: snapshot(cloud, revision) })
  })
  await page.goto('/')
  await synced(page)
  await add(page, '版本号变化但内容没变')
  await expect.poll(() => cloud.length).toBe(2)
  await synced(page)
  await add(page, '云端实际已保存')
  await expect.poll(() => cloud.length).toBe(3)
  await synced(page)
  await noChoice(page)
  expect(writes).toBe(3)
})

test('offline-only edits resume automatically on reload against the unchanged cloud baseline', async ({ page }) => {
  const local = [base, { ...base, id: 'offline-new', title: '离线新增' }]
  await seed(page, local)
  let cloud = [base]
  await page.route(API, async (route) => {
    if (route.request().method() === 'PATCH') cloud = route.request().postDataJSON().tasks
    await route.fulfill({ json: snapshot(cloud, cloud.length) })
  })
  await page.goto('/')
  await synced(page)
  await noChoice(page)
  expect(cloud).toHaveLength(2)
})

test('a committed write with a failed response does not conflict with the next local edit', async ({ page }) => {
  await seed(page)
  let cloud = [base]
  let revision = 1
  let writes = 0
  await page.route(API, async (route) => {
    if (route.request().method() === 'PATCH') {
      writes++
      if (writes === 1) {
        cloud = route.request().postDataJSON().tasks; revision++
        await route.fulfill({ status: 503, json: { message: 'Response lost after commit' } }); return
      }
      if (new URL(route.request().url()).searchParams.get('revision') !== `eq.${revision}`) {
        await route.fulfill({ json: [] }); return
      }
      cloud = route.request().postDataJSON().tasks; revision++
    }
    await route.fulfill({ json: snapshot(cloud, revision) })
  })
  await page.goto('/')
  await synced(page)
  await add(page, '响应丢失但已保存')
  await expect(page.getByRole('button', { name: '云同步', exact: true })).toHaveAttribute('title', '云同步：同步失败')
  await add(page, '响应丢失后的新修改')
  await expect.poll(() => cloud.length).toBe(3)
  await synced(page)
  await noChoice(page)
  expect(writes).toBe(3)
})

test('one-sided realtime updates apply, and unchanged notifications never rewind local edits', async ({ page }) => {
  await seed(page)
  const remote = await realtime(page)
  let cloud = [base]
  let revision = 1
  await page.route(API, async (route) => {
    if (route.request().method() === 'PATCH') {
      cloud = route.request().postDataJSON().tasks; revision++
    }
    await route.fulfill({ json: snapshot(cloud, revision) })
  })
  await page.goto('/')
  await synced(page)
  cloud = [{ ...base, title: '另一设备单边修改' }]; revision++
  await remote.send(cloud, revision)
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]')[0].title, KEY)).toBe('另一设备单边修改')
  await add(page, '本机继续修改')
  revision++
  await remote.send(cloud, revision)
  await expect.poll(() => cloud.length).toBe(2)
  await synced(page)
  await noChoice(page)
})

test('genuine two-sided edits pause safely and can be deferred without more prompts', async ({ page }) => {
  await seed(page)
  const remote = await realtime(page)
  let writes = 0
  const remoteTasks = [{ ...base, title: '另一设备修改' }]
  await page.route(API, async (route) => {
    if (route.request().method() !== 'GET') writes++
    await route.fulfill({ json: snapshot([base], 1) })
  })
  await page.goto('/')
  await synced(page)
  await add(page, '待上传的本机修改')
  await remote.send(remoteTasks, 2)
  const conflict = page.getByRole('dialog', { name: '发现同步冲突' })
  await expect(conflict).toBeVisible()
  await conflict.getByRole('button', { name: '稍后处理' }).click()
  await add(page, '暂停同步后继续编辑')
  await remote.send([{ ...base, title: '云端又有更新' }], 3)
  await expect(conflict).toHaveCount(0)
  await page.getByRole('button', { name: '云同步', exact: true }).click()
  await expect(conflict).toBeVisible()
  await expect(conflict).toContainText('3 个工作方块')
  expect(writes).toBe(0)
})
