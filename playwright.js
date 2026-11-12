import 'dotenv/config'
import { chromium } from 'playwright'

const TARGET_URL = process.env.TARGET_URL || 'https://bc.fun/game/crash'
const DEBUG_SHOT_INTERVAL_MS = 5 * 60 * 1000

let browser
let context
let page
let lastDebugShotAt = 0

export async function closeBrowser() {
  try { await browser?.close() } catch {}
  browser = context = page = null
}

async function openHistoryTab() {
  const historyTab = page.getByText('History', { exact: true }).first()
  await historyTab.waitFor({ state: 'visible', timeout: 20000 })

  const isSelected = (await historyTab.getAttribute('aria-selected')) === 'true'
  if (!isSelected) await historyTab.click({ timeout: 10000 })

  // Allow the history content to render.
  await page.waitForTimeout(3000)
}

async function removePopOverlayer() {
  try {
    const removed = await page.evaluate(() => {
      const els = document.querySelectorAll('.pop-overlayer')
      els.forEach(el => el.remove())
      return els.length
    })
    if (removed > 0) console.log(`🧹 Removed ${removed} .pop-overlayer element(s)`)
  } catch (err) {
    console.error('Failed to remove .pop-overlayer:', err.message)
  }
}

async function preparePage() {
  await removePopOverlayer()

  await page.addStyleTag({
    content: `
      .dialog-root, .dialog-title, .header, .footer,
      .chat-room, .announcement, .popup, .modal {
        display: none !important;
      }
      body {
        overflow: hidden !important;
        zoom: 0.5;
      }
    `
  })
}

export async function initBrowser() {
  await closeBrowser()

  const launchOptions = { headless: true }
  if (process.env.PROXY_URL) {
    launchOptions.proxy = {
      server: process.env.PROXY_URL,
      username: process.env.PROXY_USERNAME,
      password: process.env.PROXY_PASSWORD
    }
  }

  browser = await chromium.launch(launchOptions)
  browser.on('disconnected', () => {
    console.error('Browser disconnected')
    browser = context = page = null
  })

  context = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  page = await context.newPage()
  page.on('crash', () => console.error('Page crashed'))

  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })

  await preparePage()
  await openHistoryTab()

  console.log('✅ Playwright ready')
}

export async function restartBrowser() {
  console.warn('♻️ Restarting browser')
  await initBrowser()
}

async function extractRows() {
  return page.evaluate(() => {
    const output = []
    const seen = new Set()

    for (const row of document.querySelectorAll('.tabs-content div.grid')) {
      const cells = row.children
      if (cells.length < 3) continue

      // Game ID is nested inside the first cell.
      const id = cells[0]
        .querySelector('span.hover\\:underline')
        ?.innerText.trim().replace(/,/g, '')
      const rate = cells[1].innerText.trim().replace(/,/g, '')
      const hash = cells[2].innerText.trim().replace(/,/g, '')

      if (!id || !rate || !hash) continue
      if (!/^\d+$/.test(id)) continue
      if (!/^\d+(?:\.\d+)?\s*x?$/i.test(rate)) continue

      const numericRate = Number(rate.replace(/x$/i, ''))
      if (!Number.isFinite(numericRate) || numericRate <= 0) continue

      const key = `${id}:${numericRate}`
      if (seen.has(key)) continue
      seen.add(key)

      output.push({ gameId: Number(id), rate: numericRate, hash })
    }

    return output
  })
}

async function captureDebugInfo() {
  if (Date.now() - lastDebugShotAt < DEBUG_SHOT_INTERVAL_MS) return
  lastDebugShotAt = Date.now()

  try {
    await page.screenshot({ path: 'history-debug.png', fullPage: true })
    const text = await page.locator('body').innerText()
    console.error('Visible page text (first 2000 chars):\n', text.slice(0, 2000))
  } catch (err) {
    console.error('Debug capture failed:', err.message)
  }
}

// Returns rows sorted oldest -> newest.
export async function fetchCrashHistory() {
  if (!page || page.isClosed()) {
    throw new Error('Browser page is not available')
  }

  let results = await extractRows()

  // History tab may have been lost (reload/navigation) - try to recover once.
  if (results.length === 0) {
    try {
      await preparePage()
      await openHistoryTab()
      results = await extractRows()
    } catch (err) {
      console.error('History tab recovery failed:', err.message)
    }
  }

  if (results.length === 0) {
    console.error('No results extracted. Current URL:', page.url())
    await captureDebugInfo()
    throw new Error('No history results found. Inspect history-debug.png and adjust selectors.')
  }

  return results.sort((a, b) => a.gameId - b.gameId)
}
