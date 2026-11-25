import 'dotenv/config'
import mongoose from 'mongoose'
import { connectDatabase } from '../src/config/db.js'
import { migrateLegacyRoomBeds } from '../src/services/roomBeds.js'

try {
  await connectDatabase()
  const report = await migrateLegacyRoomBeds({ dryRun: !process.argv.includes('--apply') })
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  console.error(`O‘rinlarni raqamlash bajarilmadi: ${error.message}`)
  process.exitCode = 1
} finally {
  await mongoose.disconnect()
}
