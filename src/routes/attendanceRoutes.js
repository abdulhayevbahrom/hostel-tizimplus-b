import { Router } from 'express'
import { attendanceController } from '../controllers/attendanceController.js'
import { requireAuth } from '../middleware/auth.js'

export const attendanceRouter = Router()
attendanceRouter.use(requireAuth)
attendanceRouter.get('/history', attendanceController.historyList)
attendanceRouter.get('/history/:studentId', attendanceController.history)
attendanceRouter.get('/', attendanceController.list)
attendanceRouter.put('/', attendanceController.save)
