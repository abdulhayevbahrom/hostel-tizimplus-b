import mongoose from 'mongoose'
import { AuditLog } from '../models/AuditLog.js'
import { ApiResponse } from '../utils/response.js'

class AuditLogController {
  list = async (req, res, next) => {
    try {
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
      const limit = 40
      const filter = {}
      if (mongoose.isValidObjectId(req.query.employee)) filter.employee = req.query.employee
      if (req.query.entityType) filter.entityType = String(req.query.entityType)
      if (req.query.action) filter.action = String(req.query.action)
      if (req.query.from || req.query.to) filter.createdAt = { ...(req.query.from ? { $gte: new Date(`${req.query.from}T00:00:00+05:00`) } : {}), ...(req.query.to ? { $lte: new Date(`${req.query.to}T23:59:59.999+05:00`) } : {}) }
      const total = await AuditLog.countDocuments(filter)
      const logs = await AuditLog.find(filter).populate('employee', 'firstname lastname position role login').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      return ApiResponse.ok(res, { logs, pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } })
    } catch (error) { return next(error) }
  }

  student = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.studentId)) return ApiResponse.notFound(res, 'Talaba topilmadi')
      const logs = await AuditLog.find({ studentIds: req.params.studentId }).populate('employee', 'firstname lastname position role login').sort({ createdAt: -1 }).limit(300)
      return ApiResponse.ok(res, { logs })
    } catch (error) { return next(error) }
  }
}

export const auditLogController = new AuditLogController()
