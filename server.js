import express from 'express'
import http from 'http'
import cors from 'cors'

import { initBrowser } from './playwright.js'
import { pollAndSave } from './gameService.js'
import { startWSServer } from './wsServer.js'
import { db } from './firestore.js'

const app = express()
app.use(cors({ origin: '*' }))

const server = http.createServer(app)
const ws = startWSServer(server)

await initBrowser()

app.get('/api/games/init', async (req, res) => {
  try {
    const snapshot = await db
      .collection('crash_games')
      .orderBy('createdAt', 'asc')
      .limit(2000)
      .get()

    const data = snapshot.docs.map(doc => doc.data())

    res.json({
      success: true,
      data
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
