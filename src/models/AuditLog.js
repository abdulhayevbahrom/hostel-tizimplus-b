import mongoose from 'mongoose'

const auditLogSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  employeeSnapshot: {
    fullName: { type: String, required: true },
    role: String,
    position: String,
    login: String,
  },
  action: { type: String, required: true, index: true },
  entityType: { type: String, required: true, index: true },
  entityId: { type: String, default: null, index: true },
  studentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student', index: true }],
  description: { type: String, required: true },
  oldValue: { type: mongoose.Schema.Types.Mixed, default: null },
  newValue: { type: mongoose.Schema.Types.Mixed, default: null },
  ipAddress: { type: String, default: '' },
  location: {
    latitude: Number,
    longitude: Number,
    city: String,
    country: String,
  },
  userAgent: { type: String, default: '' },
  request: { method: String, path: String },
}, { timestamps: true, versionKey: false })

auditLogSchema.index({ createdAt: -1 })
auditLogSchema.index({ studentIds: 1, createdAt: -1 })
auditLogSchema.index({ entityType: 1, createdAt: -1 })

auditLogSchema.set('toJSON', { transform(_document, result) { result.id = result._id.toString(); delete result._id } })

export const AuditLog = mongoose.model('AuditLog', auditLogSchema)
