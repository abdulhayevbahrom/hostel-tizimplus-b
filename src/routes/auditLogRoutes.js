import { Router } from 'express'
import { auditLogController } from '../controllers/auditLogController.js'
import { ownerOnly, requireAuth } from '../middleware/auth.js'

export const auditLogRouter = Router()
auditLogRouter.get('/', requireAuth, ownerOnly, auditLogController.list)
auditLogRouter.get('/student/:studentId', requireAuth, auditLogController.student)
