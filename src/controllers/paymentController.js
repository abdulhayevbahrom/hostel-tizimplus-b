import mongoose from 'mongoose'
import { Payment } from '../models/Payment.js'
import { StudentContract } from '../models/StudentContract.js'
import { ContractInstallment } from '../models/ContractInstallment.js'
import { ApiResponse } from '../utils/response.js'

const paymentPopulate = [
  { path: 'student', select: 'fullName phone photo' },
  { path: 'contract', select: 'contractNumber totalAmount paymentType room', populate: { path: 'room', select: 'roomNumber block' } },
  { path: 'allocations.installment', select: 'periodKey dueDate amount paidAmount status' },
]

class PaymentController {
  emit(req, action, payment) {
    req.app.get('io')?.emit('payments:changed', { action, paymentId: payment?.id || payment?._id?.toString(), studentId: payment?.student?._id?.toString?.() || payment?.student?.toString?.() })
    req.app.get('io')?.emit('student-contracts:changed', { action: `payment-${action}`, studentId: payment?.student?._id?.toString?.() || payment?.student?.toString?.() })
  }

  list = async (req, res, next) => {
    try {
      const { search = '', method = '', from = '', to = '', period = '' } = req.query
      const filter = {}
      if (method && ['cash', 'card', 'bank', 'online'].includes(method)) filter.method = method
      if (from || to) filter.createdAt = { ...(from ? { $gte: new Date(`${from}T00:00:00`) } : {}), ...(to ? { $lte: new Date(`${to}T23:59:59.999`) } : {}) }
      const periodInstallments = period ? await ContractInstallment.find({ periodKey: period }).select('_id student amount paidAmount').lean() : []
      if (period) filter['allocations.installment'] = { $in: periodInstallments.map((item) => item._id) }
      let payments = await Payment.find(filter).populate(paymentPopulate).sort({ createdAt: -1 })
      const needle = String(search).trim().toLowerCase()
      if (needle) payments = payments.filter((item) => `${item.student?.fullName || ''} ${item.student?.phone || ''} ${item.contract?.contractNumber || ''}`.toLowerCase().includes(needle))
      const reportInstallments = period ? periodInstallments : await ContractInstallment.find({}).select('student amount paidAmount periodKey').lean()
      const billed = reportInstallments.reduce((sum, item) => sum + item.amount, 0)
      const paid = reportInstallments.reduce((sum, item) => sum + item.paidAmount, 0)
      const allStudents = new Set(reportInstallments.map((item) => item.student.toString()))
      const paidStudents = new Set(reportInstallments.filter((item) => item.paidAmount > 0).map((item) => item.student.toString()))
      const now = new Date(); const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
      const isFuturePeriod = Boolean(period && period > currentKey)
      const dueInstallments = period ? (isFuturePeriod ? [] : reportInstallments) : reportInstallments.filter((item) => item.periodKey <= currentKey)
      const debt = dueInstallments.reduce((sum, item) => sum + Math.max(0, item.amount - item.paidAmount), 0)
      return ApiResponse.ok(res, { payments, summary: { billed, paid, debt, paidStudents: paidStudents.size, unpaidStudents: isFuturePeriod ? 0 : Math.max(0, allStudents.size - paidStudents.size), waitingStudents: isFuturePeriod ? Math.max(0, allStudents.size - paidStudents.size) : 0, studentCount: allStudents.size, count: payments.length, period, isFuturePeriod } })
    } catch (error) { return next(error) }
  }

  options = async (_req, res, next) => {
    try {
      const contracts = await StudentContract.find({ status: { $in: ['active', 'cancelled', 'completed'] } }).populate('student', 'fullName phone').populate('room', 'roomNumber block').sort({ createdAt: -1 }).lean()
      const installments = await ContractInstallment.find({ contract: { $in: contracts.map((item) => item._id) } }).sort({ dueDate: 1 }).lean()
      const byContract = new Map()
      installments.forEach((item) => { const key = item.contract.toString(); if (!byContract.has(key)) byContract.set(key, []); byContract.get(key).push(item) })
      const options = contracts.map((contract) => ({ ...contract, installments: byContract.get(contract._id.toString()) || [], balance: (byContract.get(contract._id.toString()) || []).reduce((sum, item) => sum + Math.max(0, item.amount - item.paidAmount), 0) })).filter((contract) => contract.status === 'active' || contract.balance > 0)
      return ApiResponse.ok(res, { contracts: options })
    } catch (error) { return next(error) }
  }

  studentProfile = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.studentId)) return ApiResponse.notFound(res, 'Talaba topilmadi')
      const contracts = await StudentContract.find({ student: req.params.studentId }).populate('room', 'roomNumber block').sort({ startDate: -1 }).lean()
      const installments = await ContractInstallment.find({ contract: { $in: contracts.map((item) => item._id) } }).sort({ dueDate: 1, periodIndex: 1 }).lean()
      const payments = await Payment.find({ student: req.params.studentId }).populate(paymentPopulate).sort({ createdAt: -1 })
      const total = installments.reduce((sum, item) => sum + item.amount, 0)
      const paid = installments.reduce((sum, item) => sum + item.paidAmount, 0)
      const now = new Date()
      const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
      const dueInstallments = installments.filter((item) => item.periodKey <= currentKey)
      const debt = dueInstallments.reduce((sum, item) => sum + Math.max(0, item.amount - item.paidAmount), 0)
      const upcoming = installments.filter((item) => item.periodKey > currentKey).reduce((sum, item) => sum + Math.max(0, item.amount - item.paidAmount), 0)
      const overdue = installments.reduce((sum, item) => sum + (item.periodKey < currentKey ? Math.max(0, item.amount - item.paidAmount) : 0), 0)
      return ApiResponse.ok(res, { contracts, installments, payments, summary: { total, paid, debt, overdue, upcoming, paymentCount: payments.length } })
    } catch (error) { return next(error) }
  }

  create = async (req, res, next) => {
    try {
      const { contract: contractId, installment: installmentId, method, note = '' } = req.body
      const amount = Number(req.body.amount)
      if (!mongoose.isValidObjectId(contractId)) return ApiResponse.badRequest(res, 'Shartnomani tanlang')
      if (!mongoose.isValidObjectId(installmentId)) return ApiResponse.badRequest(res, 'To‘lov oyini tanlang')
      if (!Number.isFinite(amount) || amount <= 0) return ApiResponse.badRequest(res, 'To‘lov summasini kiriting')
      if (!['cash', 'card', 'bank', 'online'].includes(method)) return ApiResponse.badRequest(res, 'To‘lov usulini tanlang')
      const contract = await StudentContract.findById(contractId)
      if (!contract) return ApiResponse.notFound(res, 'Shartnoma topilmadi')
      const installment = await ContractInstallment.findOne({ _id: installmentId, contract: contract._id })
      if (!installment) return ApiResponse.badRequest(res, 'Tanlangan to‘lov davri topilmadi')
      const balance = Math.max(0, installment.amount - installment.paidAmount)
      if (amount > balance) return ApiResponse.badRequest(res, `Maksimal to‘lov: ${balance.toLocaleString('uz-UZ')} so‘m`)
      installment.paidAmount += amount; installment.status = installment.paidAmount >= installment.amount ? 'paid' : 'partial'; await installment.save()
      const payment = await Payment.create({ student: contract.student, contract: contract._id, amount, method, note, allocations: [{ installment: installment._id, amount }] })
      await payment.populate(paymentPopulate); this.emit(req, 'created', payment)
      return ApiResponse.created(res, { payment }, 'To‘lov muvaffaqiyatli qabul qilindi')
    } catch (error) { return next(error) }
  }

  update = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'To‘lov topilmadi')
      const payment = await Payment.findById(req.params.id)
      if (!payment) return ApiResponse.notFound(res, 'To‘lov topilmadi')
      const amount = Number(req.body.amount)
      const method = req.body.method
      if (!Number.isFinite(amount) || amount <= 0) return ApiResponse.badRequest(res, 'To‘lov summasini kiriting')
      if (!['cash', 'card', 'bank', 'online'].includes(method)) return ApiResponse.badRequest(res, 'To‘lov usulini tanlang')
      const allocation = payment.allocations[0]
      const installment = await ContractInstallment.findById(allocation?.installment)
      if (!installment) return ApiResponse.badRequest(res, 'To‘lov davri topilmadi')
      const available = Math.max(0, installment.amount - installment.paidAmount) + allocation.amount
      if (amount > available) return ApiResponse.badRequest(res, `Maksimal to‘lov: ${available.toLocaleString('uz-UZ')} so‘m`)
      installment.paidAmount = Math.max(0, installment.paidAmount - allocation.amount) + amount
      installment.status = installment.paidAmount <= 0 ? 'unpaid' : installment.paidAmount >= installment.amount ? 'paid' : 'partial'
      await installment.save()
      payment.amount = amount; payment.method = method; payment.note = String(req.body.note || '').trim(); payment.allocations = [{ installment: installment._id, amount }]
      await payment.save(); await payment.populate(paymentPopulate); this.emit(req, 'updated', payment)
      return ApiResponse.ok(res, { payment }, 'To‘lov yangilandi')
    } catch (error) { return next(error) }
  }

  remove = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'To‘lov topilmadi')
      const payment = await Payment.findById(req.params.id)
      if (!payment) return ApiResponse.notFound(res, 'To‘lov topilmadi')
      for (const allocation of payment.allocations) {
        const installment = await ContractInstallment.findById(allocation.installment)
        if (installment) { installment.paidAmount = Math.max(0, installment.paidAmount - allocation.amount); installment.status = installment.paidAmount <= 0 ? 'unpaid' : installment.paidAmount >= installment.amount ? 'paid' : 'partial'; await installment.save() }
      }
      await payment.deleteOne(); this.emit(req, 'deleted', payment)
      return ApiResponse.ok(res, { paymentId: payment.id }, 'To‘lov bekor qilindi')
    } catch (error) { return next(error) }
  }
}

export const paymentController = new PaymentController()
