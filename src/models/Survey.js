import mongoose from 'mongoose'

const optionSchema = new mongoose.Schema({
  label: { type: String, required: true, trim: true, maxlength: 120 },
  value: { type: String, required: true, trim: true, maxlength: 80 },
  sentiment: { type: String, enum: ['positive', 'neutral', 'negative'], default: 'neutral' },
}, { _id: false })

const questionSchema = new mongoose.Schema({
  text: { type: String, required: true, trim: true, maxlength: 500 },
  type: { type: String, enum: ['choice', 'rating', 'yes_no', 'text'], required: true },
  required: { type: Boolean, default: true },
  options: { type: [optionSchema], default: [] },
}, { timestamps: false })

const surveySchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 180 },
  description: { type: String, trim: true, maxlength: 1000, default: '' },
  status: { type: String, enum: ['draft', 'active', 'closed'], default: 'draft', index: true },
  questions: { type: [questionSchema], validate: [(value) => value.length > 0, 'Kamida bitta savol kiriting'] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  activatedAt: { type: Date, default: null },
  closedAt: { type: Date, default: null },
}, { timestamps: true })

surveySchema.set('toJSON', { transform(_doc, row) { row.id = row._id.toString(); delete row._id; delete row.__v } })
export const Survey = mongoose.model('Survey', surveySchema)
