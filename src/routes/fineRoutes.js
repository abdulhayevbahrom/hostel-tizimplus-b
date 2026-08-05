import { Router } from 'express'
import { fineController } from '../controllers/fineController.js'
import { requireAuth, strictOwnerOnly } from '../middleware/auth.js'

export const fineRouter = Router()
fineRouter.use(requireAuth)
fineRouter.get('/', fineController.list)
fineRouter.get('/options', fineController.options)
fineRouter.get('/student/:studentId', fineController.studentProfile)
fineRouter.post('/', fineController.create)
fineRouter.get('/:id/payments', fineController.payments)
fineRouter.post('/:id/payments', fineController.pay)
fineRouter.put('/:id', strictOwnerOnly, fineController.update)
fineRouter.delete('/:id', strictOwnerOnly, fineController.remove)
