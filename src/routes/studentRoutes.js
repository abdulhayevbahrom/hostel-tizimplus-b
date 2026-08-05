import { Router } from 'express'
import { studentController } from '../controllers/studentController.js'
import { parseStudentPayload, uploadStudentPhoto } from '../middleware/studentPhoto.js'

export const studentRouter = Router()
studentRouter.get('/', studentController.list)
studentRouter.get('/check-blacklist', studentController.checkBlacklist)
studentRouter.get('/history', studentController.history)
studentRouter.get('/:id', studentController.getById)
studentRouter.post('/', uploadStudentPhoto, parseStudentPayload, studentController.create)
studentRouter.put('/:id', uploadStudentPhoto, parseStudentPayload, studentController.update)
studentRouter.delete('/:id', studentController.remove)
