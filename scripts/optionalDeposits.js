import 'dotenv/config'
import mongoose from 'mongoose'
import { connectDatabase } from '../src/config/db.js'
import { migrateOptionalDeposits } from '../src/services/migrateOptionalDeposits.js'
try {
  await connectDatabase()
  console.log(JSON.stringify(await migrateOptionalDeposits({ dryRun: !process.argv.includes('--apply') }), null, 2))
} catch (error) {
  console.error(`Depositlar yangilanmadi: ${error.message}`)
  process.exitCode = 1
} finally { await mongoose.disconnect() }
