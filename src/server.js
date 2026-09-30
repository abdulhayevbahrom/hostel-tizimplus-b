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
import { AuditLog } from './models/AuditLog.js'
import { allowedOrigins, isAllowedOrigin } from './config/origins.js'

const port = Number(process.env.PORT || 5000)
const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST', 'PUT', 'DELETE'] },
  allowRequest: (request, callback) => callback(null, isAllowedOrigin(request.headers.origin)),
})

app.set('io', io)

try {
  await connectDatabase()
  await normalizeStoredPhoneNumbers()
  await StudentContract.syncIndexes()
  await Room.syncIndexes()
  await DebtorDeadline.syncIndexes()
  await AuditLog.syncIndexes()
  await syncContractStatuses()
  await createContractExpiryNotification(io)
  await createDebtorDeadlineNotification(io)
  scheduleDailyContractSync(io)
  httpServer.listen(port, () => console.log(`API va WebSocket http://localhost:${port} manzilida ishlamoqda`))
} catch (error) {
  console.error(`Server ishga tushmadi: ${error.message}`)
  process.exit(1)
}
