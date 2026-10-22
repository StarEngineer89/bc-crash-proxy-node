import 'dotenv/config';
import { chromium } from 'playwright'

let browser
let context
let page

// Latest JPEG frame
let latestFrame = null

// Streaming state
let streaming = false

// Throttle for debug screenshots
let lastDebugShotAt = 0

const URL = 'https://bc.fun/game/crash';

async function closeBrowser() {
  try { await browser?.close() } catch {}
  browser = context = page = null
}

async function openHistoryTab() {
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

export async function initBrowser() {
  await closeBrowser()

  browser = await chromium.launch({
    headless: true,
    proxy: {
      server: process.env.PROXY_URL,
      username: process.env.PROXY_USERNAME,
      password: process.env.PROXY_PASSWORD
    }
  })

  browser.on('disconnected', () => {
    console.error('Browser disconnected')
    browser = context = page = null
  })

  context = await browser.newContext({
    viewport: {
      width: 1400,
      height: 900
    }
  })

  page = await context.newPage()
  page.on('crash', () => console.error('Page crashed'))

  await page.goto(URL, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

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

    // Conventional HTML table rows.
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
}

export async function fetchCrashHistory() {
  if (!page || page.isClosed()) {
    throw new Error('Browser page is not available')
  }

  let results = await extractRows();

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

  results.sort((a, b) => a.gameId - b.gameId);

  if (results.length === 0) {
    console.error('No results extracted. Current URL:', page.url())

    // Throttle debug screenshots to once per 5 minutes
    if (Date.now() - lastDebugShotAt > 5 * 60 * 1000) {
      lastDebugShotAt = Date.now()
      try {
        await page.screenshot({ path: 'history-debug.png', fullPage: true });
        const visibleText = await page.locator('body').innerText();
        console.error(
          'Visible page text (first 2000 chars):\n',
          visibleText.slice(0, 2000)
        );
      } catch (err) {
        console.error('Debug capture failed:', err.message)
      }
    }

    throw new Error(
      'No history results found. Inspect history-debug.png and adjust selectors.'
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