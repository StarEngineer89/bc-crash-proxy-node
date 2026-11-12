import 'dotenv/config'
import { MongoClient } from 'mongodb'

const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017'
const DB_NAME = process.env.DB_NAME || 'crash_game'

let client
let db

export async function connectMongo() {
  if (db) return db

  client = new MongoClient(MONGO_URL)
  await client.connect()
  db = client.db(DB_NAME)
  console.log('🍃 MongoDB connected')

  const games = db.collection('crash_games')
  await games.createIndex({ gameId: -1 }, { unique: true }) // sorting + dedupe
  await games.createIndex({ createdAt: 1 })                 // /by-date queries

  return db
}

export async function closeMongo() {
  await client?.close()
  client = db = null
}
