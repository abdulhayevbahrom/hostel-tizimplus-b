import mongoose from 'mongoose'
import { AuditLog } from '../models/AuditLog.js'
import { Attendance } from '../models/Attendance.js'
import { BuildingBlock } from '../models/BuildingBlock.js'
import { CashSession } from '../models/CashSession.js'
import { DebtorDeadline } from '../models/DebtorDeadline.js'
import { Employee } from '../models/Employee.js'
import { Expense } from '../models/Expense.js'
import { Faculty } from '../models/Faculty.js'
import { Fine } from '../models/Fine.js'
import { GeneralSetting } from '../models/GeneralSetting.js'
import { Payment } from '../models/Payment.js'
import { Room } from '../models/Room.js'
import { SalaryPayment } from '../models/SalaryPayment.js'
import { Student } from '../models/Student.js'
import { StudentContract } from '../models/StudentContract.js'
import { University } from '../models/University.js'

const resources = {
  students: { model: Student, entityType: 'student', label: 'Talaba' },
  'student-contracts': { model: StudentContract, entityType: 'contract', label: 'Shartnoma' },
  payments: { model: Payment, entityType: 'payment', label: 'To‘lov' },
  expenses: { model: Expense, entityType: 'expense', label: 'Xarajat' },
  fines: { model: Fine, entityType: 'fine', label: 'Jarima' },
  employees: { model: Employee, entityType: 'employee', label: 'Xodim' },
  rooms: { model: Room, entityType: 'room', label: 'Xona' },
  universities: { model: University, entityType: 'university', label: 'Universitet' },
  faculties: { model: Faculty, entityType: 'faculty', label: 'Fakultet' },
  'building-blocks': { model: BuildingBlock, entityType: 'building-block', label: 'Bino/blok' },
  'settings/general': { model: GeneralSetting, entityType: 'settings', label: 'Sozlama' },
  'cash-sessions': { model: CashSession, entityType: 'cash-session', label: 'Kassa' },
  attendance: { model: Attendance, entityType: 'attendance', label: 'Davomat' },
  debtors: { model: DebtorDeadline, entityType: 'debtor-deadline', label: 'Qarzdorlik muddati' },
  salaries: { model: SalaryPayment, entityType: 'salary-payment', label: 'Oylik to‘lovi' },
}

const hiddenKeys = /password|token|secret|hash|deleteUrl/i
const sanitize = (value, depth = 0, seen = new WeakSet()) => {
  if (value == null || depth > 8) return value
  if (value instanceof Date) return value.toISOString()
  if (value instanceof mongoose.Types.ObjectId) return value.toString()
  if (typeof value !== 'object') return value
  if (seen.has(value)) return '[Circular]'
  seen.add(value)
  if (typeof value.toJSON === 'function') return sanitize(value.toJSON(), depth + 1, seen)
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitize(item, depth + 1, seen))
  return Object.fromEntries(Object.entries(value).filter(([key]) => !hiddenKeys.test(key)).map(([key, item]) => [key, sanitize(item, depth + 1, seen)]))
}

const bounded = (value) => {
  const safe = sanitize(value)
  try { return JSON.stringify(safe).length <= 200000 ? safe : { summary: 'Ma‘lumot hajmi katta bo‘lgani uchun qisqartirildi' } } catch { return { summary: 'Ma‘lumotni saqlab bo‘lmadi' } }
}

const resourceFor = (path) => {
  const parts = path.replace(/^\/api\//, '').split('/').filter(Boolean)
  const twoPart = `${parts[0]}/${parts[1] || ''}`
  const key = resources[twoPart] ? twoPart : parts[0]
  return { ...resources[key], key, parts }
}

const actionFor = (method, path) => {
  if (method === 'POST') return /payments|\/pay(?:\/|$)|close/.test(path) ? 'payment' : 'create'
  if (method === 'DELETE') return 'delete'
  if (/approve/.test(path)) return 'approve'
  if (/deadline/.test(path)) return 'deadline'
  if (/rooms$/.test(path)) return 'assign'
  return 'update'
}

const actionLabels = { create: 'yaratdi', update: 'o‘zgartirdi', delete: 'o‘chirdi/bekor qildi', payment: 'to‘lov qabul qildi', approve: 'tasdiqladi', deadline: 'muddat belgiladi', assign: 'biriktirdi' }

const extractEntityId = (data, entityType) => {
  if (!data || typeof data !== 'object') return null
  const candidates = [data[entityType], data.payment, data.student, data.contract, data.expense, data.fine, data.employee, data.room, data.session, data.deadline, data.settings]
  return candidates.find((item) => item?.id || item?._id)?.id || candidates.find((item) => item?._id)?._id?.toString() || null
}

const collectStudentIds = (values) => {
  const ids = new Set()
  const seen = new WeakSet()
  const visit = (value, key = '', depth = 0) => {
    if (value == null || depth > 10) return
    if (typeof value !== 'object') {
      if ((key === 'student' || key === 'studentId') && mongoose.isValidObjectId(value)) ids.add(String(value))
      return
    }
    if (seen.has(value)) return
    seen.add(value)
    if (Array.isArray(value)) return value.forEach((item) => visit(item, key, depth + 1))
    if (typeof value.toJSON === 'function') return visit(value.toJSON(), key, depth + 1)
    if (key === 'student' && mongoose.isValidObjectId(value.id || value._id)) ids.add(String(value.id || value._id))
    Object.entries(value).forEach(([childKey, item]) => visit(item, childKey, depth + 1))
  }
  values.forEach((value) => visit(value))
  return [...ids].map((id) => new mongoose.Types.ObjectId(id))
}

export async function auditMutation(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || req.path.startsWith('/api/auth') || req.path.startsWith('/api/notifications')) return next()
  const resource = resourceFor(req.path)
  if (!resource.model || !req.employee) return next()
  const paramId = resource.parts.find((part) => mongoose.isValidObjectId(part))
  let oldValue = null
  try {
    if (paramId) {
      if (resource.entityType !== 'student') {
        const oldQuery = resource.model.findById(paramId)
        if (resource.entityType === 'contract') oldQuery.populate([{ path: 'student', select: 'fullName' }, { path: 'room', select: 'roomNumber block floor' }])
        if (resource.entityType === 'fine' || resource.entityType === 'payment') oldQuery.populate('student', 'fullName')
        oldValue = await oldQuery.lean()
      }
    }
    else if (resource.key === 'settings/general') oldValue = await GeneralSetting.findOne({ key: 'general' }).lean()
  } catch (error) { console.error('Audit old snapshot failed', error) }
  let responseBody = null
  const originalJson = res.json.bind(res)
  res.json = (body) => { responseBody = body; return originalJson(body) }
  res.on('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return
    const action = actionFor(req.method, req.path)
    const newValue = responseBody?.data || req.body
    const effectiveOldValue = req.auditOldValue ?? oldValue
    const entityId = paramId || extractEntityId(newValue, resource.entityType)
    const latitude = Number(req.get('x-client-latitude'))
    const longitude = Number(req.get('x-client-longitude'))
    const forwarded = req.get('x-forwarded-for')?.split(',')[0]?.trim()
    AuditLog.create({
      employee: req.employee._id,
      employeeSnapshot: { fullName: `${req.employee.firstname} ${req.employee.lastname}`.trim(), role: req.employee.role, position: req.employee.position, login: req.employee.login },
      action,
      entityType: resource.entityType,
      entityId,
      studentIds: collectStudentIds([effectiveOldValue, req.body, newValue, resource.entityType === 'student' ? { student: entityId } : null]),
      description: `${resource.label} bo‘yicha amal: ${actionLabels[action] || action}`,
      oldValue: bounded(effectiveOldValue),
      newValue: bounded(newValue),
      ipAddress: forwarded || req.ip || req.socket?.remoteAddress || '',
      location: { ...(Number.isFinite(latitude) ? { latitude } : {}), ...(Number.isFinite(longitude) ? { longitude } : {}), city: req.get('cf-ipcity') || req.get('x-vercel-ip-city') || '', country: req.get('cf-ipcountry') || req.get('x-vercel-ip-country') || '' },
      userAgent: req.get('user-agent') || '',
      request: { method: req.method, path: req.originalUrl },
    }).then((log) => req.app.get('io')?.emit('audit-logs:changed', { id: log.id, studentIds: log.studentIds.map(String) })).catch((error) => console.error('Audit log write failed', error))
  })
  return next()
}
