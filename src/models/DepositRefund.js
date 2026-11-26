import mongoose from 'mongoose'

const values = { amount: Number, method: String, refundDate: Date, note: String }
const schema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
  contract: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentContract', required: true, index: true },
  amount: { type: Number, required: true, min: 1 },
  method: { type: String, enum: ['cash', 'card', 'bank', 'online'], required: true },
  refundDate: { type: Date, required: true },
  refundedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  note: { type: String, trim: true, maxlength: 500, default: '' },
  status: { type: String, enum: ['active', 'cancelled'], default: 'active' },
  cancelledAt: { type: Date, default: null },
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  auditHistory: [{
    action: { type: String, enum: ['created', 'updated', 'cancelled'], required: true },
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    performedAt: { type: Date, default: Date.now },
    before: values, after: values,
  }],
}, { timestamps: true })
schema.index({ contract: 1, status: 1 })
schema.set('toJSON', { transform(_document, result) { result.id = result._id.toString(); delete result._id; delete result.__v } })
export const DepositRefund = mongoose.model('DepositRefund', schema)
