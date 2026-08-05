import { Router } from 'express'
import { generalSettingController } from '../controllers/generalSettingController.js'
import { parseSettingPayload, uploadSettingLogo } from '../middleware/settingLogo.js'

export const generalSettingRouter = Router()
generalSettingRouter.get('/', generalSettingController.get)
generalSettingRouter.put('/', uploadSettingLogo, parseSettingPayload, generalSettingController.update)
