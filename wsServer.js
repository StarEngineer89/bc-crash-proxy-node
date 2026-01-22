import { WebSocketServer } from 'ws'
import { db } from './firestore.js'

export function startWSServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer })

  wss.on('connection', async ws => {
    console.log('🔌 Client connected')

    // Send latest 20 games on connect
    const snap = await db
      .collection('crash_games')
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get()

    ws.send(JSON.stringify({
      type: 'init',
      data: snap.docs.map(d => d.data())
    }))
  })

  return {
    broadcast(data) {
      const msg = JSON.stringify({
        type: 'update',
        data
      })

      wss.clients.forEach(client => {
        if (client.readyState === 1) {
          client.send(msg)
        }
      })
    }
  }
}
