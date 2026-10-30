import mongoose from 'mongoose'
import { Complaint } from '../models/Complaint.js'
import { StudentContract } from '../models/StudentContract.js'
import { ApiResponse } from '../utils/response.js'
import { sendTelegramMessage } from '../utils/telegram.js'

const statuses = ['new', 'in_progress', 'resolved']
const statusMessages = {
  new: 'Shikoyatingiz qabul qilindi.',
  in_progress: 'Shikoyatingiz xodimlar tomonidan ko‘rib chiqilmoqda.',
  resolved: 'Shikoyatingiz bo‘yicha ish bajarildi.',
}

class ComplaintController {
  list = async (req, res, next) => {
    try {
      const page = Math.max(1, Number(req.query.page) || 1)
      const limit = 20
      const filter = {}
      if (statuses.includes(req.query.status)) filter.status = req.query.status
      if (req.query.search) {
        const term = String(req.query.search).trim()
        const students = await mongoose.model('Student').find({ fullName: { $regex: term, $options: 'i' } }).select('_id').limit(100)
        filter.$or = [{ text: { $regex: term, $options: 'i' } }, { student: { $in: students.map((item) => item._id) } }]
      }
      const [complaints, total, grouped] = await Promise.all([
        Complaint.find(filter).populate('student', 'fullName phone').populate('room', 'roomNumber block floor').populate('handledBy', 'firstname lastname').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
        Complaint.countDocuments(filter),
        Complaint.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      ])
      const summary = { total: 0, new: 0, in_progress: 0, resolved: 0 }
      grouped.forEach((row) => { summary[row._id] = row.count; summary.total += row.count })
      const missingStudentIds = complaints.filter((complaint) => !complaint.room && complaint.student).map((complaint) => complaint.student._id)
      const fallbackContracts = missingStudentIds.length ? await StudentContract.find({ student: { $in: missingStudentIds }, status: 'active' }).sort({ createdAt: -1 }).populate('room', 'roomNumber block floor') : []
      const roomByStudent = new Map()
      fallbackContracts.filter((contract) => contract.room).forEach((contract) => {
        const studentId = contract.student.toString()
        if (!roomByStudent.has(studentId)) roomByStudent.set(studentId, contract.room)
      })
      const complaintRows = complaints.map((complaint) => {
        const row = complaint.toJSON()
        if (!row.room && row.student) row.room = roomByStudent.get(String(row.student.id || row.student._id)) || null
        return row
      })
      return ApiResponse.ok(res, { complaints: complaintRows, summary, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
    } catch (error) { return next(error) }
  }

  update = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Shikoyat topilmadi')
      if (!statuses.includes(req.body.status)) return ApiResponse.badRequest(res, 'Shikoyat holati noto‘g‘ri')
      const complaint = await Complaint.findByIdAndUpdate(req.params.id, {
        status: req.body.status,
        staffNote: String(req.body.staffNote || '').trim(),
        handledBy: req.employee._id,
        resolvedAt: req.body.status === 'resolved' ? new Date() : null,
      }, { new: true, runValidators: true }).populate('student', 'fullName phone').populate('room', 'roomNumber block floor').populate('handledBy', 'firstname lastname')
      if (!complaint) return ApiResponse.notFound(res, 'Shikoyat topilmadi')
      req.app.get('io')?.emit('complaints:changed', { id: complaint.id })
      if (complaint.telegramChatId) {
        const note = complaint.staffNote ? `\n\nXodim izohi: ${complaint.staffNote}` : ''
        sendTelegramMessage(complaint.telegramChatId, `${statusMessages[complaint.status]}\nMurojaat: #${complaint.id.slice(-6).toUpperCase()}${note}`).catch((error) => console.error(`Talabaga shikoyat holati yuborilmadi: ${error.message}`))
      }
      return ApiResponse.ok(res, { complaint }, 'Shikoyat holati yangilandi')
    } catch (error) { return next(error) }
  }
}

export const complaintController = new ComplaintController()
