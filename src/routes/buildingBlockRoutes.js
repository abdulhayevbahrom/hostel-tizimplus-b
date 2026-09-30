import { Router } from 'express'
import { buildingBlockController } from '../controllers/buildingBlockController.js'
import { requireAuth } from '../middleware/auth.js'

export const buildingBlockRouter = Router()
buildingBlockRouter.use(requireAuth)
buildingBlockRouter.get('/', buildingBlockController.list)
buildingBlockRouter.post('/', buildingBlockController.create)
buildingBlockRouter.put('/:id', buildingBlockController.update)
buildingBlockRouter.delete('/:id', buildingBlockController.remove)
