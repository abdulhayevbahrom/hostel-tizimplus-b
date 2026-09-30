import { Router } from 'express'
import { paymentController } from '../controllers/paymentController.js'
import { ownerOnly, requireAuth } from '../middleware/auth.js'

export const paymentRouter = Router()
paymentRouter.use(requireAuth)
paymentRouter.get('/', paymentController.list)
paymentRouter.get('/options', paymentController.options)
paymentRouter.get('/advance', paymentController.advance)
paymentRouter.get('/student/:studentId', paymentController.studentProfile)
paymentRouter.post('/', paymentController.create)
paymentRouter.put('/:id', ownerOnly, paymentController.update)
paymentRouter.delete('/:id', ownerOnly, paymentController.remove)
