import { Router } from 'express'
import { debtorController } from '../controllers/debtorController.js'
import { deadlineEditorOnly, requireAuth } from '../middleware/auth.js'

export const debtorRouter = Router()
debtorRouter.get('/', requireAuth, debtorController.list)
debtorRouter.put('/:studentId/deadline', requireAuth, deadlineEditorOnly, debtorController.setDeadline)
