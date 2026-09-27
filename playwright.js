import { chromium } from 'playwright'

let browser
let context
let page

// Latest JPEG frame
let latestFrame = null

// Streaming state
let streaming = false

export async function initBrowser() {
  const browser = await chromium.launch({
    headless: true,
    proxy: {
      server: 'http://199.182.170.41:12323',
      username: '14a8cbf919640',
      password: '7e23aba218'
    }
  })
  // const context = await browser.newContext()
  context = await browser.newContext({
    viewport: {
      width: 1400,
      height: 900
    }
  })

  page = await context.newPage()

  await page.goto('https://playbc.fun/game/crash', {
    waitUntil: 'networkidle'
  })

  console.log('✅ Playwright ready')

  await preparePage()

  startStreaming()
}

export async function fetchCrashHistory() {
  const result = await page.evaluate(async () => {
    const res = await fetch(
      'https://playbc.fun/api/game/bet/multi/history',
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

  // 🔽 Sort by gameId ASC
  if (result?.data?.list) {
    result.data.list.sort(
      (a, b) => Number(a.gameId) - Number(b.gameId)
    )
  }

  return result
}

async function preparePage() {

  await page.addStyleTag({
    content: `
      .dialog-root,
      .dialog-title,
      .header,
      .footer,
      .chat-room,
      .announcement,
      .popup,
      .modal{
          display:none !important;
      }

      body{
          overflow:hidden !important;
          zoom: 0.5
      }
    `
  })

}

async function startStreaming() {

  if (streaming) return

  streaming = true

  while (true) {

    try {
      const game = page.locator('.crash-game')
      latestFrame = await page.screenshot({
        type: 'jpeg',
        quality: 60,
        clip: {
          x: 500,
          y: 60,
          width: 300,
          height: 150
        }
      })

    }
    catch(err){

      console.error(err)

    }

    await new Promise(r => setTimeout(r, 200))

  }

}

export function getLatestFrame(){

    return latestFrame

}