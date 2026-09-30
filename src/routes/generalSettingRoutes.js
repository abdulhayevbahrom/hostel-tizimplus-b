import { Router } from 'express'
import { generalSettingController } from '../controllers/generalSettingController.js'
import { parseSettingPayload, uploadSettingLogo } from '../middleware/settingLogo.js'
import { ownerOnly, requireAuth } from '../middleware/auth.js'

export const generalSettingRouter = Router()
generalSettingRouter.get('/', generalSettingController.get)
generalSettingRouter.put('/', requireAuth, ownerOnly, uploadSettingLogo, parseSettingPayload, generalSettingController.update)
