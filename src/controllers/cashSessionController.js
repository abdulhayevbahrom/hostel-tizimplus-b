import mongoose from 'mongoose'
import { CashSession } from '../models/CashSession.js'
import { Notification } from '../models/Notification.js'
import { Payment } from '../models/Payment.js'
import { ApiResponse } from '../utils/response.js'

const sumPayments = async (match) => {
  const [summary] = await Payment.aggregate([
    { $match: match },
    { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } },
  ])
  return { amount: summary?.amount || 0, count: summary?.count || 0 }
}

class CashSessionController {
  emit(req, action, session) {
    req.app.get('io')?.emit('cash-sessions:changed', { action, sessionId: session?.id || session?._id?.toString() })
  }

  list = async (req, res, next) => {
    try {
      if (req.employee.role === 'cashier') {
        const openSession = await CashSession.findOne({ cashier: req.employee._id, status: 'open' })
        const open = openSession ? await sumPayments({ cashSession: openSession._id, method: 'cash' }) : { amount: 0, count: 0 }
        const sessions = await CashSession.find({ cashier: req.employee._id, status: { $ne: 'open' } })
          .populate('reviewedBy', 'firstname lastname').sort({ closedAt: -1 }).limit(30)
        const pendingAmount = sessions.filter((item) => item.status === 'pending').reduce((sum, item) => sum + item.expectedAmount, 0)
        return ApiResponse.ok(res, { role: 'cashier', open: { id: openSession?.id || null, balance: open.amount, paymentCount: open.count }, pendingAmount, sessions })
      }

      if (!['owner', 'admin'].includes(req.employee.role)) return ApiResponse.forbidden(res, 'Kassa faqat kassir va owner uchun ochiq')
      const [pendingSessions, recentSessions, directCash, approved] = await Promise.all([
        CashSession.find({ status: 'pending' }).populate('cashier', 'firstname lastname position').sort({ closedAt: 1 }),
        CashSession.find({ status: { $in: ['approved', 'rejected'] } }).populate('cashier', 'firstname lastname position').populate('reviewedBy', 'firstname lastname').sort({ reviewedAt: -1 }).limit(30),
        sumPayments({ method: 'cash', cashSession: null }),
        CashSession.aggregate([{ $match: { status: 'approved' } }, { $group: { _id: null, amount: { $sum: '$expectedAmount' } } }]),
      ])
      const pendingAmount = pendingSessions.reduce((sum, item) => sum + item.expectedAmount, 0)
      const approvedAmount = approved[0]?.amount || 0
      return ApiResponse.ok(res, {
        role: req.employee.role,
        summary: { centralCash: directCash.amount + approvedAmount, directCash: directCash.amount, approvedCash: approvedAmount, pendingAmount, pendingCount: pendingSessions.length },
        pendingSessions,
        recentSessions,
      })
    } catch (error) { return next(error) }
  }

  close = async (req, res, next) => {
    try {
      if (req.employee.role !== 'cashier') return ApiResponse.forbidden(res, 'Kassani faqat kassir yopadi')
      const session = await CashSession.findOne({ cashier: req.employee._id, status: 'open' })
      if (!session) return ApiResponse.badRequest(res, 'Yopish uchun kassada naqd pul yo‘q')
      const total = await sumPayments({ cashSession: session._id, method: 'cash' })
      if (total.amount <= 0) return ApiResponse.badRequest(res, 'Yopish uchun kassada naqd pul yo‘q')
      session.status = 'pending'; session.expectedAmount = total.amount; session.paymentCount = total.count
      session.closedAt = new Date(); session.note = String(req.body.note || '').trim()
      await session.save()
      const cashierName = `${req.employee.firstname} ${req.employee.lastname}`.trim()
      await Notification.create({
        eventKey: `cash-session:${session.id}`,
        type: 'cash_session', title: 'Kassa yopildi',
        message: `${cashierName} ${total.amount.toLocaleString('uz-UZ')} so‘mlik kassani tasdiqlashga yubordi`,
        count: total.count, targetPath: '/cash', targetRoles: ['owner', 'admin'],
      })
      this.emit(req, 'closed', session)
      req.app.get('io')?.emit('notifications:changed', { type: 'cash_session' })
      return ApiResponse.ok(res, { session }, 'Kassa owner tasdig‘iga yuborildi')
    } catch (error) { return next(error) }
  }

  approve = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Kassa topilmadi')
      const session = await CashSession.findOne({ _id: req.params.id, status: 'pending' })
      if (!session) return ApiResponse.notFound(res, 'Tasdiqlanadigan kassa topilmadi')
      const receivedAmount = Number(req.body.receivedAmount)
      if (!Number.isFinite(receivedAmount) || receivedAmount < 0) return ApiResponse.badRequest(res, 'Olingan pul miqdorini kiriting')
      if (receivedAmount !== session.expectedAmount) {
        const difference = receivedAmount - session.expectedAmount
        return ApiResponse.badRequest(res, `Kassada ${Math.abs(difference).toLocaleString('uz-UZ')} so‘m ${difference < 0 ? 'kam' : 'ortiqcha'} chiqdi`)
      }
      session.status = 'approved'; session.receivedAmount = receivedAmount; session.reviewedAt = new Date()
      session.reviewedBy = req.employee._id; session.reviewNote = String(req.body.reviewNote || '').trim()
      await session.save(); this.emit(req, 'approved', session)
      return ApiResponse.ok(res, { session }, 'Kassa qabul qilindi va markaziy kassaga o‘tkazildi')
    } catch (error) { return next(error) }
  }
}

export const cashSessionController = new CashSessionController()
