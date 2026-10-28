import { Router } from 'express'
import { complaintController } from '../controllers/complaintController.js'
import { requireAuth } from '../middleware/auth.js'

export const complaintRouter = Router()
complaintRouter.use(requireAuth)
complaintRouter.get('/', complaintController.list)
complaintRouter.put('/:id', complaintController.update)
