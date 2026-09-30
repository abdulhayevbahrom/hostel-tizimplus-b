import { Employee } from '../models/Employee.js'
import { AuditLog } from '../models/AuditLog.js'
import { comparePassword } from '../utils/bcrypt.js'
import { createAuthToken } from '../utils/authToken.js'
import { ApiResponse } from '../utils/response.js'

class AuthController {
  login = async (req, res, next) => {
    try {
      const login = String(req.body.login || '').trim().toLowerCase()
      const employee = await Employee.findOne({ login, canLogin: true, isActive: true }).select('+passwordHash')
      if (!employee || !await comparePassword(req.body.password, employee.passwordHash)) return ApiResponse.unauthorized(res, 'Login yoki parol noto‘g‘ri')
      employee.passwordHash = undefined
      const latitude = Number(req.get('x-client-latitude'))
      const longitude = Number(req.get('x-client-longitude'))
      const forwarded = req.get('x-forwarded-for')?.split(',')[0]?.trim()
      AuditLog.create({
        employee: employee._id,
        employeeSnapshot: { fullName: `${employee.firstname} ${employee.lastname}`.trim(), role: employee.role, position: employee.position, login: employee.login },
        action: 'login',
        entityType: 'auth',
        entityId: employee.id,
        description: 'Tizimga kirdi',
        newValue: { login: employee.login },
        ipAddress: forwarded || req.ip || req.socket?.remoteAddress || '',
        location: { ...(Number.isFinite(latitude) ? { latitude } : {}), ...(Number.isFinite(longitude) ? { longitude } : {}), city: req.get('cf-ipcity') || req.get('x-vercel-ip-city') || '', country: req.get('cf-ipcountry') || req.get('x-vercel-ip-country') || '' },
        userAgent: req.get('user-agent') || '',
        request: { method: req.method, path: req.originalUrl },
      }).then((log) => req.app.get('io')?.emit('audit-logs:changed', { id: log.id, studentIds: [] })).catch((error) => console.error('Login audit write failed', error))
      return ApiResponse.ok(res, { token: createAuthToken(employee), employee }, 'Tizimga kirildi')
    } catch (error) { return next(error) }
  }

  me = async (req, res) => ApiResponse.ok(res, { employee: req.employee })
}

export const authController = new AuthController()
