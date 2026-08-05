import { Router } from 'express'
import { universityController } from '../controllers/universityController.js'

export const universityRouter = Router()
universityRouter.get('/', universityController.list)
universityRouter.post('/', universityController.create)
universityRouter.put('/:id', universityController.update)
universityRouter.delete('/:id', universityController.remove)
