import mongoose from 'mongoose'

const telegramStudentLinkSchema = new mongoose.Schema({
  chatId: { type: String, required: true, unique: true, index: true },
  telegramUserId: { type: String, required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  mode: { type: String, enum: ['idle', 'awaiting_complaint'], default: 'idle' },
}, { timestamps: true })

export const TelegramStudentLink = mongoose.model('TelegramStudentLink', telegramStudentLinkSchema)
