import mongoose from 'mongoose'
import { Student } from '../models/Student.js'
import { Survey } from '../models/Survey.js'
import { SurveyResponse } from '../models/SurveyResponse.js'
import { TelegramSurveySession } from '../models/TelegramSurveySession.js'
import { TelegramStudentLink } from '../models/TelegramStudentLink.js'
import { Complaint } from '../models/Complaint.js'
import { Notification } from '../models/Notification.js'
import { StudentContract } from '../models/StudentContract.js'
import { ApiResponse } from '../utils/response.js'
import { sendTelegramMessage, telegramCall } from '../utils/telegram.js'

const cleanPhone = (value = '') => String(value).replace(/\D/g, '').slice(-9)
const validId = (value) => mongoose.isValidObjectId(value)
const escapeTelegramHtml = (value = '') => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const questionTypeLabels = { choice: 'Variantli', rating: '1–5 baholash', yes_no: 'Ha / yo‘q', text: 'Erkin matn' }
const contactKeyboard = { keyboard: [[{ text: '📱 Telefon raqamni yuborish', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true, input_field_placeholder: 'Yoki raqamni yozing: 901234567' }
const mainKeyboard = { keyboard: [[{ text: '📋 So‘rovnomani boshlash' }], [{ text: '📝 Murojaat yuborish' }]], resize_keyboard: true, one_time_keyboard: true, input_field_placeholder: 'Kerakli bo‘limni tanlang' }

function normalizeFollowUp(followUp, questionNumber, optionLabel) {
  if (!followUp?.enabled) return null
  const text = String(followUp.text || '').trim()
  if (!text) throw new Error(`${questionNumber}-savoldagi “${optionLabel}” varianti uchun qo‘shimcha savol matnini kiriting`)
  const type = ['choice', 'rating', 'yes_no', 'text'].includes(followUp.type) ? followUp.type : 'text'
  let options = []
  if (type === 'choice') {
    options = (followUp.options || []).map((option, index) => ({ label: String(option.label || '').trim(), value: String(option.value || `option_${index + 1}`).trim(), sentiment: option.sentiment || 'neutral' })).filter((option) => option.label)
    if (options.length < 2) throw new Error(`${questionNumber}-savoldagi qo‘shimcha savol uchun kamida 2 ta variant kiriting`)
  }
  if (type === 'yes_no') options = [{ label: 'Ha', value: 'yes', sentiment: 'positive' }, { label: 'Yo‘q', value: 'no', sentiment: 'negative' }]
  return { enabled: true, text, type, required: followUp.required !== false, options }
}

function normalizeQuestions(questions) {
  if (!Array.isArray(questions) || !questions.length) throw new Error('Kamida bitta savol kiriting')
  return questions.map((question, index) => {
    const type = ['choice', 'rating', 'yes_no', 'text'].includes(question.type) ? question.type : 'choice'
    const text = String(question.text || '').trim()
    if (!text) throw new Error(`${index + 1}-savol matnini kiriting`)
    let options = []
    if (type === 'choice') {
      options = (question.options || []).map((option, optionIndex) => ({
        label: String(option.label || '').trim(),
        value: String(option.value || `option_${optionIndex + 1}`).trim(),
        sentiment: ['positive', 'neutral', 'negative'].includes(option.sentiment) ? option.sentiment : 'neutral',
        followUp: normalizeFollowUp(option.followUp, index + 1, String(option.label || optionIndex + 1)),
      })).filter((option) => option.label)
      if (options.length < 2) throw new Error(`${index + 1}-savol uchun kamida 2 ta variant kiriting`)
    }
    if (type === 'yes_no') {
      const supplied = new Map((question.options || []).map((option) => [option.value, option]))
      options = [{ label: 'Ha', value: 'yes', sentiment: 'positive' }, { label: 'Yo‘q', value: 'no', sentiment: 'negative' }].map((option) => ({ ...option, followUp: normalizeFollowUp(supplied.get(option.value)?.followUp, index + 1, option.label) }))
    }
    return { text, type, required: question.required !== false, options }
  })
}

function answerSentiment(question, value) {
  if (question.type === 'text' || value === null || value === undefined || value === '') return null
  if (question.type === 'rating') return Number(value) >= 4 ? 'positive' : Number(value) <= 2 ? 'negative' : 'neutral'
  return question.options.find((option) => option.value === String(value))?.sentiment || 'neutral'
}

function isYesNoQuestion(question) {
  if (question.type === 'yes_no') return true
  const values = (question.options || []).map((option) => String(option.value).toLowerCase()).sort()
  return values.length === 2 && values[0] === 'no' && values[1] === 'yes'
}

function resultAnswerLabel(question, value) {
  if (value === null || value === undefined || value === '') return 'Javobsiz'
  if (question.type === 'rating') return String(value)
  const option = (question.options || []).find((item) => String(item.value) === String(value))
  if (option?.label) return option.label
  if (String(value).toLowerCase() === 'yes') return 'Ha'
  if (String(value).toLowerCase() === 'no') return 'Yo‘q'
  return String(value)
}

function questionKeyboard(question, questionIndex, prefix = 'a') {
  const skipRow = question.required === false ? [[{ text: 'O‘tkazib yuborish', callback_data: `s:${questionIndex}` }]] : []
  if (question.type === 'text') return question.required === false ? { inline_keyboard: skipRow } : { remove_keyboard: true }
  if (question.type === 'rating') return { inline_keyboard: [[1, 2, 3, 4, 5].map((value) => ({ text: `${value} ⭐`, callback_data: `${prefix}:${questionIndex}:${value - 1}` })), ...skipRow] }
  if (question.type === 'yes_no') return { inline_keyboard: [[...question.options.map((option, optionIndex) => ({ text: `${option.value === 'yes' ? '✅' : '❌'} ${option.label}`, callback_data: `${prefix}:${questionIndex}:${optionIndex}` }))], ...skipRow] }
  return { inline_keyboard: [...question.options.map((option, optionIndex) => [{ text: option.label, callback_data: `${prefix}:${questionIndex}:${optionIndex}` }]), ...skipRow] }
}

function telegramAnswerLabel(question, value, skipped = false) {
  if (skipped) return 'O‘tkazib yuborildi'
  if (question.type === 'rating') return `${value} ⭐`
  const option = question.options?.find((item) => item.value === String(value))
  if (question.type === 'yes_no') return `${value === 'yes' ? '✅' : '❌'} ${option?.label || value}`
  return option?.label || String(value)
}

async function markTelegramQuestionAnswered(callback, question, value, skipped = false) {
  const messageId = callback?.message?.message_id
  const chatId = callback?.message?.chat?.id
  if (!messageId || !chatId) return
  await telegramCall('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: `${escapeTelegramHtml(question.text)}\n\n<b>Javob:</b> ${escapeTelegramHtml(telegramAnswerLabel(question, value, skipped))}`,
    parse_mode: 'HTML',
  }).catch(() => null)
}

async function askTelegramQuestion(chatId, survey, index) {
  const question = survey.questions[index]
  return sendTelegramMessage(chatId, question.text, questionKeyboard(question, index))
}

async function askTelegramFollowUp(chatId, followUp, questionIndex) {
  return sendTelegramMessage(chatId, `Fikringizni yaxshiroq tushunishimiz uchun:\n\n${followUp.text}`, questionKeyboard(followUp, questionIndex, 'f'))
}

class SurveyController {
  telegramWebhook = async (req, res, next) => {
    try {
      const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET
      const receivedSecret = req.get('x-telegram-bot-api-secret-token')
      if (!expectedSecret || receivedSecret !== expectedSecret) return ApiResponse.forbidden(res, 'Webhook secret noto‘g‘ri')
      const update = req.body || {}
      const message = update.message
      const callback = update.callback_query
      const chatId = String(message?.chat?.id || callback?.message?.chat?.id || '')
      const telegramUserId = String(message?.from?.id || callback?.from?.id || '')
      if (!chatId) return ApiResponse.ok(res, { received: true })

      if (callback) await telegramCall('answerCallbackQuery', { callback_query_id: callback.id }).catch(() => null)
      let link = await TelegramStudentLink.findOne({ chatId }).populate('student', 'fullName phone')
      if (message?.text === '/start') {
        await TelegramSurveySession.deleteOne({ chatId })
        if (link) {
          link.mode = 'idle'; await link.save()
          await sendTelegramMessage(chatId, `${link.student.fullName}, ma’lumotlaringiz tasdiqlandi. Iltimos, davom etish uchun kerakli bo‘limni tanlang.`, mainKeyboard)
        } else await sendTelegramMessage(chatId, 'Assalomu alaykum! Davom etish uchun yotoqxona shartnomangizda ko‘rsatilgan telefon raqamini quyidagi tugma orqali yuboring yoki 901234567 ko‘rinishida yozing.', contactKeyboard)
        return ApiResponse.ok(res, { received: true })
      }

      if (link?.mode === 'awaiting_complaint' && message?.text && !message.text.startsWith('/')) {
        const complaintText = message.text.trim()
        if (complaintText.length < 5) {
          await sendTelegramMessage(chatId, 'Iltimos, murojaat yoki muammoingizni biroz batafsilroq yozib yuboring.')
          return ApiResponse.ok(res, { received: true })
        }
        const contract = await StudentContract.findOne({ student: link.student._id, status: 'active' }).sort({ createdAt: -1 }).populate('room', 'roomNumber block floor')
        const complaint = await Complaint.create({ student: link.student._id, room: contract?.room?._id || null, telegramChatId: chatId, text: complaintText })
        const roomLabel = contract?.room ? `${contract.room.block ? `${contract.room.block}, ` : ''}${contract.room.floor}-qavat, ${contract.room.roomNumber}-xona` : 'Xona aniqlanmadi'
        await Notification.create({
          eventKey: `complaint:${complaint.id}`,
          type: 'complaint',
          title: 'Yangi talaba shikoyati',
          message: `${link.student.fullName} · ${roomLabel}`,
          count: 1,
          targetPath: '/complaints',
          targetRoles: ['employee', 'manager', 'owner', 'admin'],
        }).catch((error) => console.error(`Shikoyat bildirishnomasi yaratilmadi: ${error.message}`))
        link.mode = 'idle'; await link.save()
        req.app.get('io')?.emit('complaints:changed', { id: complaint.id })
        req.app.get('io')?.emit('notifications:changed', { action: 'created', type: 'complaint', id: complaint.id })
        await sendTelegramMessage(chatId, `Hurmatli talaba, murojaatingiz qabul qilindi. Murojaat raqami: #${complaint.id.slice(-6).toUpperCase()}.

Mas’ul xodimlar murojaatingizni ko‘rib chiqadi. Ishonchingiz uchun rahmat!`, mainKeyboard)
        return ApiResponse.ok(res, { received: true })
      }

      const typedPhoneDigits = String(message?.text || '').replace(/\D/g, '')
      const typedPhone = /^(998)?\d{9}$/.test(typedPhoneDigits) ? cleanPhone(typedPhoneDigits) : ''
      if (message?.contact || typedPhone) {
        if (message.contact?.user_id && String(message.contact.user_id) !== telegramUserId) {
          await sendTelegramMessage(chatId, 'Iltimos, xavfsizlik nuqtayi nazaridan faqat o‘zingizga tegishli telefon raqamini yuboring.', contactKeyboard)
          return ApiResponse.ok(res, { received: true })
        }
        const phone = typedPhone || cleanPhone(message.contact.phone_number)
        const student = await Student.findOne({ phone }).select('fullName phone')
        if (!student) {
          await sendTelegramMessage(chatId, 'Kechirasiz, ushbu telefon raqami yotoqxona shartnomasidagi ma’lumotlar bilan mos kelmadi. Iltimos, shartnomada ko‘rsatilgan telefon raqamingizni yuboring.', contactKeyboard)
          return ApiResponse.ok(res, { received: true })
        }
        link = await TelegramStudentLink.findOneAndUpdate({ chatId }, { telegramUserId, student: student._id, mode: 'idle' }, { upsert: true, new: true }).populate('student', 'fullName phone')
        await sendTelegramMessage(chatId, `${student.fullName}, ma’lumotlaringiz tasdiqlandi. Iltimos, davom etish uchun kerakli bo‘limni tanlang.`, mainKeyboard)
        return ApiResponse.ok(res, { received: true })
      }

      if (!link) {
        await sendTelegramMessage(chatId, 'Iltimos, yotoqxona shartnomangizda ko‘rsatilgan telefon raqamini tugma orqali yuboring yoki 901234567 ko‘rinishida yozing.', contactKeyboard)
        return ApiResponse.ok(res, { received: true })
      }

      if (['📝 Murojaat yuborish', '📣 Shikoyat yozish'].includes(message?.text)) {
        await TelegramSurveySession.deleteOne({ chatId })
        link.mode = 'awaiting_complaint'; await link.save()
        await sendTelegramMessage(chatId, 'Hurmatli talaba, murojaat yoki muammoingizni bitta xabarda batafsil yozib yuboring. Bekor qilish uchun /start buyrug‘ini bosing.', { remove_keyboard: true })
        return ApiResponse.ok(res, { received: true })
      }

      if (['📋 So‘rovnomani boshlash', '📋 So‘rovnomada qatnashish', '📋 So‘rovnomani to‘ldirish'].includes(message?.text)) {
        const activeSurvey = await Survey.findOne({ status: 'active' }).sort({ activatedAt: -1 })
        if (!activeSurvey) { await sendTelegramMessage(chatId, 'Hurmatli talaba, hozircha faol so‘rovnoma mavjud emas. Keyinroq qayta urinib ko‘ring.', mainKeyboard); return ApiResponse.ok(res, { received: true }) }
        if (await SurveyResponse.exists({ survey: activeSurvey._id, student: link.student._id })) { await sendTelegramMessage(chatId, 'Siz ushbu so‘rovnomada avval qatnashgansiz. Bildirgan fikringiz uchun rahmat!', mainKeyboard); return ApiResponse.ok(res, { received: true }) }
        await TelegramSurveySession.findOneAndUpdate({ chatId }, { telegramUserId, student: link.student._id, survey: activeSurvey._id, questionIndex: 0, awaitingFollowUp: false, selectedOptionIndex: null, answers: [], lastUpdateId: update.update_id || 0 }, { upsert: true, new: true })
        await telegramCall('sendMessage', {
          chat_id: chatId,
          text: `So‘rovnomada qatnashishga rozilik bildirganingiz uchun rahmat.\n\n<b>${escapeTelegramHtml(activeSurvey.title)}</b>${activeSurvey.description ? `\n<i>${escapeTelegramHtml(activeSurvey.description)}</i>` : ''}`,
          parse_mode: 'HTML',
          reply_markup: { remove_keyboard: true },
        })
        await askTelegramQuestion(chatId, activeSurvey, 0)
        return ApiResponse.ok(res, { received: true })
      }

      const session = await TelegramSurveySession.findOne({ chatId })
      if (!session) { await sendTelegramMessage(chatId, 'Iltimos, davom etish uchun kerakli bo‘limni tanlang.', mainKeyboard); return ApiResponse.ok(res, { received: true }) }
      if (update.update_id && session.lastUpdateId >= update.update_id) return ApiResponse.ok(res, { received: true, duplicate: true })
      const survey = await Survey.findOne({ _id: session.survey, status: 'active' })
      if (!survey) {
        await TelegramSurveySession.deleteOne({ _id: session._id })
        await sendTelegramMessage(chatId, 'Hurmatli talaba, ushbu so‘rovnoma yakunlangan. Qiziqish bildirganingiz uchun rahmat!', mainKeyboard)
        return ApiResponse.ok(res, { received: true })
      }
      const question = survey.questions[session.questionIndex]
      let value
      let optionIndex = null
      let skipped = false
      if (session.awaitingFollowUp) {
        const followUp = question.options[session.selectedOptionIndex]?.followUp
        if (!followUp?.enabled) {
          session.awaitingFollowUp = false
          session.selectedOptionIndex = null
        }
        else if (callback?.data === `s:${session.questionIndex}` && followUp.required === false) skipped = true
        else if (callback?.data?.startsWith('f:')) {
          const [, indexRaw, answerRaw] = callback.data.split(':')
          if (Number(indexRaw) !== session.questionIndex || followUp.type === 'text') return ApiResponse.ok(res, { received: true })
          const answerIndex = Number(answerRaw)
          value = followUp.type === 'rating' ? answerIndex + 1 : followUp.options[answerIndex]?.value
        } else if (message?.text && followUp.type === 'text') value = message.text.trim().slice(0, 2000)
        else { await askTelegramFollowUp(chatId, followUp, session.questionIndex); return ApiResponse.ok(res, { received: true }) }
        if (!skipped && (value === undefined || value === '')) return ApiResponse.ok(res, { received: true })
        if (callback) await markTelegramQuestionAnswered(callback, followUp, value, skipped)
        if (!skipped) session.answers = [...session.answers.filter((answer) => answer.questionId.toString() !== followUp._id.toString()), { questionId: followUp._id, value }]
        session.awaitingFollowUp = false
        session.selectedOptionIndex = null
        session.questionIndex += 1
      } else {
        if (callback?.data === `s:${session.questionIndex}` && question.required === false) skipped = true
        else if (callback?.data?.startsWith('a:')) {
          const [, indexRaw, optionRaw] = callback.data.split(':')
          if (Number(indexRaw) !== session.questionIndex || question.type === 'text') return ApiResponse.ok(res, { received: true })
          optionIndex = Number(optionRaw)
          value = question.type === 'rating' ? optionIndex + 1 : question.options[optionIndex]?.value
        } else if (message?.text && question.type === 'text') value = message.text.trim().slice(0, 2000)
        else { await askTelegramQuestion(chatId, survey, session.questionIndex); return ApiResponse.ok(res, { received: true }) }
        if (!skipped && (value === undefined || value === '')) return ApiResponse.ok(res, { received: true })
        if (callback) await markTelegramQuestionAnswered(callback, question, value, skipped)
        if (!skipped) session.answers = [...session.answers.filter((answer) => answer.questionId.toString() !== question.id), { questionId: question._id, value }]
        const followUp = optionIndex !== null ? question.options[optionIndex]?.followUp : null
        if (followUp?.enabled) {
          session.awaitingFollowUp = true
          session.selectedOptionIndex = optionIndex
          session.lastUpdateId = update.update_id || session.lastUpdateId
          await session.save()
          await askTelegramFollowUp(chatId, followUp, session.questionIndex)
          return ApiResponse.ok(res, { received: true })
        }
        session.questionIndex += 1
      }
      session.lastUpdateId = update.update_id || session.lastUpdateId
      if (session.questionIndex < survey.questions.length) {
        await session.save()
        await askTelegramQuestion(chatId, survey, session.questionIndex)
      } else {
        await SurveyResponse.findOneAndUpdate({ survey: survey._id, student: session.student }, { answers: session.answers, telegramChatId: chatId, completedAt: new Date() }, { upsert: true, new: true, runValidators: true })
        await TelegramSurveySession.deleteOne({ _id: session._id })
        req.app.get('io')?.emit('surveys:changed', { id: survey.id })
        await sendTelegramMessage(chatId, 'Hurmatli talaba, barcha javoblaringiz muvaffaqiyatli saqlandi. Qimmatli fikringiz va ajratgan vaqtingiz uchun tashakkur!', mainKeyboard)
      }
      return ApiResponse.ok(res, { received: true })
    } catch (error) { return next(error) }
  }

  list = async (_req, res, next) => {
    try {
      const surveys = await Survey.find().sort({ createdAt: -1 }).populate('createdBy', 'firstname lastname').lean()
      const counts = await SurveyResponse.aggregate([{ $group: { _id: '$survey', count: { $sum: 1 } } }])
      const countMap = new Map(counts.map((row) => [row._id.toString(), row.count]))
      return ApiResponse.ok(res, { surveys: surveys.map((row) => ({ ...row, id: row._id.toString(), responseCount: countMap.get(row._id.toString()) || 0 })) })
    } catch (error) { return next(error) }
  }

  activationRecipients = async (_req, res, next) => {
    try {
      const contracts = await StudentContract.find({ status: 'active' })
        .select('student room createdAt')
        .populate('student', 'fullName phone')
        .populate('room', 'roomNumber block floor')
        .sort({ createdAt: -1 })
      const latestByStudent = new Map()
      contracts.forEach((contract) => {
        if (contract.student && !latestByStudent.has(contract.student.id)) latestByStudent.set(contract.student.id, contract)
      })
      const studentIds = [...latestByStudent.keys()]
      const linkedStudentIds = new Set((await TelegramStudentLink.find({ student: { $in: studentIds } }).select('student')).map((link) => link.student.toString()))
      const students = [...latestByStudent.values()].map((contract) => ({
        id: contract.student.id,
        fullName: contract.student.fullName,
        phone: contract.student.phone,
        room: contract.room,
        telegramLinked: linkedStudentIds.has(contract.student.id),
      })).sort((a, b) => a.fullName.localeCompare(b.fullName, 'uz'))
      return ApiResponse.ok(res, { students, linkedCount: linkedStudentIds.size, total: students.length })
    } catch (error) { return next(error) }
  }

  get = async (req, res, next) => {
    try {
      if (!validId(req.params.id)) return ApiResponse.notFound(res, 'So‘rovnoma topilmadi')
      const survey = await Survey.findById(req.params.id)
      if (!survey) return ApiResponse.notFound(res, 'So‘rovnoma topilmadi')
      return ApiResponse.ok(res, { survey })
    } catch (error) { return next(error) }
  }

  create = async (req, res, next) => {
    try {
      const survey = await Survey.create({ title: req.body.title, description: req.body.description, questions: normalizeQuestions(req.body.questions), createdBy: req.employee._id })
      req.app.get('io')?.emit('surveys:changed', { id: survey.id })
      return ApiResponse.created(res, { survey }, 'So‘rovnoma yaratildi')
    } catch (error) { return error.message?.includes('kiriting') ? ApiResponse.badRequest(res, error.message) : next(error) }
  }

  update = async (req, res, next) => {
    try {
      if (!validId(req.params.id)) return ApiResponse.notFound(res, 'So‘rovnoma topilmadi')
      const survey = await Survey.findById(req.params.id)
      if (!survey) return ApiResponse.notFound(res, 'So‘rovnoma topilmadi')
      if (survey.status === 'active') return ApiResponse.conflict(res, 'Faol so‘rovnomani tahrirlashdan oldin yoping')
      survey.title = req.body.title
      survey.description = req.body.description || ''
      survey.questions = normalizeQuestions(req.body.questions)
      await survey.save()
      req.app.get('io')?.emit('surveys:changed', { id: survey.id })
      return ApiResponse.ok(res, { survey }, 'So‘rovnoma yangilandi')
    } catch (error) { return error.message?.includes('kiriting') ? ApiResponse.badRequest(res, error.message) : next(error) }
  }

  setStatus = async (req, res, next) => {
    try {
      if (!validId(req.params.id)) return ApiResponse.notFound(res, 'So‘rovnoma topilmadi')
      const status = req.body.status
      if (!['draft', 'active', 'closed'].includes(status)) return ApiResponse.badRequest(res, 'Holat noto‘g‘ri')
      if (status === 'active' && (!Array.isArray(req.body.studentIds) || !req.body.studentIds.some(validId))) return ApiResponse.badRequest(res, 'So‘rovnomani faollashtirish uchun kamida bitta talabani tanlang')
      if (status === 'active') await Survey.updateMany({ _id: { $ne: req.params.id }, status: 'active' }, { status: 'closed', closedAt: new Date() })
      const survey = await Survey.findByIdAndUpdate(req.params.id, { status, ...(status === 'active' ? { activatedAt: new Date(), closedAt: null } : {}), ...(status === 'closed' ? { closedAt: new Date() } : {}) }, { new: true })
      if (!survey) return ApiResponse.notFound(res, 'So‘rovnoma topilmadi')
      let notificationResult = null
      if (status === 'active') {
        const requestedIds = [...new Set((Array.isArray(req.body.studentIds) ? req.body.studentIds : []).filter(validId).map(String))]
        const activeStudentIds = requestedIds.length ? await StudentContract.distinct('student', { status: 'active', student: { $in: requestedIds } }) : []
        const linkRows = activeStudentIds.length ? await TelegramStudentLink.find({ student: { $in: activeStudentIds } }).select('chatId student').sort({ updatedAt: -1 }) : []
        const linkByStudent = new Map()
        linkRows.forEach((link) => { if (!linkByStudent.has(link.student.toString())) linkByStudent.set(link.student.toString(), link) })
        const links = [...linkByStudent.values()]
        const text = `📋 <b>Yangi so‘rovnoma</b>\n\n<b>${escapeTelegramHtml(survey.title)}</b>${survey.description ? `\n<i>${escapeTelegramHtml(survey.description)}</i>` : ''}\n\nHurmatli talaba, yotoqxona sharoitlarini yaxshilashga yordam berish uchun ushbu so‘rovnomada qatnashishingizni so‘raymiz. Fikringiz biz uchun muhim!`
        let sent = 0
        let failed = 0
        for (let index = 0; index < links.length; index += 20) {
          const results = await Promise.allSettled(links.slice(index, index + 20).map((link) => telegramCall('sendMessage', { chat_id: link.chatId, text, parse_mode: 'HTML', reply_markup: mainKeyboard })))
          sent += results.filter((result) => result.status === 'fulfilled').length
          failed += results.filter((result) => result.status === 'rejected').length
          if (index + 20 < links.length) await new Promise((resolve) => setTimeout(resolve, 1000))
        }
        notificationResult = { selected: requestedIds.length, sent, failed, unavailable: Math.max(0, requestedIds.length - links.length) }
      }
      req.app.get('io')?.emit('surveys:changed', { id: survey.id })
      return ApiResponse.ok(res, { survey, notificationResult })
    } catch (error) { return next(error) }
  }

  remove = async (req, res, next) => {
    try {
      const responseCount = await SurveyResponse.countDocuments({ survey: req.params.id })
      if (responseCount) return ApiResponse.conflict(res, 'Javoblari mavjud so‘rovnomani o‘chirib bo‘lmaydi; uni yoping')
      const survey = await Survey.findByIdAndDelete(req.params.id)
      if (!survey) return ApiResponse.notFound(res, 'So‘rovnoma topilmadi')
      req.app.get('io')?.emit('surveys:changed', { id: req.params.id })
      return ApiResponse.ok(res, null, 'So‘rovnoma o‘chirildi')
    } catch (error) { return next(error) }
  }

  results = async (req, res, next) => {
    try {
      if (!validId(req.params.id)) return ApiResponse.notFound(res, 'So‘rovnoma topilmadi')
      const survey = await Survey.findById(req.params.id).lean()
      if (!survey) return ApiResponse.notFound(res, 'So‘rovnoma topilmadi')
      const responses = await SurveyResponse.find({ survey: survey._id }).populate('student', 'fullName phone').sort({ completedAt: -1 }).lean()
      const sentiment = { positive: 0, neutral: 0, negative: 0 }
      const allQuestions = []
      survey.questions.forEach((question) => {
        allQuestions.push(question)
        question.options.forEach((option) => { if (option.followUp?.enabled) allQuestions.push(option.followUp) })
      })
      const questionStats = allQuestions.map((question) => ({ questionId: question._id.toString(), text: question.text, type: question.type, typeLabel: isYesNoQuestion(question) ? 'Ha / yo‘q' : questionTypeLabels[question.type], total: 0, values: {} }))
      const questionMap = new Map(allQuestions.map((question, index) => [question._id.toString(), { question, index }]))
      const rows = responses.map((response) => {
        let positive = 0; let negative = 0; let neutral = 0
        const answers = response.answers.map((answer) => {
          const match = questionMap.get(answer.questionId.toString())
          if (!match) return null
          const key = resultAnswerLabel(match.question, answer.value)
          questionStats[match.index].total += 1
          questionStats[match.index].values[key] = (questionStats[match.index].values[key] || 0) + 1
          const mood = answerSentiment(match.question, answer.value)
          if (mood) { sentiment[mood] += 1; if (mood === 'positive') positive += 1; else if (mood === 'negative') negative += 1; else neutral += 1 }
          return { questionId: answer.questionId, question: match.question.text, value: key }
        }).filter(Boolean)
        const personalMood = positive > negative ? 'positive' : negative > positive ? 'negative' : 'neutral'
        return { id: response._id.toString(), student: response.student, completedAt: response.completedAt, sentiment: personalMood, answers }
      })
      const scored = sentiment.positive + sentiment.neutral + sentiment.negative
      const percentages = Object.fromEntries(Object.entries(sentiment).map(([key, value]) => [key, scored ? Math.round(value * 100 / scored) : 0]))
      return ApiResponse.ok(res, { survey: { ...survey, id: survey._id.toString() }, summary: { responseCount: responses.length, sentiment, percentages }, questionStats, responses: rows })
    } catch (error) { return next(error) }
  }

  identifyStudent = async (req, res, next) => {
    try {
      const phone = cleanPhone(req.body.phone)
      if (phone.length !== 9) return ApiResponse.badRequest(res, 'Telefon raqamini 9 ta raqamda kiriting')
      const student = await Student.findOne({ phone }).select('fullName phone')
      if (!student) return ApiResponse.notFound(res, 'Bu telefon raqamli talaba topilmadi')
      const survey = await Survey.findOne({ status: 'active' }).sort({ activatedAt: -1 }).select('title description questions')
      if (!survey) return ApiResponse.notFound(res, 'Hozir faol so‘rovnoma mavjud emas')
      const completed = await SurveyResponse.exists({ survey: survey._id, student: student._id })
      return ApiResponse.ok(res, { student: { id: student.id, fullName: student.fullName }, survey, completed: Boolean(completed) })
    } catch (error) { return next(error) }
  }

  submitResponse = async (req, res, next) => {
    try {
      if (!validId(req.params.id) || !validId(req.body.studentId)) return ApiResponse.badRequest(res, 'Ma’lumotlar noto‘g‘ri')
      const survey = await Survey.findOne({ _id: req.params.id, status: 'active' })
      const student = await Student.findById(req.body.studentId)
      if (!survey || !student) return ApiResponse.notFound(res, 'Faol so‘rovnoma yoki talaba topilmadi')
      const supplied = new Map((req.body.answers || []).map((answer) => [String(answer.questionId), answer.value]))
      const answers = []
      for (const question of survey.questions) {
        const value = supplied.get(question.id)
        if (question.required && (value === undefined || value === null || value === '')) return ApiResponse.badRequest(res, `“${question.text}” savoliga javob bering`)
        if (value !== undefined && value !== null && value !== '') answers.push({ questionId: question._id, value })
      }
      const response = await SurveyResponse.findOneAndUpdate({ survey: survey._id, student: student._id }, { answers, telegramChatId: String(req.body.telegramChatId || ''), completedAt: new Date() }, { upsert: true, new: true, runValidators: true })
      req.app.get('io')?.emit('surveys:changed', { id: survey.id })
      return ApiResponse.ok(res, { responseId: response.id }, 'Javoblar saqlandi')
    } catch (error) { return next(error) }
  }
}

export const surveyController = new SurveyController()
