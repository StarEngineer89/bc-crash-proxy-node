import { chromium } from 'playwright'

let page

export async function initBrowser() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  page = await context.newPage()

  await page.goto('https://bc.game/game/crash', {
    waitUntil: 'networkidle'
  })

  console.log('✅ Playwright ready')
}

export async function fetchCrashHistory() {
  return page.evaluate(async () => {
    const res = await fetch(
      'https://bc.game/api/game/bet/multi/history',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          gameUrl: 'crash',
          page: 1,
          pageSize: 20
        })
      }
    )
    return res.json()
  })
}
