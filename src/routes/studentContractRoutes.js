import { Router } from 'express'
import { studentContractController } from '../controllers/studentContractController.js'
import { requireAuth } from '../middleware/auth.js'

export const studentContractRouter = Router()
studentContractRouter.use(requireAuth)
studentContractRouter.get('/active', studentContractController.listActive)
studentContractRouter.get('/student/:studentId', studentContractController.listByStudent)
studentContractRouter.post('/', studentContractController.create)
studentContractRouter.put('/:id', studentContractController.update)
studentContractRouter.delete('/:id', studentContractController.remove)
