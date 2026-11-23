import { Router } from 'express'
import { dashboardController } from '../controllers/dashboardController.js'
import { requireAuth } from '../middleware/auth.js'

export const dashboardRouter = Router()
dashboardRouter.get('/student-counts', requireAuth, dashboardController.studentCounts)
dashboardRouter.get('/', requireAuth, dashboardController.get)
