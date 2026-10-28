import mongoose from 'mongoose'

const answerSchema = new mongoose.Schema({
  questionId: { type: mongoose.Schema.Types.ObjectId, required: true },
  value: { type: mongoose.Schema.Types.Mixed, default: null },
}, { _id: false })

const surveyResponseSchema = new mongoose.Schema({
  survey: { type: mongoose.Schema.Types.ObjectId, ref: 'Survey', required: true, index: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
  telegramChatId: { type: String, trim: true, default: '' },
  answers: { type: [answerSchema], default: [] },
  completedAt: { type: Date, default: Date.now },
}, { timestamps: true })

surveyResponseSchema.index({ survey: 1, student: 1 }, { unique: true })
surveyResponseSchema.set('toJSON', { transform(_doc, row) { row.id = row._id.toString(); delete row._id; delete row.__v } })
export const SurveyResponse = mongoose.model('SurveyResponse', surveyResponseSchema)
