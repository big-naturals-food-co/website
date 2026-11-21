import { test, expect, type Page } from '@playwright/test'

const scriptUrl = '**/challenges.cloudflare.com/turnstile/v0/api.js*'
const endpoint = 'https://signup.example.test/subscribe'
const widget = `
  window.turnstile = {
    render(element, options) {
      window.testVerification = options;
      window.testWidgetCount = (window.testWidgetCount || 0) + 1;
      if (!window.testVerificationWait) setTimeout(() => options.callback('verified-token'), 0);
      return 'widget-' + window.testWidgetCount;
    },
    remove() {}
  };
  window.bigNaturalsTurnstileLoaded();
`

async function fill(page: Page) {
  await page.getByLabel('Email address', { exact: true }).fill('reader@example.com')
}

test.beforeEach(async ({ page }) => {
  await page.route(scriptUrl, route => route.fulfill({ contentType: 'application/javascript', body: widget }))
})

test('signup subscribes without a checkbox, posts exact fields, prevents duplicate submissions, and focuses success', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  let requests = 0
  let payload: unknown
  await page.route(endpoint, async route => {
    requests++
    payload = route.request().postDataJSON()
    await new Promise(resolve => setTimeout(resolve, 250))
    await route.fulfill({ json: { accepted: true } })
  })
  await page.goto('/')
  const submit = page.getByRole('button', { name: 'Keep me posted' })
  await expect(page.getByRole('checkbox')).toHaveCount(0)
  await expect(page.getByText('Unsubscribe anytime.', { exact: false })).toBeVisible()
  await fill(page)
  await expect(submit).toBeEnabled()
  await submit.click()
  await expect(page.getByRole('button', { name: 'Signing up…' })).toBeDisabled()
  const success = page.getByRole('status').filter({ hasText: 'Your signup request is received' })
  await expect(success).toBeFocused()
  expect(payload).toEqual({ email: 'reader@example.com', consent: true, name: '', source: 'landing-page', turnstileToken: 'verified-token' })
  expect(requests).toBe(1)
  expect(errors).toEqual([])
})

test('failed signup keeps the address, obtains a fresh token and allows retry', async ({ page }) => {
  let requests = 0
  await page.route(endpoint, route => {
    requests++
    return route.fulfill({ status: requests === 1 ? 503 : 200, json: requests === 1 ? { error: 'unavailable' } : { accepted: true } })
  })
  await page.goto('/')
  await fill(page)
  await page.getByRole('button', { name: 'Keep me posted' }).click()
  await expect(page.getByRole('alert')).toContainText('couldn’t confirm')
  await expect(page.getByLabel('Email address', { exact: true })).toHaveValue('reader@example.com')
  expect(await page.evaluate(() => (window as any).testWidgetCount)).toBe(2)
  await page.getByRole('button', { name: 'Keep me posted' }).click()
  await expect(page.getByRole('status')).toContainText('Your signup request is received')
})

test('desktop goose stays centered as signup grows and shrinks', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The mobile layout is stacked')
  await page.setViewportSize({ width: 1440, height: 1000 })
  let requests = 0
  await page.route(endpoint, route => {
    requests++
    return route.fulfill({ status: requests === 1 ? 503 : 200, json: requests === 1 ? {} : { accepted: true } })
  })
  await page.goto('/')
  await page.evaluate(() => document.fonts.ready)
  await fill(page)
  const submit = page.getByRole('button', { name: 'Keep me posted' })
  await expect(submit).toBeEnabled()

  async function geometry() {
    return page.evaluate(() => {
      const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect()
      const goose = rect('.signup-panel-art img')
      const signup = rect('.signup-panel-content')
      return {
        gooseCenter: goose.top + goose.height / 2,
        signupCenter: signup.top + signup.height / 2,
        availableCenter: (rect('.site-header').bottom + rect('.site-footer').top) / 2,
        signupHeight: signup.height,
      }
    })
  }
  const initial = await geometry()
  await submit.click()
  await expect(page.getByRole('alert')).toContainText('couldn’t confirm')
  const failed = await geometry()
  await submit.click()
  await expect(page.getByRole('status')).toContainText('Your signup request is received')
  const success = await geometry()

  expect(failed.signupHeight).toBeGreaterThan(initial.signupHeight)
  expect(success.signupHeight).toBeLessThan(initial.signupHeight)
  for (const state of [initial, failed, success]) {
    expect(Math.abs(state.gooseCenter - state.availableCenter)).toBeLessThan(1)
    expect(Math.abs(state.signupCenter - state.availableCenter)).toBeLessThan(1)
    expect(Math.abs(state.gooseCenter - initial.gooseCenter)).toBeLessThan(1)
  }
})

test('expired verification disables signup and offers a working retry', async ({ page }) => {
  await page.goto('/')
  await fill(page)
  await expect(page.getByRole('button', { name: 'Keep me posted' })).toBeEnabled()
  await page.evaluate(() => (window as any).testVerification['expired-callback']())
  await expect(page.getByRole('button', { name: 'Keep me posted' })).toBeDisabled()
  await expect(page.getByRole('status')).toContainText('expired')
  await page.getByRole('button', { name: 'Retry verification' }).click()
  await expect(page.getByRole('button', { name: 'Keep me posted' })).toBeEnabled()
})

test('blocked Turnstile script gives a retry rather than leaving signup silently stuck', async ({ page }) => {
  await page.unroute(scriptUrl)
  await page.route(scriptUrl, route => route.abort())
  await page.goto('/')
  await expect(page.getByRole('status')).toContainText('could not load')
  await expect(page.getByRole('button', { name: 'Keep me posted' })).toBeDisabled()
  await page.unroute(scriptUrl)
  await page.route(scriptUrl, route => route.fulfill({ contentType: 'application/javascript', body: widget }))
  await page.getByRole('button', { name: 'Retry verification' }).click()
  await fill(page)
  await expect(page.getByRole('button', { name: 'Keep me posted' })).toBeEnabled()
})

test('rate limits and malformed success responses never show success', async ({ page }) => {
  let attempts = 0
  await page.route(endpoint, route => {
    attempts++
    return route.fulfill({ status: attempts === 1 ? 429 : 200, json: {} })
  })
  await page.goto('/')
  await fill(page)
  await page.getByRole('button', { name: 'Keep me posted' }).click()
  await expect(page.getByRole('alert')).toContainText('wait a minute')
  await page.getByRole('button', { name: 'Keep me posted' }).click()
  await expect(page.getByRole('alert')).toContainText('couldn’t confirm')
  await expect(page.getByLabel('Email address', { exact: true })).toHaveValue('reader@example.com')
})

test('email has native validation, keyboard order excludes the decoy, and the page fits', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.getByLabel('Email address', { exact: true }).fill('invalid')
  await page.getByRole('button', { name: 'Keep me posted' }).click()
  expect(await page.getByLabel('Email address', { exact: true }).evaluate((input: HTMLInputElement) => input.validity.typeMismatch)).toBe(true)
  await page.getByLabel('Email address', { exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Keep me posted' })).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('signup.png'), fullPage: true })
})

test('without JavaScript the page explains why signup is unavailable', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto('http://127.0.0.1:4173')
  await expect(page.locator('noscript')).toBeVisible()
  expect(await page.locator('noscript').textContent()).toContain('Please enable JavaScript to sign up')
  await expect(page.getByRole('button', { name: 'Keep me posted' })).toBeDisabled()
  await context.close()
})
