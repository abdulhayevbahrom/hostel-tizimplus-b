import { Router } from 'express'
import { facultyController } from '../controllers/facultyController.js'

export const facultyRouter = Router()
facultyRouter.get('/', facultyController.list)
facultyRouter.post('/', facultyController.create)
facultyRouter.put('/:id', facultyController.update)
facultyRouter.delete('/:id', facultyController.remove)
