import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { test, expect } from '@playwright/test'
import { landingRequestCode } from '../../cloud/aws/lib/landing-request'
import { publicationPlan, verifySite } from '../../cloud/aws/lib/publication'
import project from '../../cloud/aws/project.json' with { type: 'json' }
import signup from '../../cloud/signup.json' with { type: 'json' }
import manifest from '../data/goose-nibbles.json' with { type: 'json' }

const directory = fileURLToPath(new URL('../.output/public/', import.meta.url))
const origin = `https://${project.domainName}`
const handler = runInNewContext(`${landingRequestCode(project.domainName)}; handler`)
const files = new Map(publicationPlan(directory).map(file => [file.key, file]))

function generatedResponse(input: string) {
  const url = new URL(input)
  const request = { uri: url.pathname, method: 'GET', headers: { host: { value: url.hostname } }, querystring: {} }
  const result = handler({ request })
  if (result.statusCode) return new Response(null, { status: result.statusCode, headers: { location: result.headers.location.value } })
  const file = files.get(result.uri === '/' ? 'index.html' : result.uri.slice(1))
  if (!file) return new Response('Missing asset', { status: 404 })
  return new Response(readFileSync(file.file), { headers: { 'content-type': file.contentType } })
}

test('generated artifact matches edge routing, pages, payloads, and assets', async () => {
  await verifySite(directory, project, async input => generatedResponse(String(input)))
})

test('production pages hydrate, navigate, and submit with production configuration', async ({ context, page }, testInfo) => {
  const failures: string[] = []
  let submissions = 0
  page.on('pageerror', error => failures.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error' || /hydration/i.test(message.text())) failures.push(message.text())
  })
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.hostname === 'challenges.cloudflare.com') {
      return route.fulfill({ contentType: 'application/javascript', body: `
        window.turnstile = {
          render(element, options) {
            window.checkedSiteKey = options.sitekey;
            setTimeout(() => options.callback('generated-test-token'), 0);
            return 'widget';
          },
          remove() {}
        };
        window.bigNaturalsTurnstileLoaded();
      ` })
    }
    if (url.origin === `https://api.${project.domainName}`) {
      expect(url.pathname).toBe('/subscribe')
      expect(route.request().postDataJSON()).toMatchObject({ email: 'reader@example.com', consent: true })
      submissions++
      return route.fulfill({ json: { accepted: true } })
    }
    expect([project.domainName, ...project.redirectDomainNames]).toContain(url.hostname)
    const response = generatedResponse(url.href)
    if (response.status >= 400) failures.push(`${response.status} ${url.pathname}`)
    return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) })
  })
  for (const path of ['/', '/goose-nibbles']) {
    await page.goto(origin + path)
    await page.evaluate(() => document.fonts.ready)
    await expect(page.getByRole('button', { name: 'Keep me posted' })).toBeEnabled()
    expect(await page.evaluate(() => (window as any).checkedSiteKey)).toBe(signup.turnstileSiteKey)
    for (const image of await page.locator('img').all()) {
      await image.scrollIntoViewIfNeeded()
      await image.evaluate((element: HTMLImageElement) => element.decode())
    }
    if (path === '/goose-nibbles') {
      for (const flavor of manifest.flavors) {
        await expect(page.getByRole('region', { name: flavor.name, exact: true }).locator('.flavor-ingredients')).toHaveText(`Ingredients: ${flavor.ingredients.join(', ')}.`)
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(path === '/' ? 'generated-home.png' : 'generated-goose-nibbles.png'), fullPage: true })
    await page.getByLabel('Email address', { exact: true }).fill('reader@example.com')
    await page.getByRole('button', { name: 'Keep me posted' }).click()
    await expect(page.getByRole('status')).toContainText('Your signup request is received')
    await page.getByRole('button', { name: 'Open navigation' }).click()
    await page.getByRole('link', { name: path === '/' ? 'Goose Nibbles' : 'Home', exact: true }).click()
    await expect(page).toHaveURL(origin + (path === '/' ? '/goose-nibbles' : '/'))
  }
  expect(submissions).toBe(2)
  expect(failures).toEqual([])
})
