import mongoose from 'mongoose'
import { GeneralSetting } from '../models/GeneralSetting.js'
import { Payment } from '../models/Payment.js'
import { StudentContract } from '../models/StudentContract.js'
import { ApiResponse } from '../utils/response.js'

class DepositController {
  list = async (req, res, next) => {
    try {
      const search = String(req.query.search || '').trim().toLowerCase()
      const status = ['all', 'paid', 'partial', 'unpaid'].includes(req.query.status) ? req.query.status : 'all'
      const roomFilter = mongoose.isValidObjectId(req.query.room) ? String(req.query.room) : ''
      const [contracts, settings] = await Promise.all([
        StudentContract.find({ status: 'active' })
          .populate({ path: 'student', select: 'fullName phone parentPhone photo university faculty course', populate: [{ path: 'university', select: 'name' }, { path: 'faculty', select: 'name' }] })
          .populate('room', 'roomNumber block floor')
          .sort({ createdAt: -1 }),
        GeneralSetting.findOne({ key: 'general' }).lean(),
      ])
      const validContracts = contracts.filter((contract) => contract.student)
      const studentIds = [...new Set(validContracts.map((contract) => contract.student.id))]
      const paymentRows = studentIds.length ? await Payment.aggregate([
        { $match: { student: { $in: studentIds.map((id) => new mongoose.Types.ObjectId(id)) }, paymentPurpose: 'deposit', status: { $ne: 'cancelled' }, cancelledAt: null } },
        { $group: { _id: '$student', paid: { $sum: '$amount' }, lastPaidAt: { $max: '$createdAt' } } },
      ]) : []
      const paymentsByStudent = new Map(paymentRows.map((row) => [String(row._id), row]))
      const depositAmount = Number(settings?.depositAmount || 0)
      const rowsByStudent = new Map()
      validContracts.forEach((contract) => {
        const studentId = contract.student.id
        if (rowsByStudent.has(studentId)) return
        const payment = paymentsByStudent.get(studentId)
        const depositPaid = Number(payment?.paid || 0)
        const depositRemaining = Math.max(0, depositAmount - depositPaid)
        const depositStatus = depositRemaining <= 0 ? 'paid' : depositPaid > 0 ? 'partial' : 'unpaid'
        rowsByStudent.set(studentId, { student: contract.student, contract, room: contract.room, depositAmount, depositPaid, depositRemaining, depositStatus, lastPaidAt: payment?.lastPaidAt || null })
      })
      let scopedRows = [...rowsByStudent.values()]
      if (roomFilter) scopedRows = scopedRows.filter((row) => row.room?.id === roomFilter)
      if (search) scopedRows = scopedRows.filter((row) => `${row.student.fullName || ''} ${row.student.phone || ''} ${row.student.parentPhone || ''} ${row.contract.contractNumber || ''} ${row.room?.block || ''} ${row.room?.roomNumber || ''}`.toLowerCase().includes(search))
      const summary = {
        studentCount: scopedRows.length,
        totalDeposits: scopedRows.reduce((sum, row) => sum + row.depositAmount, 0),
        paidDeposits: scopedRows.reduce((sum, row) => sum + row.depositPaid, 0),
        unpaidDeposits: scopedRows.reduce((sum, row) => sum + row.depositRemaining, 0),
        paidCount: scopedRows.filter((row) => row.depositStatus === 'paid').length,
        partialCount: scopedRows.filter((row) => row.depositStatus === 'partial').length,
        unpaidCount: scopedRows.filter((row) => row.depositStatus === 'unpaid').length,
        depositAmount,
      }
      const filteredRows = status === 'all' ? scopedRows : scopedRows.filter((row) => row.depositStatus === status)
      const total = filteredRows.length
      const limit = 30
      const totalPages = Math.max(1, Math.ceil(total / limit))
      const page = Math.min(Math.max(1, Number.parseInt(req.query.page, 10) || 1), totalPages)
      const deposits = filteredRows.slice((page - 1) * limit, page * limit)
      return ApiResponse.ok(res, { deposits, summary, pagination: { page, limit, total, totalPages } })
    } catch (error) { return next(error) }
  }
}

export const depositController = new DepositController()
