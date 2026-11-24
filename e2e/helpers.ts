import { expect, test as base, type Page } from '@playwright/test'

/**
 * Every test starts signed out with the network closed: Supabase and Google Fonts requests are aborted
 * and recorded, and any uncaught page error or console error fails the test.
 */
export const test = base.extend<{ app: Page; blocked: string[] }>({
  blocked: async ({}, use) => { await use([]) },
  app: async ({ page, blocked, baseURL }, use) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`) })
    await page.route(u => !u.href.startsWith(baseURL!), route => {
      blocked.push(route.request().url())
      return route.abort()
    })
    await use(page)
    expect(errors, 'uncaught page errors').toEqual([])
    expect(blocked.filter(u => /supabase/i.test(u)), 'Supabase requests while signed out').toEqual([])
  },
})

export { expect }

/** Opens a sample course from the workspace and returns the course id from the URL. */
export async function openSample(page: Page, id: 'bio110' | 'stat201') {
  await page.goto(`/app?sample=${id}`)
  await page.waitForURL(/\/app\/p\/[\w-]+/)
  return page.url().match(/\/app\/p\/([\w-]+)/)![1]
}
