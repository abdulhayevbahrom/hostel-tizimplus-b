import { Router } from 'express'
import { buildingBlockController } from '../controllers/buildingBlockController.js'

export const buildingBlockRouter = Router()
buildingBlockRouter.get('/', buildingBlockController.list)
buildingBlockRouter.post('/', buildingBlockController.create)
buildingBlockRouter.put('/:id', buildingBlockController.update)
buildingBlockRouter.delete('/:id', buildingBlockController.remove)
