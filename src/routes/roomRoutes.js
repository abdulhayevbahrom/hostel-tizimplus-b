import { Router } from 'express'
import { roomController } from '../controllers/roomController.js'
import { parseRoomPayload, uploadRoomImages } from '../middleware/roomImages.js'
import { requireAuth } from '../middleware/auth.js'

export const roomRouter = Router()
roomRouter.use(requireAuth)
roomRouter.get('/', roomController.list)
roomRouter.get('/:id/students', roomController.students)
roomRouter.get('/:id', roomController.getById)
roomRouter.post('/', uploadRoomImages, parseRoomPayload, roomController.create)
roomRouter.put('/:id', uploadRoomImages, parseRoomPayload, roomController.update)
roomRouter.delete('/:id', roomController.remove)
