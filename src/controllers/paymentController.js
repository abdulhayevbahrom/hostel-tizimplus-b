import mongoose from 'mongoose'
import { Payment } from '../models/Payment.js'
import { StudentContract } from '../models/StudentContract.js'
import { ContractInstallment } from '../models/ContractInstallment.js'
import { CashSession } from '../models/CashSession.js'
import { Employee } from '../models/Employee.js'
import { Notification } from '../models/Notification.js'
import { Student } from '../models/Student.js'
import { GeneralSetting } from '../models/GeneralSetting.js'
import { ApiResponse } from '../utils/response.js'
import { periodKeyInTashkent, tashkentDayEnd, tashkentDayStart } from '../utils/paymentTime.js'
import { buildPaymentParts, effectivePaymentParts, PAYMENT_METHODS, paymentFundHolderValue, paymentMethodValue, paymentPartsTotal } from '../utils/paymentParts.js'

const paymentPopulate = [
  { path: 'student', select: 'fullName phone photo' },
  { path: 'contract', select: 'contractNumber totalAmount paymentType room', populate: { path: 'room', select: 'roomNumber block' } },
  { path: 'allocations.installment', select: 'periodKey dueDate amount paidAmount status' },
  { path: 'receivedBy', select: 'firstname lastname role' },
  { path: 'cashSession', select: 'status expectedAmount closedAt' },
  { path: 'cancelledBy', select: 'firstname lastname role' },
  { path: 'auditHistory.performedBy', select: 'firstname lastname role' },
]

const snapshot = (payment) => ({ amount: payment.amount, method: payment.method, fundHolder: payment.fundHolder || 'organization', paymentParts: effectivePaymentParts(payment), cashSession: payment.cashSession || null, note: payment.note || '' })

const adjustCashSession = async (payment, oldSnapshot, newSnapshot, cancelled = false, session = null) => {
  const cashSessionId = oldSnapshot.cashSession || payment.cashSession
  if (!cashSessionId) return
  const cashSession = await CashSession.findById(cashSessionId).session(session)
  // Open sessions are calculated directly from Payment records, so persisting a
  // second counter here would double count. The fields below support legacy
  // sessions where payments were linked directly to a closed session.
  if (!cashSession || cashSession.status === 'open') return
  const oldParts = oldSnapshot.paymentParts || [{ method: oldSnapshot.method, amount: oldSnapshot.amount, fundHolder: oldSnapshot.fundHolder }]
  const newParts = cancelled ? [] : (newSnapshot.paymentParts || [{ method: newSnapshot.method, amount: newSnapshot.amount, fundHolder: newSnapshot.fundHolder }])
  const oldCashierParts = oldParts.filter((part) => part.fundHolder === 'cashier')
  const newCashierParts = newParts.filter((part) => part.fundHolder === 'cashier')
  const oldAmount = paymentPartsTotal(oldCashierParts)
  const newAmount = paymentPartsTotal(newCashierParts)
  const amountDelta = newAmount - oldAmount
  cashSession.expectedAmount = Math.max(0, cashSession.expectedAmount + amountDelta)
  cashSession.paymentCount = Math.max(0, cashSession.paymentCount + (Boolean(oldCashierParts.length) === Boolean(newCashierParts.length) ? 0 : newCashierParts.length ? 1 : -1))
  if (cashSession.breakdown) {
    oldCashierParts.forEach((part) => { cashSession.breakdown[part.method] = Math.max(0, Number(cashSession.breakdown[part.method] || 0) - part.amount) })
    newCashierParts.forEach((part) => { cashSession.breakdown[part.method] = Number(cashSession.breakdown[part.method] || 0) + part.amount })
  }
  if (cashSession.status === 'approved' && cashSession.receivedAmount !== null) cashSession.receivedAmount = Math.max(0, cashSession.receivedAmount + amountDelta)
  await cashSession.save({ session })
}

class PaymentController {
  emit(req, action, payment) {
    req.app.get('io')?.emit('payments:changed', { action, paymentId: payment?.id || payment?._id?.toString(), studentId: payment?.student?._id?.toString?.() || payment?.student?.toString?.() })
    req.app.get('io')?.emit('student-contracts:changed', { action: `payment-${action}`, studentId: payment?.student?._id?.toString?.() || payment?.student?.toString?.() })
    req.app.get('io')?.emit('debtors:changed', { action: `payment-${action}`, studentId: payment?.student?._id?.toString?.() || payment?.student?.toString?.() })
  }

  notifyCashier = async (req, payment, action, before = null) => {
    try {
      if (!payment.receivedBy || payment.receivedBy.toString() === req.employee.id) return
      const cashier = await Employee.findOne({ _id: payment.receivedBy, role: 'cashier' }).select('_id')
      if (!cashier) return
      const ownerName = `${req.employee.firstname} ${req.employee.lastname}`.trim()
      const student = await payment.populate({ path: 'student', select: 'fullName' })
      const actionText = action === 'updated' ? 'tahrirladi' : 'bekor qildi'
      const detail = action === 'updated' && before ? ` (${before.amount.toLocaleString('uz-UZ')} → ${payment.amount.toLocaleString('uz-UZ')} so‘m)` : ''
      await Notification.create({
        eventKey: `payment-${action}:${payment.id}:${Date.now()}`,
        type: 'payment_change', title: action === 'updated' ? 'To‘lov tahrirlandi' : 'To‘lov bekor qilindi',
        message: `${ownerName} siz qabul qilgan ${student.student?.fullName || 'talaba'} to‘lovini ${actionText}${detail}`,
        count: 1, targetPath: '/payments', targetEmployees: [cashier._id],
      })
      req.app.get('io')?.emit('notifications:changed', { type: 'payment_change', employeeId: cashier.id })
    } catch (error) {
      // The financial transaction has already committed. A notification failure
      // must never make the client retry and accidentally submit it again.
      console.error('Payment notification failed', error)
    }
  }

  list = async (req, res, next) => {
    try {
      const { search = '', method = '', from = '', to = '', period = '' } = req.query
      const filter = {}
      if (method && PAYMENT_METHODS.includes(method)) filter.$and = [{ $or: [{ method }, { paymentParts: { $elemMatch: { method, amount: { $gt: 0 } } } }] }]
      if (from || to) filter.createdAt = { ...(from ? { $gte: new Date(`${from}T00:00:00+05:00`) } : {}), ...(to ? { $lte: new Date(`${to}T23:59:59.999+05:00`) } : {}) }
      const [financialContractIds, financialStudentIds] = await Promise.all([
        StudentContract.distinct('_id', { status: { $ne: 'cancelled' } }),
        Student.distinct('_id'),
      ])
      const periodInstallments = period ? await ContractInstallment.find({ periodKey: period, contract: { $in: financialContractIds } }).select('_id student amount paidAmount dueDate').lean() : []
      if (period) {
        const [year, month] = period.split('-').map(Number)
        const periodStart = new Date(`${period}-01T00:00:00+05:00`)
        const nextPeriod = `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}`
        const periodEnd = new Date(`${nextPeriod}-01T00:00:00+05:00`)
        filter.$and = [{ $or: [{ paymentPurpose: { $ne: 'deposit' }, 'allocations.installment': { $in: periodInstallments.map((item) => item._id) } }, { paymentPurpose: 'deposit', createdAt: { $gte: periodStart, $lt: periodEnd } }] }]
      }
      filter.$and = [...(filter.$and || []), { $or: [{ contract: { $in: financialContractIds } }, { paymentPurpose: 'deposit', student: { $in: financialStudentIds } }] }]
      const needle = String(search).trim().toLowerCase()
      if (needle) {
        const escapedNeedle = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const pattern = new RegExp(escapedNeedle, 'i')
        const [matchingStudentIds, matchingContractIds] = await Promise.all([
          Student.distinct('_id', { _id: { $in: financialStudentIds }, $or: [{ fullName: pattern }, { phone: pattern }] }),
          StudentContract.distinct('_id', { _id: { $in: financialContractIds }, contractNumber: pattern }),
        ])
        filter.$and = [...(filter.$and || []), { $or: [{ student: { $in: matchingStudentIds } }, { contract: { $in: matchingContractIds } }] }]
      }
      const limit = 30
      const requestedPage = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
      const total = await Payment.countDocuments(filter)
      const totalPages = Math.max(1, Math.ceil(total / limit))
      const page = Math.min(requestedPage, totalPages)
      const payments = await Payment.find(filter).populate(paymentPopulate).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      const reportInstallments = period ? periodInstallments : await ContractInstallment.find({ contract: { $in: financialContractIds } }).select('student amount paidAmount periodKey dueDate').lean()
      const validStudentIds = new Set(financialStudentIds.map((id) => id.toString()))
      const studentInstallments = reportInstallments.filter((item) => validStudentIds.has(item.student.toString()))
      // Old orphaned contracts can remain in legacy data after their student was
      // removed. They cannot appear in student/debtor lists, so exclude them
      // from every summary card as well.
      const billed = studentInstallments.reduce((sum, item) => sum + item.amount, 0)
      const paid = studentInstallments.reduce((sum, item) => sum + item.paidAmount, 0)
      const allStudents = new Set(studentInstallments.map((item) => item.student.toString()))
      const paidStudents = new Set(studentInstallments.filter((item) => item.paidAmount > 0).map((item) => item.student.toString()))
      const now = new Date(); const currentKey = periodKeyInTashkent(now)
      const todayEnd = tashkentDayEnd(now)
      const isFuturePeriod = Boolean(period && period > currentKey)
      const waitingInstallments = studentInstallments.filter((item) => new Date(item.dueDate) > todayEnd)
      // Keep the financial cards on the same scope: billed and paid include every
      // installment in the selected period, so debt must be their remaining
      // balance too. Generated due dates only distinguish future-period
      // installments that are still waiting.
      const debt = isFuturePeriod ? 0 : studentInstallments.reduce((sum, item) => sum + Math.max(0, item.amount - item.paidAmount), 0)
      const waitingStudentIds = new Set(waitingInstallments.filter((item) => item.paidAmount < item.amount).map((item) => item.student.toString()))
      return ApiResponse.ok(res, { payments, summary: { billed, paid, debt, paidStudents: paidStudents.size, unpaidStudents: Math.max(0, allStudents.size - paidStudents.size), waitingStudents: waitingStudentIds.size, studentCount: allStudents.size, count: total, period, isFuturePeriod }, pagination: { page, limit, total, totalPages } })
    } catch (error) { return next(error) }
  }

  options = async (_req, res, next) => {
    try {
      const [contracts, settings] = await Promise.all([
        StudentContract.find({ status: { $in: ['active', 'completed'] } }).populate('student', 'fullName phone').populate('room', 'roomNumber block').sort({ createdAt: -1 }).lean(),
        GeneralSetting.findOne({ key: 'general' }).lean(),
      ])
      const installments = await ContractInstallment.find({ contract: { $in: contracts.map((item) => item._id) } }).sort({ dueDate: 1 }).lean()
      const depositRows = await Payment.aggregate([{ $match: { paymentPurpose: 'deposit', status: { $ne: 'cancelled' }, cancelledAt: null, student: { $in: contracts.map((item) => item.student?._id).filter(Boolean) } } }, { $group: { _id: '$student', paid: { $sum: '$amount' } } }])
      const depositPaidByStudent = new Map(depositRows.map((row) => [row._id.toString(), row.paid]))
      const depositAmount = Number(settings?.depositAmount || 0)
      const byContract = new Map()
      installments.forEach((item) => { const key = item.contract.toString(); if (!byContract.has(key)) byContract.set(key, []); byContract.get(key).push(item) })
      const options = contracts.map((contract) => { const depositPaid = depositPaidByStudent.get(contract.student?._id?.toString()) || 0; return { ...contract, installments: byContract.get(contract._id.toString()) || [], balance: (byContract.get(contract._id.toString()) || []).reduce((sum, item) => sum + Math.max(0, item.amount - item.paidAmount), 0), depositAmount, depositPaid, depositBalance: Math.max(0, depositAmount - depositPaid) } })
      return ApiResponse.ok(res, { contracts: options, depositAmount })
    } catch (error) { return next(error) }
  }

  advance = async (_req, res, next) => {
    try {
      const financialContractIds = await StudentContract.distinct('_id', { status: { $ne: 'cancelled' } })
      const payments = await Payment.find({ cancelledAt: null, contract: { $in: financialContractIds } })
        .populate(paymentPopulate)
        .sort({ createdAt: -1 })
      const groups = new Map()
      for (const payment of payments) {
        const installment = payment.allocations?.[0]?.installment
        if (!installment?.periodKey) continue
        const paymentPeriod = periodKeyInTashkent(payment.createdAt)
        if (installment.periodKey <= paymentPeriod) continue
        const amount = payment.allocations?.[0]?.amount || payment.amount
        if (!groups.has(installment.periodKey)) {
          groups.set(installment.periodKey, {
            periodKey: installment.periodKey,
            totalAmount: 0,
            studentIds: new Set(),
            payments: [],
          })
        }
        const group = groups.get(installment.periodKey)
        group.totalAmount += amount
        if (payment.student?.id) group.studentIds.add(payment.student.id)
        group.payments.push({
          id: payment.id,
          student: payment.student,
          contract: payment.contract,
          amount,
          method: payment.method,
          paymentParts: effectivePaymentParts(payment),
          note: payment.note,
          createdAt: payment.createdAt,
        })
      }
      const periods = [...groups.values()]
        .map(({ studentIds, ...group }) => ({
          ...group,
          studentCount: studentIds.size,
          paymentCount: group.payments.length,
        }))
        .sort((first, second) => second.periodKey.localeCompare(first.periodKey))
      return ApiResponse.ok(res, {
        periods,
        summary: {
          totalAmount: periods.reduce((sum, item) => sum + item.totalAmount, 0),
          studentCount: new Set(periods.flatMap((item) => item.payments.map((payment) => payment.student?.id).filter(Boolean))).size,
          paymentCount: periods.reduce((sum, item) => sum + item.paymentCount, 0),
          periodCount: periods.length,
        },
      })
    } catch (error) { return next(error) }
  }

  studentProfile = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.studentId)) return ApiResponse.notFound(res, 'Talaba topilmadi')
      const contracts = await StudentContract.find({ student: req.params.studentId, status: { $ne: 'cancelled' } }).populate('room', 'roomNumber block').sort({ startDate: -1 }).lean()
      const installments = await ContractInstallment.find({ contract: { $in: contracts.map((item) => item._id) } }).sort({ dueDate: 1, periodIndex: 1 }).lean()
      const payments = await Payment.find({ student: req.params.studentId, $or: [{ contract: { $in: contracts.map((contract) => contract._id) } }, { paymentPurpose: 'deposit' }] }).populate(paymentPopulate).sort({ createdAt: -1 })
      const activeContractIds = new Set(contracts.filter((contract) => contract.status === 'active').map((contract) => contract._id.toString()))
      const activeInstallments = installments.filter((item) => activeContractIds.has(item.contract.toString()))
      const sortedInstallments = [...installments].sort((first, second) => {
        const firstActive = activeContractIds.has(first.contract.toString())
        const secondActive = activeContractIds.has(second.contract.toString())
        if (firstActive !== secondActive) return firstActive ? -1 : 1
        return new Date(first.dueDate).getTime() - new Date(second.dueDate).getTime()
      })
      const total = activeInstallments.reduce((sum, item) => sum + item.amount, 0)
      const paid = activeInstallments.reduce((sum, item) => sum + item.paidAmount, 0)
      const now = new Date()
      const todayEnd = tashkentDayEnd(now)
      const todayStart = tashkentDayStart(now)
      const dueInstallments = activeInstallments.filter((item) => new Date(item.dueDate) <= todayEnd)
      const debt = dueInstallments.reduce((sum, item) => sum + Math.max(0, item.amount - item.paidAmount), 0)
      const upcoming = activeInstallments.filter((item) => new Date(item.dueDate) > todayEnd).reduce((sum, item) => sum + Math.max(0, item.amount - item.paidAmount), 0)
      const overdue = activeInstallments.reduce((sum, item) => sum + (new Date(item.dueDate) < todayStart ? Math.max(0, item.amount - item.paidAmount) : 0), 0)
      const settings = await GeneralSetting.findOne({ key: 'general' }).lean()
      const depositAmount = Number(settings?.depositAmount || 0)
      const depositPaid = payments.filter((payment) => payment.paymentPurpose === 'deposit' && !payment.cancelledAt && payment.status !== 'cancelled').reduce((sum, payment) => sum + payment.amount, 0)
      return ApiResponse.ok(res, { contracts, installments: sortedInstallments, payments, summary: { total, paid, debt, overdue, upcoming, paymentCount: payments.filter((payment) => !payment.cancelledAt && payment.status !== 'cancelled').length, depositAmount, depositPaid, depositDebt: Math.max(0, depositAmount - depositPaid) } })
    } catch (error) { return next(error) }
  }

  create = async (req, res, next) => {
    const session = await mongoose.startSession()
    try {
      const { contract: contractId, installment: installmentId, note = '' } = req.body
      const paymentPurpose = req.body.paymentPurpose === 'deposit' ? 'deposit' : 'contract'
      if (paymentPurpose === 'contract' && !mongoose.isValidObjectId(contractId)) return ApiResponse.badRequest(res, 'Shartnomani tanlang')
      if (paymentPurpose === 'contract' && !mongoose.isValidObjectId(installmentId)) return ApiResponse.badRequest(res, 'To‘lov oyini tanlang')
      let paymentParts
      try { paymentParts = buildPaymentParts(req.body, req.employee.role) } catch (error) { return ApiResponse.badRequest(res, error.message) }
      const amount = paymentPartsTotal(paymentParts)
      const method = paymentMethodValue(paymentParts)
      const fundHolder = paymentFundHolderValue(paymentParts)
      const contract = mongoose.isValidObjectId(contractId) ? await StudentContract.findById(contractId) : null
      const studentId = paymentPurpose === 'deposit' ? (mongoose.isValidObjectId(req.body.student) ? req.body.student : contract?.student) : contract?.student
      if (!mongoose.isValidObjectId(studentId)) return ApiResponse.badRequest(res, 'Talabani tanlang')
      if (paymentPurpose === 'contract' && !contract) return ApiResponse.notFound(res, 'Shartnoma topilmadi')
      if (contract?.status === 'cancelled') return ApiResponse.badRequest(res, 'Bekor qilingan shartnoma uchun to‘lov qabul qilinmaydi')
      let payment
      let cashSession = null
      await session.withTransaction(async () => {
        const installment = paymentPurpose === 'contract' ? await ContractInstallment.findOne({ _id: installmentId, contract: contract._id }).session(session) : null
        if (paymentPurpose === 'contract' && !installment) throw Object.assign(new Error('Tanlangan to‘lov davri topilmadi'), { paymentValidation: true })
        let balance
        if (paymentPurpose === 'deposit') {
          const settings = await GeneralSetting.findOne({ key: 'general' }).session(session).lean()
          const [depositRow] = await Payment.aggregate([{ $match: { student: new mongoose.Types.ObjectId(studentId), paymentPurpose: 'deposit', status: { $ne: 'cancelled' }, cancelledAt: null } }, { $group: { _id: null, paid: { $sum: '$amount' } } }]).session(session)
          balance = Math.max(0, Number(settings?.depositAmount || 0) - Number(depositRow?.paid || 0))
        } else balance = Math.max(0, installment.amount - installment.paidAmount)
        if (amount > balance) throw Object.assign(new Error(`Maksimal to‘lov: ${balance.toLocaleString('uz-UZ')} so‘m`), { paymentValidation: true })
        if (paymentParts.some((part) => part.fundHolder === 'cashier')) {
          cashSession = await CashSession.findOneAndUpdate(
            { cashier: req.employee._id, status: 'open' },
            { $setOnInsert: { cashier: req.employee._id, status: 'open' } },
            { new: true, upsert: true, setDefaultsOnInsert: true, session },
          )
        }
        if (installment) { installment.paidAmount += amount; installment.status = installment.paidAmount >= installment.amount ? 'paid' : 'partial'; await installment.save({ session }) }
        ;[payment] = await Payment.create([{ student: studentId, contract: contract?._id || null, paymentPurpose, amount, method, fundHolder, paymentParts, note, receivedBy: req.employee._id, cashSession: cashSession?._id || null, allocations: installment ? [{ installment: installment._id, amount }] : [], auditHistory: [{ action: 'created', performedBy: req.employee._id, after: { amount, method, fundHolder, paymentParts, note } }] }], { session })
      })
      await payment.populate(paymentPopulate); this.emit(req, 'created', payment)
      if (cashSession) req.app.get('io')?.emit('cash-sessions:changed', { action: 'payment-created', cashierId: req.employee.id })
      return ApiResponse.created(res, { payment }, 'To‘lov muvaffaqiyatli qabul qilindi')
    } catch (error) { return error.paymentValidation ? ApiResponse.badRequest(res, error.message) : next(error) }
    finally { await session.endSession() }
  }

  update = async (req, res, next) => {
    const session = await mongoose.startSession()
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'To‘lov topilmadi')
      let payment
      let before
      await session.withTransaction(async () => {
        payment = await Payment.findById(req.params.id).session(session)
        if (!payment) throw Object.assign(new Error('To‘lov topilmadi'), { status: 404 })
        if (payment.status === 'cancelled' || payment.cancelledAt) throw Object.assign(new Error('Bekor qilingan to‘lovni tahrirlab bo‘lmaydi'), { paymentValidation: true })
        before = snapshot(payment)
        const receiver = payment.receivedBy ? await Employee.findById(payment.receivedBy).select('role').session(session) : null
        const paymentParts = buildPaymentParts(req.body, receiver?.role)
        const amount = paymentPartsTotal(paymentParts)
        const method = paymentMethodValue(paymentParts)
        const fundHolder = paymentFundHolderValue(paymentParts)
        const allocation = payment.allocations[0]
        const isDeposit = payment.paymentPurpose === 'deposit'
        const installment = isDeposit ? null : await ContractInstallment.findById(allocation?.installment).session(session)
        if (!isDeposit && !installment) throw Object.assign(new Error('To‘lov davri topilmadi'), { paymentValidation: true })
        let available
        if (isDeposit) {
          const settings = await GeneralSetting.findOne({ key: 'general' }).session(session).lean()
          const [depositRow] = await Payment.aggregate([{ $match: { _id: { $ne: payment._id }, student: payment.student, paymentPurpose: 'deposit', status: { $ne: 'cancelled' }, cancelledAt: null } }, { $group: { _id: null, paid: { $sum: '$amount' } } }]).session(session)
          available = Math.max(0, Number(settings?.depositAmount || 0) - Number(depositRow?.paid || 0))
        } else available = Math.max(0, installment.amount - installment.paidAmount) + allocation.amount
        if (amount > available) throw Object.assign(new Error(`Maksimal to‘lov: ${available.toLocaleString('uz-UZ')} so‘m`), { paymentValidation: true })
        if (installment) { installment.paidAmount = Math.max(0, installment.paidAmount - allocation.amount) + amount; installment.status = installment.paidAmount <= 0 ? 'unpaid' : installment.paidAmount >= installment.amount ? 'paid' : 'partial'; await installment.save({ session }) }
        payment.fundHolder = fundHolder
        payment.paymentParts = paymentParts
        if (!paymentParts.some((part) => part.fundHolder === 'cashier')) payment.cashSession = null
        else if (!payment.cashSession && receiver?.role === 'cashier') {
          const receiverSession = await CashSession.findOneAndUpdate({ cashier: receiver._id, status: 'open' }, { $setOnInsert: { cashier: receiver._id, status: 'open' } }, { new: true, upsert: true, setDefaultsOnInsert: true, session })
          payment.cashSession = receiverSession._id
        }
        payment.amount = amount; payment.method = method; payment.note = String(req.body.note || '').trim(); payment.allocations = installment ? [{ installment: installment._id, amount }] : []
        payment.auditHistory.push({ action: 'updated', performedBy: req.employee._id, before, after: snapshot(payment) })
        await adjustCashSession(payment, before, snapshot(payment), false, session)
        await payment.save({ session })
      })
      await this.notifyCashier(req, payment, 'updated', before); await payment.populate(paymentPopulate); this.emit(req, 'updated', payment)
      return ApiResponse.ok(res, { payment }, 'To‘lov yangilandi')
    } catch (error) { return error.status === 404 ? ApiResponse.notFound(res, error.message) : error.paymentValidation ? ApiResponse.badRequest(res, error.message) : next(error) }
    finally { await session.endSession() }
  }

  remove = async (req, res, next) => {
    const session = await mongoose.startSession()
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'To‘lov topilmadi')
      let payment
      let before
      await session.withTransaction(async () => {
        payment = await Payment.findById(req.params.id).session(session)
        if (!payment) throw Object.assign(new Error('To‘lov topilmadi'), { status: 404 })
        if (payment.status === 'cancelled' || payment.cancelledAt) throw Object.assign(new Error('To‘lov avval bekor qilingan'), { paymentValidation: true })
        before = snapshot(payment)
        for (const allocation of payment.allocations) {
          const installment = await ContractInstallment.findById(allocation.installment).session(session)
          if (installment) { installment.paidAmount = Math.max(0, installment.paidAmount - allocation.amount); installment.status = installment.paidAmount <= 0 ? 'unpaid' : installment.paidAmount >= installment.amount ? 'paid' : 'partial'; await installment.save({ session }) }
        }
        payment.status = 'cancelled'; payment.cancelledAt = new Date(); payment.cancelledBy = req.employee._id
        payment.auditHistory.push({ action: 'cancelled', performedBy: req.employee._id, before })
        await adjustCashSession(payment, before, before, true, session)
        await payment.save({ session })
      })
      await this.notifyCashier(req, payment, 'cancelled', before); await payment.populate(paymentPopulate); this.emit(req, 'cancelled', payment)
      return ApiResponse.ok(res, { payment }, 'To‘lov bekor qilindi')
    } catch (error) { return error.status === 404 ? ApiResponse.notFound(res, error.message) : error.paymentValidation ? ApiResponse.badRequest(res, error.message) : next(error) }
    finally { await session.endSession() }
  }
}

export const paymentController = new PaymentController()
