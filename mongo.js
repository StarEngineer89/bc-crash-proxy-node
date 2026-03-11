import { MongoClient } from 'mongodb'

const MONGO_URL = 'mongodb://127.0.0.1:27017'
const DB_NAME = 'crash_game'

let db

export async function connectMongo() {
  if (db) return db

  const client = new MongoClient(MONGO_URL)
  await client.connect()

  db = client.db(DB_NAME)
  console.log('🍃 MongoDB connected')

  // index for fast sorting & dedupe
  await db.collection('crash_games').createIndex(
    { gameId: -1 },
    { unique: true }
  )

  return db
}
