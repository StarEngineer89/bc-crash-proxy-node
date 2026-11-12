import 'dotenv/config'
import express from 'express'
import http from 'http'
import cors from 'cors'

import { initBrowser, restartBrowser, closeBrowser } from './playwright.js'
import { pollAndSave, getLatestGames } from './gameService.js'
import { startWSServer } from './wsServer.js'
import { connectMongo, closeMongo } from './mongo.js'

const PORT = Number(process.env.PORT) || 3000

// Polling / watchdog settings
const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 15000
const MAX_FAILURES = 5
const STALE_AFTER_MS = 2 * 60 * 1000              // no new game for 2 min => stale page
const SCHEDULED_RESTART_MS = 6 * 60 * 60 * 1000   // periodic restart to avoid memory growth
const RESTART_BACKOFF_START_MS = 5000
const RESTART_BACKOFF_MAX_MS = 5 * 60 * 1000

const INIT_LIMIT = 2000
const BY_DATE_LIMIT = 10000

process.on('unhandledRejection', err => {
  console.error('Unhandled rejection:', err)
})
process.on('uncaughtException', err => {
  console.error('Uncaught exception:', err)
  process.exit(1) // let pm2/systemd restart us in a clean state
})

//-------------------------------------------------
// HTTP + WebSocket
//-------------------------------------------------

const mongo = await connectMongo()
const games = mongo.collection('crash_games')

const app = express()
app.use(cors({ origin: '*' }))

const server = http.createServer(app)
const ws = startWSServer(server, () => getLatestGames(10))

app.get('/api/games/init', async (req, res) => {
  try {
    const data = await games
      .find({})
      .sort({ gameId: -1 })
      .limit(INIT_LIMIT)
      .toArray()

    res.json({ success: true, data: data.reverse() }) // ASC for frontend
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

app.get('/api/games/by-date', async (req, res) => {
  try {
    const start = new Date(req.query.startDate).getTime()
    const end = new Date(req.query.endDate).getTime()

    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
      return res.status(400).json({
        success: false,
        message: 'startDate and endDate must be valid dates with startDate <= endDate'
      })
    }

    const data = await games
      .find({ createdAt: { $gte: start, $lte: end } })
      .sort({ gameId: 1 })
      .limit(BY_DATE_LIMIT)
      .toArray()

    res.json({ success: true, data })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// Listen first; the browser comes up in the background.
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`)
})

//-------------------------------------------------
// Polling loop with watchdog
//-------------------------------------------------

let failures = 0
let lastNewGameAt = Date.now()
let lastRestartAt = Date.now()
let restartBackoffMs = RESTART_BACKOFF_START_MS
let nextRestartAllowedAt = 0
let pollTimer
let shuttingDown = false

const withTimeout = (promise, ms) => {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('poll timeout')), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

async function maybeRestartBrowser() {
  const now = Date.now()
  if (now < nextRestartAllowedAt) return

  const stale = now - lastNewGameAt > STALE_AFTER_MS
  const scheduled = now - lastRestartAt > SCHEDULED_RESTART_MS
  if (failures < MAX_FAILURES && !stale && !scheduled) return

  const reason =
    failures >= MAX_FAILURES ? 'too many failures'
    : stale ? 'no new games (stale page)'
    : 'scheduled restart'
  console.warn(`Restarting browser: ${reason}`)

  try {
    await restartBrowser()
    failures = 0
    lastNewGameAt = lastRestartAt = Date.now()
    restartBackoffMs = RESTART_BACKOFF_START_MS
  } catch (err) {
    console.error('Restart failed:', err.message)
    nextRestartAllowedAt = Date.now() + restartBackoffMs
    restartBackoffMs = Math.min(restartBackoffMs * 2, RESTART_BACKOFF_MAX_MS)
  }
}

async function tick() {
  try {
    let hasNew = false

    await withTimeout(
      pollAndSave(() => {
        lastNewGameAt = Date.now()
        hasNew = true
      }),
      POLL_TIMEOUT_MS
    )

    if (hasNew) ws.broadcast(await getLatestGames(10))
    failures = 0
  } catch (err) {
    failures++
    console.error(`Poll failed (${failures}):`, err.message)
  }

  await maybeRestartBrowser()

  // Schedule the next run only after this one finishes (no overlapping polls)
  if (!shuttingDown) pollTimer = setTimeout(tick, POLL_INTERVAL_MS)
}

// Initial launch must not block the server; the watchdog retries on failure.
initBrowser()
  .catch(err => console.error('Initial browser launch failed:', err.message))
  .finally(() => {
    lastNewGameAt = lastRestartAt = Date.now()
    tick()
  })

//-------------------------------------------------
// Graceful shutdown
//-------------------------------------------------

async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`${signal} received, shutting down...`)

  clearTimeout(pollTimer)
  ws.close()
  server.close()
  await closeBrowser()
  await closeMongo()
  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
