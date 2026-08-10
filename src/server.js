import 'dotenv/config'
import { createServer } from 'node:http'
import { Server } from 'socket.io'
import { app } from './app.js'
import { connectDatabase } from './config/db.js'
import { createContractExpiryNotification, createDebtorDeadlineNotification, scheduleDailyContractSync, syncContractStatuses } from './utils/contractStatus.js'
import { normalizeStoredPhoneNumbers } from './utils/normalizePhoneNumbers.js'
import { StudentContract } from './models/StudentContract.js'
import { Room } from './models/Room.js'
import { DebtorDeadline } from './models/DebtorDeadline.js'

const port = Number(process.env.PORT || 5000)
const httpServer = createServer(app)
const allowedOrigins = process.env.FRONTEND_URL?.split(',') || ['http://localhost:5173']
const io = new Server(httpServer, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST', 'PUT', 'DELETE'] },
})

app.set('io', io)

try {
  await connectDatabase()
  await normalizeStoredPhoneNumbers()
  await StudentContract.syncIndexes()
  await Room.syncIndexes()
  await DebtorDeadline.syncIndexes()
  await syncContractStatuses()
  await createContractExpiryNotification(io)
  await createDebtorDeadlineNotification(io)
  scheduleDailyContractSync(io)
  httpServer.listen(port, () => console.log(`API va WebSocket http://localhost:${port} manzilida ishlamoqda`))
} catch (error) {
  console.error(`Server ishga tushmadi: ${error.message}`)
  process.exit(1)
}
