import { Router } from 'express'
import { studentContractController } from '../controllers/studentContractController.js'

export const studentContractRouter = Router()
studentContractRouter.get('/active', studentContractController.listActive)
studentContractRouter.get('/student/:studentId', studentContractController.listByStudent)
studentContractRouter.post('/', studentContractController.create)
studentContractRouter.put('/:id', studentContractController.update)
studentContractRouter.delete('/:id', studentContractController.remove)
