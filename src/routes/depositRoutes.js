import { Router } from 'express'
import { depositController } from '../controllers/depositController.js'
import { requireAuth } from '../middleware/auth.js'

export const depositRouter = Router()
depositRouter.get('/', requireAuth, depositController.list)
