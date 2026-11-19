import { ContractInstallment } from '../models/ContractInstallment.js'
import { StudentContract } from '../models/StudentContract.js'
import { Payment } from '../models/Payment.js'
import { ApiResponse } from '../utils/response.js'
import { periodKeyInTashkent } from '../utils/paymentTime.js'
import { allocatedProgressPayments, installmentProgressPeriod } from '../utils/paymentProgress.js'

export async function getPaymentProgress(req, res, next) {
  try {
    const now = new Date()
    const period = String(req.query.period || periodKeyInTashkent(now))
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return ApiResponse.badRequest(res, 'Oyni to‘g‘ri tanlang')
    const [year, month] = period.split('-').map(Number)
    const monthStart = new Date(Date.UTC(year, month - 1, 1))
    const monthEnd = new Date(Date.UTC(year, month, 1))
    const contractIds = await StudentContract.distinct('_id', { status: { $ne: 'cancelled' }, endDate: { $gt: monthStart }, startDate: { $lt: monthEnd } })
    const installments = await ContractInstallment.find({ contract: { $in: contractIds }, dueDate: { $lt: monthEnd } })
      .populate({ path: 'student', select: 'fullName photo' })
      .populate({ path: 'contract', select: 'contractNumber startDate endDate paymentType status room', populate: { path: 'room', select: 'roomNumber block floor' } })
      .sort({ dueDate: 1 })
    const usable = installments.flatMap((item) => {
      if (!item.student || !item.contract?.room) return []
      const dates = installmentProgressPeriod(item, item.contract)
      return dates && new Date(dates.endDate) > monthStart ? [{ item, dates }] : []
    })
    const payments = await Payment.find({
      status: 'active', cancelledAt: null, paymentPurpose: { $ne: 'deposit' },
      'allocations.installment': { $in: usable.map(({ item }) => item._id) },
      $or: [{ paymentDate: { $lte: now } }, { paymentDate: null, createdAt: { $lte: now } }],
    }).select('allocations').lean()
    const paidByInstallment = allocatedProgressPayments(payments)
    const rows = usable.flatMap(({ item, dates }) => {
      const paidAmount = Math.min(item.amount, paidByInstallment.get(item.id) || 0)
      return [{ id: item.id, student: item.student, room: item.contract.room, contractNumber: item.contract.contractNumber,
        paymentType: item.contract.paymentType, amount: item.amount, paidAmount, ...dates }]
    })
    return ApiResponse.ok(res, { period, serverTime: now.toISOString(), rows })
  } catch (error) { return next(error) }
}
