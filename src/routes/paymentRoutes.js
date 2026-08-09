import { Router } from 'express'
import { paymentController } from '../controllers/paymentController.js'
import { ownerOnly, requireAuth } from '../middleware/auth.js'

export const paymentRouter = Router()
paymentRouter.get('/', paymentController.list)
paymentRouter.get('/options', paymentController.options)
paymentRouter.get('/advance', requireAuth, paymentController.advance)
paymentRouter.get('/student/:studentId', requireAuth, paymentController.studentProfile)
paymentRouter.post('/', requireAuth, paymentController.create)
paymentRouter.put('/:id', requireAuth, ownerOnly, paymentController.update)
paymentRouter.delete('/:id', requireAuth, ownerOnly, paymentController.remove)
