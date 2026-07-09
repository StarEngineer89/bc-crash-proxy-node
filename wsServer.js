import { WebSocketServer } from 'ws'
import { getLatestFrame } from './playwright.js'

export function startWSServer(server) {

    const wss = new WebSocketServer({ server })

    wss.on('connection', ws => {
        console.log('Client connected')

        ws.on('close', () => {
            console.log('Client disconnected')
        })
    })

    //-------------------------------------------------
    // Broadcast new game results
    //-------------------------------------------------

    wss.broadcast = (games) => {

        const msg = JSON.stringify({
            type: 'games',
            data: games
        })

        wss.clients.forEach(client => {

            if (client.readyState === 1) {
                client.send(msg)
            }

        })

    }

    //-------------------------------------------------
    // Broadcast video frames
    //-------------------------------------------------

    wss.broadcastFrame = () => {

        const frame = getLatestFrame()

        if (!frame) return

        const msg = JSON.stringify({

            type: 'frame',

            data: frame.toString('base64')

        })

        wss.clients.forEach(client => {

            if (client.readyState === 1) {

                client.send(msg)

            }

        })

    }

    //-------------------------------------------------
    // 5 FPS
    //-------------------------------------------------

    setInterval(() => {

        wss.broadcastFrame()

    }, 200)

    return wss

}