import { connectMongo } from './mongo.js'
import { fetchCrashHistory } from './playwright.js'

const cache = new Set()

export async function pollAndSave(onNewGames) {
  const mongo = await connectMongo()
  const collection = mongo.collection('crash_games')

  const result = await fetchCrashHistory()
  const list = result?.data?.list || []
  if (!list.length) return

  // get latest gameId
  const latest = await collection
    .find({})
    .sort({ gameId: -1 })
    .limit(1)
    .toArray()

  let latestGameId = latest.length ? Number(latest[0].gameId) : 0

  const newGames = []

  for (const game of list) {
    const gameId = Number(game.gameId)

    if (cache.has(gameId) || gameId <= latestGameId) continue

    const detail = JSON.parse(game.gameDetail)

    const data = {
      gameId,
      rate: detail.rate,
      hash: detail.hash,
      beginTime: detail.beginTime,
      endTime: detail.endTime,
      createdAt: Date.now()
    }

    try {
      await collection.insertOne(data)
      cache.add(gameId)
      newGames.push(data)
    } catch (err) {
      // ignore duplicate key errors
      if (err.code !== 11000) {
        console.error(err)
      }
    }
  }

  if (newGames.length) {
    onNewGames(newGames)
  }
}
