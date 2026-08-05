import mongoose from 'mongoose'

const allocationSchema = new mongoose.Schema({
  installment: { type: mongoose.Schema.Types.ObjectId, ref: 'ContractInstallment', required: true },
  amount: { type: Number, required: true, min: 1 },
}, { _id: false })

const paymentSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
  contract: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentContract', required: true, index: true },
  amount: { type: Number, required: true, min: 1 },
  method: { type: String, enum: ['cash', 'card', 'bank', 'online'], required: true, index: true },
  note: { type: String, trim: true, maxlength: 500, default: '' },
  allocations: { type: [allocationSchema], default: [] },
}, { timestamps: true })

paymentSchema.index({ createdAt: -1 })

paymentSchema.set('toJSON', { transform(_document, result) { result.id = result._id.toString(); delete result._id; delete result.__v } })

export const Payment = mongoose.model('Payment', paymentSchema)
