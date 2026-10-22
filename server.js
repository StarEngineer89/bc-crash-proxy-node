import 'dotenv/config';
import express from 'express'
import http from 'http'
import cors from 'cors'

import { initBrowser, restartBrowser } from './playwright.js'
import { pollAndSave } from './gameService.js'
import { startWSServer } from './wsServer.js'
// import { db } from './firestore.js'
import { connectMongo } from './mongo.js'

// Log instead of crashing the whole process on stray errors
process.on('unhandledRejection', err => {
  console.error('Unhandled rejection:', err)
})
process.on('uncaughtException', err => {
  console.error('Uncaught exception:', err)
})

const app = express()
app.use(cors({ origin: '*' }))

const mongo = await connectMongo()

const server = http.createServer(app)
const ws = startWSServer(server)

// Don't let a failed first launch kill the server; the watchdog will retry
try {
  await initBrowser()
} catch (err) {
  console.error('Initial browser launch failed:', err.message)
}

app.get('/api/games/init', async (req, res) => {
  try {
    const games = await mongo
      .collection('crash_games')
      .find({})
      .sort({ gameId: -1 })
      .limit(2000)
      .toArray()

    // ASC order for frontend
    games.sort((a, b) => a.gameId - b.gameId)

    res.json({
      success: true,
      data: games
    })
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    })
  }
})

app.get('/api/games/by-date', async (req, res) => {
  try {
    const { startDate, endDate } = req.query

    const start = new Date(startDate).getTime()
    const end = new Date(endDate).getTime()

    const games = await mongo
      .collection('crash_games')
      .find({
        createdAt: {
          $gte: start,
          $lte: end
        }
      })
      .sort({ gameId: 1 })
      .toArray()

    res.json({
      success: true,
      data: games
    })
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    })
  }
})

//-------------------------------------------------
// Polling loop with watchdog
//-------------------------------------------------

const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 15000
const MAX_FAILURES = 5
const STALE_AFTER_MS = 2 * 60 * 1000          // no new game for 2 min => stale page
const SCHEDULED_RESTART_MS = 6 * 60 * 60 * 1000 // periodic restart to avoid memory growth

let failures = 0
let lastNewGameAt = Date.now()
let lastRestartAt = Date.now()

const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('poll timeout')), ms)
    )
  ])

async function tick() {
  try {
    await withTimeout(
      pollAndSave(newGames => {
        lastNewGameAt = Date.now()
        ws.broadcast(newGames)
      }),
      POLL_TIMEOUT_MS
    )
    failures = 0
  } catch (err) {
    failures++
    console.error(`Poll failed (${failures}):`, err.message)
  }

  const now = Date.now()
  const stale = now - lastNewGameAt > STALE_AFTER_MS
  const scheduled = now - lastRestartAt > SCHEDULED_RESTART_MS

  if (failures >= MAX_FAILURES || stale || scheduled) {
    const reason =
      failures >= MAX_FAILURES ? 'too many failures'
      : stale ? 'no new games (stale page)'
      : 'scheduled restart'
    console.warn(`Restarting browser: ${reason}`)

    try {
      await restartBrowser()
      failures = 0
      lastNewGameAt = Date.now()
      lastRestartAt = Date.now()
    } catch (err) {
      console.error('Restart failed:', err.message)
    }
  }

  // Schedule the next run only after this one finishes (no overlapping polls)
  setTimeout(tick, POLL_INTERVAL_MS)
}

tick()

server.listen(3000, () => {
  console.log('🚀 Server running on http://localhost:3000')
})