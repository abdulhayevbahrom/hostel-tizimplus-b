import { Router } from 'express'
import { universityController } from '../controllers/universityController.js'
import { requireAuth } from '../middleware/auth.js'

export const universityRouter = Router()
universityRouter.use(requireAuth)
universityRouter.get('/', universityController.list)
universityRouter.post('/', universityController.create)
universityRouter.put('/:id', universityController.update)
universityRouter.delete('/:id', universityController.remove)
