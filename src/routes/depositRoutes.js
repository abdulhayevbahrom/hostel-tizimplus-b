import { Router } from 'express'
import { depositController } from '../controllers/depositController.js'
import { ownerOnly, requireAuth } from '../middleware/auth.js'

export const depositRouter = Router()
depositRouter.use(requireAuth)
depositRouter.get('/', depositController.list)
depositRouter.get('/:contractId/history', depositController.history)
depositRouter.put('/refunds/:id', ownerOnly, depositController.refund)
depositRouter.delete('/refunds/:id', ownerOnly, depositController.refund)
depositRouter.post('/:contractId/refunds', ownerOnly, depositController.refund)
depositRouter.put('/:contractId', ownerOnly, depositController.update)
depositRouter.delete('/:contractId', ownerOnly, depositController.update)
