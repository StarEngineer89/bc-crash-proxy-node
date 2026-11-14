import 'dotenv/config'
import { chromium } from 'playwright'
import { connectMongo } from './mongo.js'

const VERIFY_URL =
  process.env.VERIFY_URL || 'https://game-verify.github.io/public/crash.html'
const CHECK_LIMIT = 1000                                  // most recent records to inspect
const MAX_GAP_SIZE = Number(process.env.MAX_GAP_SIZE) || 5000
const ROWS_SELECTOR = 'tbody.game_verify_table tr'

const sameHash = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

/**
 * games: sorted ascending by gameId.
 * Returns gaps newest-first. For records ... 9784756, 9784796 ... the gap is
 *   { fromId: 9784756, fromHash, toId: 9784796, toHash }
 */
export function findGaps(games) {
  const gaps = []
  for (let i = 1; i < games.length; i++) {
    const prev = games[i - 1]
    const next = games[i]
    if (next.gameId - prev.gameId > 1) {
      gaps.push({
        fromId: prev.gameId,
        fromHash: prev.hash,
        toId: next.gameId,
        toHash: next.hash
      })
    }
  }
  return gaps.reverse()
}

// Load the verify page for (hash, gameId) and read the result table.
// The table has no gameId column: row 0 is the starting game (ignored by the
// caller) and every following row is the previous game (gameId counts down).
async function fetchVerifyRows(page, hash, gameId) {
  const url = `${VERIFY_URL}?hash=${encodeURIComponent(hash)}&v=${gameId}&he=1`
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })

  await page.waitForFunction(
    sel => document.querySelectorAll(sel).length > 0,
    ROWS_SELECTOR,
    { timeout: 30000 }
  )

  // Rows are rendered by JS; wait until the row count stops changing.
  let previous = -1
  for (let i = 0; i < 20; i++) {
    const count = await page.locator(ROWS_SELECTOR).count()
    if (count === previous) break
    previous = count
    await page.waitForTimeout(500)
  }

  return page.evaluate(sel => {
    const rows = []
    for (const tr of document.querySelectorAll(sel)) {
      const cells = tr.querySelectorAll('td')
      if (cells.length < 2) continue
      rows.push({
        hash: cells[0].innerText.trim(),
        bust: cells[1].innerText.trim()
      })
    }
    return rows
  }, ROWS_SELECTOR)
}

// Walk the hash chain from `toId` down to `fromId`, returning Map<gameId, row>.
// Row 0 of every page is the game we started from (already stored), so it is
// ignored; row i (i >= 1) is gameId (start - i).
async function collectGap(page, gap) {
  const collected = new Map()
  let curId = gap.toId
  let curHash = gap.toHash

  while (!collected.has(gap.fromId)) {
    const rows = await fetchVerifyRows(page, curHash, curId)

    if (!sameHash(rows[0]?.hash, curHash)) {
      throw new Error(`first row is not game ${curId}; unexpected page layout`)
    }
    if (rows.length < 2) throw new Error(`no rows after game ${curId}`)

    for (let i = 1; i < rows.length; i++) {
      const id = curId - i
      if (id < gap.fromId) break
      collected.set(id, rows[i])
    }

    // Page returned fewer rows than needed: continue from its last row.
    const last = rows.length - 1
    curId -= last
    curHash = rows[last].hash
  }

  return collected
}

async function fillGap(page, collection, gap) {
  const size = gap.toId - gap.fromId - 1
  if (size > MAX_GAP_SIZE) {
    console.warn(`⚠️ Gap ${gap.fromId}..${gap.toId} is ${size} games (> ${MAX_GAP_SIZE}), skipping`)
    return 0
  }

  console.log(`🔎 Filling gap: ${size} missing game(s) between ${gap.fromId} and ${gap.toId}`)
  const collected = await collectGap(page, gap)

  // Integrity check: the chain must land exactly on the record we already have.
  if (!sameHash(collected.get(gap.fromId)?.hash, gap.fromHash)) {
    throw new Error(`hash chain does not match stored game ${gap.fromId}; nothing saved`)
  }

  const docs = []
  for (let id = gap.fromId + 1; id < gap.toId; id++) {
    const row = collected.get(id)
    const rate = Number(row?.bust.replace(/[,x\s]/gi, ''))
    if (!row || !Number.isFinite(rate) || rate <= 0) {
      throw new Error(`missing or invalid row for game ${id}; nothing saved`)
    }
    docs.push({ gameId: id, rate, hash: row.hash, createdAt: Date.now(), backfilled: true })
  }

  try {
    await collection.insertMany(docs, { ordered: false })
  } catch (err) {
    if (err.code !== 11000) throw err // duplicates are fine
  }

  console.log(`✅ Filled ${docs.length} game(s) in ${gap.fromId}..${gap.toId}`)
  return docs.length
}

// Returns the number of games inserted.
export async function checkAndFillGaps() {
  const collection = (await connectMongo()).collection('crash_games')

  const recent = await collection
    .find({})
    .sort({ gameId: -1 })
    .limit(CHECK_LIMIT)
    .toArray()
  recent.reverse()

  const gaps = findGaps(recent)
  if (!gaps.length) {
    console.log(`✅ No gameId gaps in the latest ${recent.length} records`)
    return 0
  }
  console.warn(`⚠️ Found ${gaps.length} gap(s) in the latest ${recent.length} records`)

  const browser = await chromium.launch({ headless: true })
  let inserted = 0
  try {
    const page = await (await browser.newContext()).newPage()
    for (const gap of gaps) {
      try {
        inserted += await fillGap(page, collection, gap)
      } catch (err) {
        console.error(`Gap ${gap.fromId}..${gap.toId} failed:`, err.message)
      }
    }
  } finally {
    await browser.close().catch(() => {})
  }

  return inserted
}