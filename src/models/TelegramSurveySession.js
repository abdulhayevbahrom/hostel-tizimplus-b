import mongoose from 'mongoose'

const telegramAnswerSchema = new mongoose.Schema({
  questionId: { type: mongoose.Schema.Types.ObjectId, required: true },
  value: { type: mongoose.Schema.Types.Mixed, default: null },
}, { _id: false })

const telegramSurveySessionSchema = new mongoose.Schema({
  chatId: { type: String, required: true, unique: true, index: true },
  telegramUserId: { type: String, required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  survey: { type: mongoose.Schema.Types.ObjectId, ref: 'Survey', required: true },
  questionIndex: { type: Number, min: 0, default: 0 },
  awaitingFollowUp: { type: Boolean, default: false },
  selectedOptionIndex: { type: Number, default: null },
  answers: { type: [telegramAnswerSchema], default: [] },
  lastUpdateId: { type: Number, default: 0 },
}, { timestamps: true })

export const TelegramSurveySession = mongoose.model('TelegramSurveySession', telegramSurveySessionSchema)
