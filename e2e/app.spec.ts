import { readFileSync } from 'node:fs'
import { expect, openSample, test } from './helpers.ts'

const csv = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url))

test('the biology sample flags the likely miskey', async ({ app: page }) => {
  await openSample(page, 'bio110')
  await expect(page.getByRole('heading', { name: 'BIO 110 Intro Biology' })).toBeVisible()
  const review = page.locator('.panel', { has: page.getByRole('heading', { name: 'Review first' }) })
  const q17 = review.getByRole('button', { name: /^Q17/ })
  await expect(q17).toContainText('Likely miskey')
  await q17.click()
  const drawer = page.getByRole('dialog', { name: 'Item Q17' })
  await expect(drawer).toContainText('Suggested fixes')
  await expect(drawer).toContainText('suspect')
})

test('the regrade simulator changes student and grade-band impact', async ({ app: page }) => {
  await openSample(page, 'bio110')
  await page.getByRole('navigation', { name: 'Course sections' }).getByRole('link', { name: 'Regrade' }).click()
  await expect(page.getByText('No regrades yet')).toBeVisible()
  await expect(page.getByText('No scores change with the current decisions.')).toBeVisible()
  const summary = page.getByText(/Class mean .*students raised/)
  const unchanged = (await summary.textContent())!
  expect(unchanged).toMatch(/0 students raised, 0 change letter grade/)

  await page.locator('.panel', { hasText: 'Regrade decisions' }).first().getByRole('button', { name: /Q17/ }).first().click()
  await expect(page.locator('.adj')).toContainText('Q17')
  await expect(summary).not.toHaveText(unchanged)
  const after = (await summary.textContent())!
  const raised = Number(after.match(/(\d+) students raised/)![1])
  expect(raised).toBeGreaterThan(0)
  await expect(page.getByText('No scores change with the current decisions.')).toHaveCount(0)
  await expect(page.locator('.band-table .delta.up, .band-table .delta.down').first()).toBeVisible()

  // Removing the regrade restores the original numbers.
  await page.getByRole('button', { name: 'Clear all' }).click()
  await expect(summary).toHaveText(unchanged)
})

test('a student-by-item CSV with an answer key imports through to statistics', async ({ app: page }) => {
  await page.goto('/app')
  await page.getByRole('button', { name: 'Import your data' }).first().click()
  await page.waitForURL(/\/import$/)
  await page.locator('input[type=file]').setInputFiles({ name: 'synthetic-quiz.csv', mimeType: 'text/csv', buffer: csv('student-by-item.csv') })
  await expect(page.getByText('Generic student × item CSV').first()).toBeVisible()
  const validation = page.locator('.panel', { has: page.getByRole('heading', { name: '3. Validation' }) })
  await expect(validation).toContainText('Ready')
  await expect(validation.locator('dl')).toContainText('20')
  await expect(validation.locator('dl')).toContainText('4 keyed')
  await page.getByRole('button', { name: 'Import and analyse' }).click()
  await page.waitForURL(/\/app\/p\/[\w-]+\?exam=/)
  await expect(page.locator('.kpi', { hasText: 'Students' })).toContainText('20')
  await expect(page.locator('.kpi', { hasText: /KR-20|Alpha/ })).toContainText(/\d\.\d\d|—/)
  await page.getByRole('navigation', { name: 'Course sections' }).getByRole('link', { name: /^Items/ }).click()
  const rows = page.locator('table.data tbody tr')
  await expect(rows).toHaveCount(4)
  await expect(rows.first()).toContainText('Q1')
  await expect(rows.first()).toContainText('B')
})

test.describe('files the app cannot read', () => {
  test('a spreadsheet is refused with a message, and the next file still works', async ({ app: page }) => {
    await page.goto('/app')
    await page.getByRole('button', { name: 'Import your data' }).first().click()
    await page.waitForURL(/\/import$/)
    const input = page.locator('input[type=file]')
    await input.setInputFiles({ name: 'grades.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from([0x50, 0x4b, 3, 4, 0, 1, 2, 3]) })
    await expect(page.getByRole('alert')).toContainText('Save it as CSV (UTF-8)')
    await expect(page.getByRole('heading', { name: '3. Validation' })).toHaveCount(0)
    await input.setInputFiles({ name: 'ok.csv', mimeType: 'text/csv', buffer: csv('student-by-item.csv') })
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Import and analyse' })).toBeEnabled()
  })

  for (const [file, message] of [['header-only.csv', 'The file has no data rows.'], ['no-items.csv', 'No question columns were found']] as const) {
    test(`${file} shows "${message}" and blocks the import`, async ({ app: page }) => {
      await page.goto('/app')
      await page.getByRole('button', { name: 'Import your data' }).first().click()
      await page.waitForURL(/\/import$/)
      await page.locator('input[type=file]').setInputFiles({ name: file, mimeType: 'text/csv', buffer: csv(file) })
      const validation = page.locator('.panel', { has: page.getByRole('heading', { name: '3. Validation' }) })
      await expect(validation).toContainText(message)
      await expect(validation).toContainText(/1 error/)
      await expect(page.getByRole('button', { name: 'Import and analyse' })).toBeDisabled()
      // Still usable: the app navigates and the sample opens.
      await page.goto('/app')
      await expect(page.getByRole('heading', { name: 'Courses' })).toBeVisible()
    })
  }
})

test('courses and regrades survive a reload', async ({ app: page }) => {
  const id = await openSample(page, 'bio110')
  await page.getByRole('navigation', { name: 'Course sections' }).getByRole('link', { name: 'Regrade' }).click()
  await page.locator('.panel', { hasText: 'Regrade decisions' }).first().getByRole('button', { name: /Q17/ }).first().click()
  await expect(page.locator('.adj')).toContainText('Q17')
  await page.reload()
  await expect(page.locator('.adj')).toContainText('Q17')
  await page.goto('/app')
  await expect(page.getByRole('link', { name: 'BIO 110 Intro Biology' })).toBeVisible()
  expect(await page.evaluate(() => indexedDB.databases().then(d => d.map(x => x.name)))).toContain('item-analysis')
  await page.getByRole('link', { name: 'BIO 110 Intro Biology' }).click()
  await page.waitForURL(new RegExp(`/app/p/${id}`))
  await expect(page.getByRole('heading', { name: 'BIO 110 Intro Biology' })).toBeVisible()
})

test('the app works signed out with every outside request blocked', async ({ app: page, blocked }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/Item Analysis/)
  await page.goto('/settings')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.goto('/docs')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await openSample(page, 'stat201')
  await expect(page.locator('.kpis')).toBeVisible()
  expect(blocked.filter(u => /supabase/i.test(u))).toEqual([])
})
