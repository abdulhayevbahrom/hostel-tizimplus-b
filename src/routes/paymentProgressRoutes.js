import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { ApiResponse } from '../utils/response.js'
import { getPaymentProgress } from '../controllers/paymentProgressController.js'

export const paymentProgressRouter = Router()
paymentProgressRouter.get('/', requireAuth, (req, res, next) => {
  if (['owner', 'admin'].includes(req.employee.role) || req.employee.sections?.includes('payment-progress')) return next()
  return ApiResponse.forbidden(res, 'Bu bo‘lim uchun ruxsat berilmagan')
}, getPaymentProgress)
