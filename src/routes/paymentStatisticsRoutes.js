import { Router } from 'express'
import { paymentStatisticsController } from '../controllers/paymentStatisticsController.js'
import { paymentBehaviorController } from '../controllers/paymentBehaviorController.js'
import { requireAuth } from '../middleware/auth.js'

export const paymentStatisticsRouter = Router()
paymentStatisticsRouter.get('/', requireAuth, paymentStatisticsController.list)
paymentStatisticsRouter.get('/behavior', requireAuth, paymentBehaviorController.list)
paymentStatisticsRouter.get('/room/:roomId', requireAuth, paymentStatisticsController.room)
