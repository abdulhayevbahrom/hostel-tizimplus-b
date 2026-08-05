import { Router } from 'express'
import { expenseController } from '../controllers/expenseController.js'
import { requireAuth, strictOwnerOnly } from '../middleware/auth.js'

export const expenseRouter = Router()
expenseRouter.use(requireAuth)
expenseRouter.get('/', expenseController.list)
expenseRouter.post('/', expenseController.create)
expenseRouter.put('/:id', strictOwnerOnly, expenseController.update)
expenseRouter.delete('/:id', strictOwnerOnly, expenseController.remove)
