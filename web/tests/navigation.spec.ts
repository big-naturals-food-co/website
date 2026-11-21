import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/challenges.cloudflare.com/**', route => route.abort())
})

test('navigation fits its viewport, traps focus, closes with Escape and restores focus', async ({ page }, testInfo) => {
  await page.goto('/')
  const trigger = page.getByRole('button', { name: 'Open navigation' })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Main navigation' })
  await expect(dialog).toBeVisible()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(dialog).toBeFocused()
  await expect(page.getByRole('button', { name: 'Close navigation' })).not.toBeFocused()
  await page.screenshot({ path: testInfo.outputPath('navigation.png') })
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Close navigation' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('link', { name: 'Goose Nibbles', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Close navigation' })).toBeFocused()
  const bounds = await dialog.boundingBox()
  const viewport = page.viewportSize()!
  expect(bounds).not.toBeNull()
  if (viewport.width < 768) {
    expect(bounds!.width).toBe(viewport.width)
    expect(bounds!.height).toBe(viewport.height)
  } else {
    expect(bounds!.width).toBeLessThan(400)
    expect(bounds!.x).toBeGreaterThan(viewport.width / 2)
  }
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(trigger).toBeFocused()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('html')).not.toHaveClass('navigation-open')
})

test('home navigation closes and lands on the home page', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('link', { name: 'Home', exact: true }).click()
  await expect(page).toHaveURL('http://127.0.0.1:4173/')
  await expect(page.getByRole('dialog')).not.toBeVisible()
})

test('pointer dismissal leaves the hamburger unfocused, keyboard dismissal returns focus', async ({ page }) => {
  await page.goto('/')
  const trigger = page.getByRole('button', { name: 'Open navigation' })
  const dialog = page.getByRole('dialog', { name: 'Main navigation' })
  await trigger.click()
  await page.getByRole('button', { name: 'Close navigation' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(trigger).not.toBeFocused()

  if (page.viewportSize()!.width >= 768) {
    await trigger.click()
    await page.mouse.click(10, 200)
    await expect(dialog).not.toBeVisible()
    await expect(trigger).not.toBeFocused()
  }

  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect(dialog).toBeFocused()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await expect(dialog).not.toBeVisible()
  await expect(trigger).toBeFocused()
})
