import mongoose from 'mongoose'
import { BlacklistEntry } from '../models/BlacklistEntry.js'
import { Faculty } from '../models/Faculty.js'
import { Student } from '../models/Student.js'
import { StudentContract } from '../models/StudentContract.js'
import { University } from '../models/University.js'
import { ApiResponse } from '../utils/response.js'
import { uploadImages } from '../utils/imgbb.js'

class StudentController {
  history = async (req, res, next) => {
    try {
      const now = new Date()
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const activeStudentIds = await StudentContract.distinct('student', { status: 'active', endDate: { $gte: todayStart } })
      const contractFilter = { student: { $nin: activeStudentIds }, $or: [{ status: { $in: ['completed', 'cancelled'] } }, { status: 'active', endDate: { $lt: todayStart } }] }
      if (/^\d{4}-\d{2}$/.test(String(req.query.month || ''))) {
        const start = new Date(`${req.query.month}-01T00:00:00`)
        const end = new Date(start.getFullYear(), start.getMonth() + 1, 1)
        contractFilter.$and = [{ $or: [{ cancelledAt: { $gte: start, $lt: end } }, { cancelledAt: null, endDate: { $gte: start, $lt: end } }] }]
      }
      const contracts = await StudentContract.find(contractFilter)
        .populate({ path: 'student', select: 'fullName phone parentPhone photo university faculty course gender jshr', populate: [{ path: 'university', select: 'name shortName' }, { path: 'faculty', select: 'name' }] })
        .populate('room', 'roomNumber block floor')
        .sort({ endDate: -1, cancelledAt: -1 })
      const latestMap = new Map()
      contracts.filter((item) => item.student).forEach((item) => { if (!latestMap.has(item.student.id)) latestMap.set(item.student.id, item) })
      const latestByStudent = [...latestMap.values()]
      const search = String(req.query.search || '').trim().toLowerCase()
      let rows = search ? latestByStudent.filter((item) => `${item.student.fullName} ${item.student.phone} ${item.student.jshr} ${item.room?.block || ''} ${item.room?.roomNumber || ''} ${item.contractNumber}`.toLowerCase().includes(search)) : latestByStudent
      const total = rows.length
      const limit = 25
      const totalPages = Math.max(1, Math.ceil(total / limit))
      const page = Math.min(Math.max(1, Number.parseInt(req.query.page, 10) || 1), totalPages)
      rows = rows.slice((page - 1) * limit, page * limit).map((contract) => ({ student: contract.student, contract }))
      return ApiResponse.ok(res, { rows, summary: { total }, pagination: { page, limit, total, totalPages } })
    } catch (error) { return next(error) }
  }

  cleanPayload(body) {
    return {
      fullName: String(body.fullName || '').trim(),
      phone: String(body.phone || '').replace(/\s/g, ''),
      gender: body.gender,
      parentPhone: String(body.parentPhone || '').replace(/\s/g, ''),
      university: body.university,
      faculty: body.faculty,
      address: String(body.address || '').trim(),
      course: Number(body.course),
      studentStatus: ['green', 'warning', 'red'].includes(body.studentStatus) ? body.studentStatus : 'green',
      hasTaxContract: body.hasTaxContract === true || body.hasTaxContract === 'true',
      disciplinaryStatus: body.disciplinaryStatus || 'clear',
      disciplinaryNote: body.disciplinaryStatus === 'blacklisted' ? String(body.disciplinaryNote || '').trim() : '',
      disabilityStatus: body.disabilityStatus || 'none',
      jshr: String(body.jshr || '').replace(/\D/g, ''),
      passportSeries: String(body.passportSeries || '').trim().toUpperCase(),
      passportNumber: String(body.passportNumber || '').replace(/\D/g, ''),
    }
  }

  async validateEducation(payload, res) {
    if (!mongoose.isValidObjectId(payload.university) || !(await University.exists({ _id: payload.university }))) return ApiResponse.badRequest(res, 'Universitetni to‘g‘ri tanlang')
    if (!mongoose.isValidObjectId(payload.faculty) || !(await Faculty.exists({ _id: payload.faculty, university: payload.university }))) return ApiResponse.badRequest(res, 'Tanlangan fakultet bu universitetga tegishli emas')
    return null
  }

  emitChange(req, action, student) {
    req.app.get('io')?.emit('students:changed', { action, studentId: student?.id || student?._id?.toString(), occurredAt: new Date().toISOString() })
  }

  findBlacklist(payload) {
    return BlacklistEntry.findOne({ active: true, $or: [{ jshr: payload.jshr }, { passportSeries: payload.passportSeries, passportNumber: payload.passportNumber }] })
  }

  async syncBlacklist(student) {
    const identity = { jshr: student.jshr, passportSeries: student.passportSeries, passportNumber: student.passportNumber }
    const entry = await BlacklistEntry.findOne({ $or: [{ sourceStudent: student._id }, { jshr: student.jshr }, { passportSeries: student.passportSeries, passportNumber: student.passportNumber }] })
    if (student.disciplinaryStatus === 'blacklisted') {
      if (entry) {
        entry.set({ ...identity, reason: student.disciplinaryNote, sourceStudent: student._id, active: true })
        await entry.save()
      } else await BlacklistEntry.create({ ...identity, reason: student.disciplinaryNote, sourceStudent: student._id, active: true })
    } else if (entry?.sourceStudent?.toString() === student.id) {
      entry.active = false
      await entry.save()
    }
  }

  checkBlacklist = async (req, res, next) => {
    try {
      const jshr = String(req.query.jshr || '').replace(/\D/g, '')
      const passport = String(req.query.passport || '').replace(/\s/g, '').toUpperCase()
      const passportSeries = passport.slice(0, 2)
      const passportNumber = passport.slice(2)
      const conditions = []
      if (/^\d{14}$/.test(jshr)) conditions.push({ jshr })
      if (/^[A-Z]{2}\d{7}$/.test(passport)) conditions.push({ passportSeries, passportNumber })
      if (!conditions.length) return ApiResponse.ok(res, { blocked: false })
      const entry = await BlacklistEntry.findOne({ active: true, $or: conditions }).sort({ updatedAt: -1 })
      return ApiResponse.ok(res, entry ? { blocked: true, reason: entry.reason, blockedAt: entry.updatedAt } : { blocked: false })
    } catch (error) { return next(error) }
  }

  list = async (req, res, next) => {
    try {
      const filter = {}
      const search = String(req.query.search || '').trim()
      if (search) {
        const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        filter.$or = ['fullName', 'phone', 'jshr', 'passportNumber'].map((field) => ({ [field]: { $regex: escapedSearch, $options: 'i' } }))
        const passportSearch = search.replace(/\s/g, '').toUpperCase()
        const passportMatch = passportSearch.match(/^([A-Z]{1,2})(\d{0,7})$/)
        if (passportMatch) {
          const [, series, number] = passportMatch
          filter.$or.push(number
            ? { $and: [{ passportSeries: { $regex: `^${series}`, $options: 'i' } }, { passportNumber: { $regex: `^${number}` } }] }
            : { passportSeries: { $regex: `^${series}`, $options: 'i' } })
        }
      }
      if (mongoose.isValidObjectId(req.query.university)) filter.university = req.query.university
      if (mongoose.isValidObjectId(req.query.faculty)) filter.faculty = req.query.faculty
      const course = Number.parseInt(req.query.course, 10)
      if (course >= 1 && course <= 6) filter.course = course
      if (mongoose.isValidObjectId(req.query.room)) {
        const studentIds = await StudentContract.distinct('student', { room: req.query.room, status: 'active' })
        filter._id = { $in: studentIds }
      }
      const limit = 25
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
      const total = await Student.countDocuments(filter)
      const totalPages = Math.max(1, Math.ceil(total / limit))
      const currentPage = Math.min(page, totalPages)
      const students = await Student.find(filter)
        .populate('university', 'name shortName')
        .populate('faculty', 'name')
        .sort({ createdAt: -1 })
        .skip((currentPage - 1) * limit)
        .limit(limit)
      return ApiResponse.ok(res, { students, pagination: { page: currentPage, limit, total, totalPages } })
    } catch (error) { return next(error) }
  }

  getById = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Talaba topilmadi')
      const student = await Student.findById(req.params.id).populate('university', 'name shortName').populate('faculty', 'name')
      if (!student) return ApiResponse.notFound(res, 'Talaba topilmadi')
      return ApiResponse.ok(res, { student })
    } catch (error) { return next(error) }
  }

  create = async (req, res, next) => {
    try {
      const payload = this.cleanPayload(req.body)
      if (await this.validateEducation(payload, res)) return undefined
      if (payload.disciplinaryStatus === 'blacklisted' && !payload.disciplinaryNote) return ApiResponse.badRequest(res, 'Qora ro‘yxat sababini kiriting')
      const blocked = await this.findBlacklist(payload)
      if (blocked) return ApiResponse.conflict(res, `Bu shaxs qora ro‘yxatda: ${blocked.reason}`)
      payload.photo = req.file ? (await uploadImages([req.file]))[0] : null
      const student = await Student.create(payload)
      await this.syncBlacklist(student)
      await student.populate([{ path: 'university', select: 'name shortName' }, { path: 'faculty', select: 'name' }])
      this.emitChange(req, 'created', student)
      return ApiResponse.created(res, { student }, 'Talaba qo‘shildi')
    } catch (error) { return next(error) }
  }

  update = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Talaba topilmadi')
      const student = await Student.findById(req.params.id)
      if (!student) return ApiResponse.notFound(res, 'Talaba topilmadi')
      const payload = this.cleanPayload(req.body)
      if (await this.validateEducation(payload, res)) return undefined
      if (payload.disciplinaryStatus === 'blacklisted' && !payload.disciplinaryNote) return ApiResponse.badRequest(res, 'Qora ro‘yxat sababini kiriting')
      const blocked = await this.findBlacklist(payload)
      if (blocked && blocked.sourceStudent?.toString() !== student.id) return ApiResponse.conflict(res, `Bu shaxs qora ro‘yxatda: ${blocked.reason}`)
      const uploaded = req.file ? (await uploadImages([req.file]))[0] : null
      payload.photo = req.body.removePhoto ? null : uploaded || student.photo || null
      student.set(payload)
      await student.save()
      await this.syncBlacklist(student)
      await student.populate([{ path: 'university', select: 'name shortName' }, { path: 'faculty', select: 'name' }])
      this.emitChange(req, 'updated', student)
      return ApiResponse.ok(res, { student }, 'Talaba yangilandi')
    } catch (error) { return next(error) }
  }

  remove = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Talaba topilmadi')
      const student = await Student.findByIdAndDelete(req.params.id)
      if (!student) return ApiResponse.notFound(res, 'Talaba topilmadi')
      this.emitChange(req, 'deleted', student)
      return ApiResponse.ok(res, { studentId: student.id }, 'Talaba o‘chirildi')
    } catch (error) { return next(error) }
  }
}

export const studentController = new StudentController()
