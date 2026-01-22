import admin from 'firebase-admin'
import fs from 'fs'
import path from 'path'

const serviceAccount = JSON.parse(
  // fs.readFileSync(path.resolve('./serviceAccountKey.json'), 'utf8')
  process.env.FIREBASE_SERVICE_ACCOUNT
)

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
})

export const db = admin.firestore()
