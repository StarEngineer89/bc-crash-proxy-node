import { WebSocketServer } from 'ws'

// getSnapshot: async () => games[]; sent to each client on connect.
export function startWSServer(server, getSnapshot) {
  const wss = new WebSocketServer({ server })

  wss.on('connection', async ws => {
    console.log('Client connected')
    ws.on('close', () => console.log('Client disconnected'))
    ws.on('error', err => console.error('WS client error:', err.message))

    try {
      const games = await getSnapshot()
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'games', data: games }))
      }
    } catch (err) {
      console.error('Snapshot failed:', err.message)
    }
  })

  wss.broadcast = games => {
    const msg = JSON.stringify({ type: 'games', data: games })
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(msg)
    }
  }

  return wss
}
