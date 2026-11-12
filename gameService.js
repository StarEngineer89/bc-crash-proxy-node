import { connectMongo } from './mongo.js'
import { fetchCrashHistory } from './playwright.js'

// Highest gameId stored so far, kept in memory to avoid a DB read every poll.
let latestGameId = null

async function loadLatestGameId(collection) {
  const [latest] = await collection
    .find({}, { projection: { gameId: 1 } })
    .sort({ gameId: -1 })
    .limit(1)
    .toArray()
  latestGameId = latest ? Number(latest.gameId) : 0
}

export async function pollAndSave(onNewGames) {
  const collection = (await connectMongo()).collection('crash_games')
  const list = await fetchCrashHistory() // sorted oldest -> newest

  if (latestGameId === null) await loadLatestGameId(collection)

  const newGames = list
    .filter(g => g.gameId > latestGameId)
    .map(g => ({
      gameId: g.gameId,
      rate: g.rate,
      hash: g.hash,
      createdAt: Date.now()
    }))

  if (!newGames.length) return

  try {
    await collection.insertMany(newGames, { ordered: false })
  } catch (err) {
    if (err.code !== 11000) throw err
    // Duplicates mean our cached id was stale; resync from the DB.
    await loadLatestGameId(collection)
    onNewGames(newGames)
    return
  }

  latestGameId = newGames[newGames.length - 1].gameId
  onNewGames(newGames)
}

// Latest `limit` games, oldest -> newest
export async function getLatestGames(limit = 10) {
  const collection = (await connectMongo()).collection('crash_games')
  const games = await collection
    .find({})
    .sort({ gameId: -1 })
    .limit(limit)
    .toArray()

  return games.reverse()
}
