import mongoose from 'mongoose'

const complaintSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
  telegramChatId: { type: String, trim: true, default: '' },
  text: { type: String, required: true, trim: true, maxlength: 3000 },
  status: { type: String, enum: ['new', 'in_progress', 'resolved'], default: 'new', index: true },
  handledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  staffNote: { type: String, trim: true, maxlength: 2000, default: '' },
  resolvedAt: { type: Date, default: null },
}, { timestamps: true })

complaintSchema.set('toJSON', { transform(_doc, row) { row.id = row._id.toString(); delete row._id; delete row.__v } })
export const Complaint = mongoose.model('Complaint', complaintSchema)
