import mongoose from 'mongoose'
import { GeneralSetting } from '../models/GeneralSetting.js'
import { Payment } from '../models/Payment.js'
import { StudentContract } from '../models/StudentContract.js'
import { DepositRefund } from '../models/DepositRefund.js'
import { ContractInstallment } from '../models/ContractInstallment.js'
import { ApiResponse } from '../utils/response.js'
import { parsePaymentDate } from '../utils/paymentTime.js'
import { PAYMENT_METHODS } from '../utils/paymentParts.js'
import { applyDepositPolicy, depositError, depositStates, depositTotals, lockDeposit, validateDepositPolicy } from '../services/deposits.js'

const actorFields = 'firstname lastname role'
const refundPopulate = ['refundedBy', 'cancelledBy', 'auditHistory.performedBy'].map((path) => ({ path, select: actorFields }))
const refundSnapshot = (refund) => ({ amount: refund.amount, method: refund.method, refundDate: refund.refundDate, note: refund.note || '' })
const statuses = ['paid', 'partial', 'unpaid', 'refunded', 'partially_refunded', 'disabled', 'cancelled']

class DepositController {
  emit(req, contract) {
    const studentId = String(contract.student?._id || contract.student)
    req.app.get('io')?.emit('deposits:changed', { studentId, contractId: String(contract._id) })
    req.app.get('io')?.emit('payments:changed', { action: 'deposit-changed', studentId })
    req.app.get('io')?.emit('student-contracts:changed', { action: 'deposit-changed', studentId })
    req.app.get('io')?.emit('cash-sessions:changed', { action: 'deposit-refund' })
  }

  list = async (req, res, next) => {
    try {
      const search = String(req.query.search || '').trim().toLowerCase()
      const status = statuses.includes(req.query.status) ? req.query.status : 'all'
      const roomFilter = mongoose.isValidObjectId(req.query.room) ? String(req.query.room) : ''
      const [contracts, settings] = await Promise.all([
        StudentContract.find({ $or: [{ status: 'active' }, { depositEnabled: true }, { depositCancelledAt: { $ne: null } }] })
          .populate({ path: 'student', select: 'fullName phone parentPhone photo university faculty course', populate: [{ path: 'university', select: 'name' }, { path: 'faculty', select: 'name' }] })
          .populate('room', 'roomNumber block floor').sort({ createdAt: -1 }),
        GeneralSetting.findOne({ key: 'general' }).lean(),
      ])
      const states = await depositStates(contracts)
      let rows = contracts.filter((contract) => contract.student).map((contract) => ({ student: contract.student, contract, room: contract.room, ...states.get(String(contract._id)) }))
      if (mongoose.isValidObjectId(req.query.student)) rows = rows.filter((row) => row.student.id === String(req.query.student))
      if (roomFilter) rows = rows.filter((row) => row.room?.id === roomFilter)
      if (search) rows = rows.filter((row) => `${row.student.fullName} ${row.student.phone} ${row.student.parentPhone} ${row.contract.contractNumber} ${row.room?.block || ''} ${row.room?.roomNumber || ''}`.toLowerCase().includes(search))
      const summary = {
        studentCount: new Set(rows.map((row) => row.student.id)).size,
        totalDeposits: rows.reduce((sum, row) => sum + row.depositAmount, 0),
        paidDeposits: rows.reduce((sum, row) => sum + row.depositPaid, 0),
        refundedDeposits: rows.reduce((sum, row) => sum + row.depositRefunded, 0),
        heldDeposits: rows.reduce((sum, row) => sum + row.depositHeld, 0),
        unpaidDeposits: rows.reduce((sum, row) => sum + row.depositRemaining, 0),
        paidCount: rows.filter((row) => row.depositStatus === 'paid').length,
        partialCount: rows.filter((row) => row.depositStatus === 'partial').length,
        unpaidCount: rows.filter((row) => row.depositStatus === 'unpaid').length,
        depositAmount: Number(settings?.depositAmount || 0),
      }
      const filtered = status === 'all' ? rows : rows.filter((row) => row.depositStatus === status)
      const total = filtered.length, limit = 30, totalPages = Math.max(1, Math.ceil(total / limit))
      const page = Math.min(Math.max(1, Number.parseInt(req.query.page, 10) || 1), totalPages)
      return ApiResponse.ok(res, { deposits: filtered.slice((page - 1) * limit, page * limit), summary, pagination: { page, limit, total, totalPages } })
    } catch (error) { return next(error) }
  }

  history = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.contractId)) return ApiResponse.notFound(res, 'Shartnoma topilmadi')
      const contract = await StudentContract.findById(req.params.contractId).populate('depositHistory.performedBy', actorFields)
      if (!contract) return ApiResponse.notFound(res, 'Shartnoma topilmadi')
      const [payments, refunds] = await Promise.all([
        Payment.find({ contract: contract._id, paymentPurpose: 'deposit' }).populate('receivedBy cancelledBy auditHistory.performedBy', actorFields).sort({ createdAt: -1 }),
        DepositRefund.find({ contract: contract._id }).populate(refundPopulate).sort({ createdAt: -1 }),
      ])
      const installments = await ContractInstallment.find({ contract: contract._id }).select('_id periodKey').lean()
      return ApiResponse.ok(res, { payments, refunds, installments, policyHistory: contract.depositHistory || [] })
    } catch (error) { return next(error) }
  }

  update = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.contractId)) return ApiResponse.notFound(res, 'Shartnoma topilmadi')
      const contract = await mongoose.connection.transaction(async (session) => {
        const contract = await lockDeposit(req.params.contractId, session)
        const enabled = req.method !== 'DELETE' && req.body.depositEnabled === true
        const amount = enabled ? Number(req.body.depositAmount) : 0
        await validateDepositPolicy(contract, enabled, amount, session)
        applyDepositPolicy(contract, enabled, amount, req.employee._id, String(req.body.note || '').trim())
        await contract.save({ session })
        return contract
      })
      this.emit(req, contract)
      return ApiResponse.ok(res, { contract }, req.method === 'DELETE' ? 'Deposit bekor qilindi. To‘lovlar va qaytarish tarixi saqlandi' : 'Deposit yangilandi')
    } catch (error) { return next(error) }
  }

  refund = async (req, res, next) => {
    try {
      const editing = req.method !== 'POST', cancelling = req.method === 'DELETE'
      if (!mongoose.isValidObjectId(editing ? req.params.id : req.params.contractId)) return ApiResponse.notFound(res, 'Deposit topilmadi')
      // Resolve only the lock key before entering the transaction; reload the
      // receipt after acquiring the contract lock so retries cannot use stale data.
      const previous = editing ? await DepositRefund.findById(req.params.id) : null
      if (editing && !previous) return ApiResponse.notFound(res, 'Qaytarish topilmadi')
      let contract
      const refund = await mongoose.connection.transaction(async (session) => {
        contract = await lockDeposit(editing ? previous.contract : req.params.contractId, session)
        const refund = editing ? await DepositRefund.findById(req.params.id).session(session) : new DepositRefund({ student: contract.student, contract: contract._id, refundedBy: req.employee._id })
        if (refund.status === 'cancelled') throw depositError('Bekor qilingan qaytarishni o‘zgartirib bo‘lmaydi')
        const before = editing ? refundSnapshot(refund) : undefined
        if (cancelling) {
          refund.status = 'cancelled'; refund.cancelledAt = new Date(); refund.cancelledBy = req.employee._id
        } else {
          const amount = Number(req.body.amount), refundDate = parsePaymentDate(req.body.refundDate)
          if (!Number.isSafeInteger(amount) || amount <= 0) throw depositError('Qaytarish summasini to‘g‘ri kiriting', 400)
          if (!PAYMENT_METHODS.includes(req.body.method)) throw depositError('Qaytarish usulini tanlang', 400)
          if (!refundDate) throw depositError('Qaytarish sanasini tanlang', 400)
          const totals = await depositTotals(contract._id, session, { excludeRefund: editing ? refund._id : null })
          const available = Math.max(0, totals.paid - totals.refunded)
          if (amount > available) throw depositError(`Maksimal qaytarish: ${available.toLocaleString('uz-UZ')} so‘m`)
          refund.set({ amount, method: req.body.method, refundDate, note: String(req.body.note || '').trim() })
        }
        refund.auditHistory.push({ action: cancelling ? 'cancelled' : editing ? 'updated' : 'created', performedBy: req.employee._id, before, after: cancelling ? undefined : refundSnapshot(refund) })
        await refund.save({ session })
        return refund
      })
      await refund.populate(refundPopulate)
      this.emit(req, contract)
      return ApiResponse.ok(res, { refund }, cancelling ? 'Qaytarish bekor qilindi' : editing ? 'Qaytarish yangilandi' : 'Deposit qaytarildi')
    } catch (error) { return next(error) }
  }
}

export const depositController = new DepositController()
