import express from 'express'
import http from 'http'
import cors from 'cors'

import { initBrowser } from './playwright.js'
import { pollAndSave } from './gameService.js'
import { startWSServer } from './wsServer.js'
// import { db } from './firestore.js'
import { connectMongo } from './mongo.js'

const app = express()
app.use(cors({ origin: '*' }))

const mongo = await connectMongo()

const server = http.createServer(app)
const ws = startWSServer(server)

await initBrowser()

app.get('/api/games/init', async (req, res) => {
  try {
    const games = await mongo
      .collection('crash_games')
      .find({})
      .sort({ createdAt: -1 })
      .limit(2000)
      .toArray()

    // ASC order for frontend
    games.sort((a, b) => a.createdAt - b.createdAt)

    res.json({
      success: true,
      data: games   // ✅ FIX: use games, not data
    })
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    })
  }
})


setInterval(() => {
  pollAndSave(newGames => {
    ws.broadcast(newGames)
  }).catch(console.error)
}, 3000)

server.listen(3000, () => {
  console.log('🚀 Server running on http://localhost:3000')
})
