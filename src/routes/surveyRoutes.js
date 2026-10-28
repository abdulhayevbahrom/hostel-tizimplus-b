import { Router } from 'express'
import { surveyController } from '../controllers/surveyController.js'
import { ownerOnly, requireAuth } from '../middleware/auth.js'

export const surveyRouter = Router()
surveyRouter.post('/telegram/webhook', surveyController.telegramWebhook)
surveyRouter.post('/public/identify', surveyController.identifyStudent)
surveyRouter.post('/public/:id/responses', surveyController.submitResponse)
surveyRouter.use(requireAuth)
surveyRouter.get('/', surveyController.list)
surveyRouter.post('/', ownerOnly, surveyController.create)
surveyRouter.get('/:id/results', surveyController.results)
surveyRouter.get('/:id', surveyController.get)
surveyRouter.put('/:id', ownerOnly, surveyController.update)
surveyRouter.put('/:id/status', ownerOnly, surveyController.setStatus)
surveyRouter.delete('/:id', ownerOnly, surveyController.remove)
