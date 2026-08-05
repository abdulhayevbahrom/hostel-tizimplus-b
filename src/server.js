import 'dotenv/config'
import { createServer } from 'node:http'
import { Server } from 'socket.io'
import { app } from './app.js'
import { connectDatabase } from './config/db.js'
import { scheduleDailyContractSync, syncContractStatuses } from './utils/contractStatus.js'

const port = Number(process.env.PORT || 5000)
const httpServer = createServer(app)
const allowedOrigins = process.env.FRONTEND_URL?.split(',') || ['http://localhost:5173']
const io = new Server(httpServer, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST', 'PUT', 'DELETE'] },
})

app.set('io', io)
io.on('connection', (socket) => {
  if (process.env.NODE_ENV !== 'production') console.log(`WebSocket ulandi: ${socket.id}`)
  socket.on('disconnect', () => {
    if (process.env.NODE_ENV !== 'production') console.log(`WebSocket uzildi: ${socket.id}`)
  })
})

try {
  await connectDatabase()
  await syncContractStatuses()
  scheduleDailyContractSync(io)
  httpServer.listen(port, () => console.log(`API va WebSocket http://localhost:${port} manzilida ishlamoqda`))
} catch (error) {
  console.error(`Server ishga tushmadi: ${error.message}`)
  process.exit(1)
}
