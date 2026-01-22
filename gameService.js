import { db } from './firestore.js'
import { fetchCrashHistory } from './playwright.js'

const cache = new Set() // in-memory dedupe

export async function pollAndSave(onNewGames) {
  const result = await fetchCrashHistory()
  const list = result?.data?.list || []

  const newGames = []

  for (const game of list) {
    if (cache.has(game.gameId)) continue

    const ref = db.collection('crash_games').doc(String(game.gameId))
    const snap = await ref.get()

    if (snap.exists) {
      cache.add(game.gameId)
      continue
    }

    const detail = JSON.parse(game.gameDetail)

    const data = {
      gameId: game.gameId,
      rate: detail.rate,
      hash: detail.hash,
      beginTime: detail.beginTime,
      endTime: detail.endTime,
      createdAt: Date.now()
    }

    await ref.set(data)

    cache.add(game.gameId)
    newGames.push(data)
  }

  if (newGames.length) {
    console.log(`💾 New games saved: ${newGames.length}`)
    onNewGames(newGames)
  }
}
