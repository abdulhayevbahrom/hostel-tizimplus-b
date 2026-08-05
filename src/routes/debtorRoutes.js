import { Router } from 'express'
import { debtorController } from '../controllers/debtorController.js'
import { requireAuth } from '../middleware/auth.js'

export const debtorRouter = Router()
debtorRouter.get('/', requireAuth, debtorController.list)
