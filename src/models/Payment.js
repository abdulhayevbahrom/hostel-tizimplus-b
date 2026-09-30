import mongoose from 'mongoose'

const allocationSchema = new mongoose.Schema({
  installment: { type: mongoose.Schema.Types.ObjectId, ref: 'ContractInstallment', required: true },
  amount: { type: Number, required: true, min: 1 },
}, { _id: false })

const paymentPartSchema = new mongoose.Schema({
  method: { type: String, enum: ['cash', 'card', 'bank', 'online'], required: true },
  amount: { type: Number, required: true, min: 1 },
  fundHolder: { type: String, enum: ['cashier', 'organization'], required: true },
}, { _id: false })

const auditSchema = new mongoose.Schema({
  action: { type: String, enum: ['created', 'updated', 'cancelled'], required: true },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  performedAt: { type: Date, default: Date.now },
  before: { amount: Number, method: String, fundHolder: String, paymentParts: mongoose.Schema.Types.Mixed, note: String },
  after: { amount: Number, method: String, fundHolder: String, paymentParts: mongoose.Schema.Types.Mixed, note: String },
}, { _id: true })

const paymentSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
  contract: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentContract', default: null, index: true },
  paymentPurpose: { type: String, enum: ['contract', 'deposit'], default: 'contract', index: true },
  amount: { type: Number, required: true, min: 1 },
  method: { type: String, enum: ['cash', 'card', 'bank', 'online', 'mixed'], required: true, index: true },
  fundHolder: { type: String, enum: ['cashier', 'organization', 'mixed'], default: 'organization', index: true },
  paymentParts: { type: [paymentPartSchema], default: undefined },
  note: { type: String, trim: true, maxlength: 500, default: '' },
  allocations: { type: [allocationSchema], default: [] },
  receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null, index: true },
  cashSession: { type: mongoose.Schema.Types.ObjectId, ref: 'CashSession', default: null, index: true },
  status: { type: String, enum: ['active', 'cancelled'], default: 'active', index: true },
  cancelledAt: { type: Date, default: null },
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  auditHistory: { type: [auditSchema], default: [] },
}, { timestamps: true })

paymentSchema.index({ createdAt: -1 })
paymentSchema.index({ contract: 1, status: 1, cancelledAt: 1, createdAt: 1 })
paymentSchema.index({ contract: 1, createdAt: -1 })
paymentSchema.index({ student: 1, createdAt: -1 })
paymentSchema.index({ 'paymentParts.method': 1 })

paymentSchema.set('toJSON', { transform(_document, result) { result.id = result._id.toString(); delete result._id; delete result.__v } })

export const Payment = mongoose.model('Payment', paymentSchema)
