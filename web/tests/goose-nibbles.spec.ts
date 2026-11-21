import { test, expect } from '@playwright/test'
import manifest from '../data/goose-nibbles.json' with { type: 'json' }

test.beforeEach(async ({ page }) => {
  await page.route('**/challenges.cloudflare.com/turnstile/v0/api.js*', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.turnstile = {
      render(element, options) { setTimeout(() => options.callback('verified-token'), 0); return 'widget'; },
      remove() {}
    }; window.bigNaturalsTurnstileLoaded();`,
  }))
})

test('flavors render manifest ingredients, distinct colors, mascot avatars and placeholders', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto('/goose-nibbles')
  await expect(page).toHaveTitle('Goose Nibbles — Big Naturals Food Co.')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Goose Nibbles')
  const colors = new Set<string>()
  for (const flavor of manifest.flavors) {
    const section = page.getByRole('region', { name: flavor.name, exact: true })
    await expect(section.locator('.flavor-ingredients')).toHaveText(`Ingredients: ${flavor.ingredients.join(', ')}.`)
    colors.add(await section.evaluate(element => getComputedStyle(element).backgroundColor))
    for (const image of await section.locator('img').all()) {
      await image.scrollIntoViewIfNeeded()
      await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true)
    }
    await expect(section.getByText('Bar photo coming soon.')).toBeVisible()
  }
  expect(colors.size).toBe(3)
  await expect(page.getByText('Nutrition information is not yet available.')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('goose-nibbles.png'), fullPage: true })
  expect(errors).toEqual([])
})

test('navigation reaches Goose Nibbles and returns home with the correct current link', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('link', { name: 'Goose Nibbles', exact: true }).click()
  await expect(page).toHaveURL(/\/goose-nibbles$/)
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await expect(page.getByRole('link', { name: 'Goose Nibbles', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('link', { name: 'Home', exact: true })).not.toHaveAttribute('aria-current')
  await page.getByRole('link', { name: 'Home', exact: true }).click()
  await expect(page).toHaveURL('http://127.0.0.1:4173/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('The goose willsoon be loose!')
})

test('Goose Nibbles signup submits through the shared form', async ({ page }) => {
  let submitted = false
  await page.route('https://signup.example.test/subscribe', route => {
    submitted = true
    expect(route.request().postDataJSON()).toMatchObject({ email: 'reader@example.com', consent: true })
    return route.fulfill({ json: { accepted: true } })
  })
  await page.goto('/goose-nibbles')
  await page.getByLabel('Email address', { exact: true }).fill('reader@example.com')
  await expect(page.locator('#email-updates').getByRole('heading', { name: /The goose will\s*soon be loose!/, level: 2 })).toBeVisible()
  await expect(page.locator('#email-updates img')).toHaveAttribute('alt', 'Our goose spreading its wings above a rocky green hillside.')
  await page.getByRole('button', { name: 'Keep me posted' }).click()
  await expect(page.getByRole('status')).toContainText('Your signup request is received')
  expect(submitted).toBe(true)
})

test('ingredients are readable without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto('http://127.0.0.1:4173/goose-nibbles')
  for (const flavor of manifest.flavors) {
    await expect(page.getByRole('region', { name: flavor.name, exact: true }).locator('.flavor-ingredients')).toContainText(flavor.ingredients.join(', '))
  }
  await context.close()
})
