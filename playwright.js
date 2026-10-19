import 'dotenv/config';
import { chromium } from 'playwright'

let browser
let context
let page

// Latest JPEG frame
let latestFrame = null

// Streaming state
let streaming = false

const URL = 'https://bc.fun/game/crash';

export async function initBrowser() {
  const browser = await chromium.launch({
    headless: true,
    proxy: {
      server: process.env.PROXY_URL,
      username: process.env.PROXY_USERNAME,
      password: process.env.PROXY_PASSWORD
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

  // await page.goto(URL, {
  //   waitUntil: 'networkidle'
  // })
  await page.goto(URL, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  console.log('✅ Playwright ready')

  await preparePage()

  // Find and click the History tab.
  const historyTab = page.getByText('History', { exact: true }).first();
  await historyTab.waitFor({ state: 'visible', timeout: 20000 });

  // Only click if History is not already selected.
  const isSelected =
    (await historyTab.getAttribute('aria-selected')) === 'true';

  if (!isSelected) {
    await historyTab.click({ timeout: 10000 });
  }

  // Allow the history content to render.
  await page.waitForTimeout(3000);
}

// export async function fetchCrashHistory() {
//   const result = await page.evaluate(async () => {
//     const res = await fetch(
//       'https://playbc.fun/api/game/bet/multi/history',
//       {
//         method: 'POST',
//         headers: {
//           'Content-Type': 'application/json',
//           'Accept': 'application/json'
//         },
//         body: JSON.stringify({
//           gameUrl: 'crash',
//           page: 1,
//           pageSize: 20
//         })
//       }
//     )
//     return res.json()
//   })

//   // 🔽 Sort by gameId ASC
//   if (result?.data?.list) {
//     result.data.list.sort(
//       (a, b) => Number(a.gameId) - Number(b.gameId)
//     )
//   }

//   return result
// }

export async function fetchCrashHistory() {
  const results = await page.evaluate(() => {
      const output = [];
      const seen = new Set();

      function addResult(gameId, result, hashString) {
        if (!gameId || !result) return;

        const id = String(gameId).replace(/,/g, '');
        const rate = String(result).replace(/,/g, '');
        const hash = String(hashString).replace(/,/g, '');

        if (!/^\d+$/.test(id)) return;
        if (!/^\d+(?:\.\d+)?\s*x?$/i.test(rate)) return;

        const numericRate = Number(rate.replace(/x$/i, ''));
        if (!Number.isFinite(numericRate) || numericRate <= 0) return;

        const key = `${id}:${numericRate}`;
        if (seen.has(key)) return;
        seen.add(key);

        output.push({
          gameId: Number(id),
          rate: numericRate,
          hash: hash
        });
      }

      // Strategy 1: conventional HTML table rows.
      for (const row of document.querySelectorAll(
        '.tabs-content div.grid'
      )) {
        const cells = row.children;

        if (cells.length < 3) continue;

        // Game ID is nested inside the first cell.
        const idElement = cells[0].querySelector(
          'span.hover\\:underline'
        );

        const id = idElement?.innerText.trim().replace(/,/g, '');

        // Multiplier is the text in the second cell.
        const rate = cells[1].innerText.trim().replace(/,/g, '');

        const hash = cells[2].innerText.trim().replace(/,/g, '');
        if (id && rate && hash) addResult(id, rate, hash);
      }

      return output;
    });

    results.sort((a, b) => a.gameId - b.gameId);

    if (results.length === 0) {
      await page.screenshot({ path: 'history-debug.png', fullPage: true });
      const visibleText = await page.locator('body').innerText();
      console.error(
        'No results extracted. Visible page text (first 8000 chars):\\n',
        visibleText.slice(0, 8000)
      );
      throw new Error(
        'No history results found. Inspect history-debug.png and adjust selectors in scraper.js.'
      );
    }

    return results;
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