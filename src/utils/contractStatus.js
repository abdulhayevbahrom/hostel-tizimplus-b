import { StudentContract } from '../models/StudentContract.js'
import { Notification } from '../models/Notification.js'
import { DebtorDeadline } from '../models/DebtorDeadline.js'
import { ContractInstallment } from '../models/ContractInstallment.js'
import { tashkentDayEnd, tashkentDayStart } from './paymentTime.js'

const DAY_MS = 86400000

export async function createDebtorDeadlineNotification(io) {
  const now = new Date()
  const todayStart = tashkentDayStart(now)
  const tomorrowStart = new Date(todayStart.getTime() + DAY_MS)
  const deadlines = await DebtorDeadline.find({ deadline: { $gte: todayStart, $lt: tomorrowStart } }).select('student periodKey').lean()
  if (!deadlines.length) return
  const financialContractIds = await StudentContract.distinct('_id', { status: { $ne: 'cancelled' } })
  const dueStudentIds = new Set()
  for (const item of deadlines) {
    const hasDebt = await ContractInstallment.exists({ student: item.student, periodKey: item.periodKey, contract: { $in: financialContractIds }, $expr: { $lt: ['$paidAmount', '$amount'] } })
    if (hasDebt) dueStudentIds.add(item.student.toString())
  }
  const count = dueStudentIds.size
  if (!count) return
  const dateKey = tashkentDayEnd(now).toISOString().slice(0, 10)
  const result = await Notification.updateOne(
    { eventKey: `debtor-deadline:${dateKey}` },
    { $setOnInsert: { type: 'debtor_deadline', title: 'To‘lov deadline’i keldi', message: `${count} nafar qarzdor talabaning to‘lov deadline’i bugun`, count, targetPath: '/debtors', targetRoles: ['owner', 'admin'] } },
    { upsert: true },
  )
  if (result.upsertedCount) io.emit('notifications:changed', { action: 'created', type: 'debtor_deadline', occurredAt: new Date().toISOString() })
}

export async function createContractExpiryNotification(io) {
  const now = new Date()
  const targetStart = tashkentDayStart(now)
  const targetEnd = new Date(targetStart.getTime() + 3 * DAY_MS)
  const count = await StudentContract.countDocuments({ status: 'active', endDate: { $gte: targetStart, $lt: targetEnd } })
  if (!count) return
  const notificationKey = tashkentDayEnd(now).toISOString().slice(0, 10)
  const result = await Notification.updateOne(
    { eventKey: `contract-expiry:${notificationKey}` },
    { $setOnInsert: { type: 'contract_expiry', title: 'Shartnoma muddati tugamoqda', message: `${count} nafar talabaning shartnomasi tugashiga 2 kun yoki undan kam qoldi`, count, targetPath: '/contracts' } },
    { upsert: true },
  )
  if (result.upsertedCount) io.emit('notifications:changed', { action: 'created', occurredAt: new Date().toISOString() })
}

export async function syncContractStatuses() {
  const threshold = tashkentDayStart()
  const [completed, restored] = await Promise.all([
    StudentContract.updateMany({ status: 'active', endDate: { $lt: threshold } }, { $set: { status: 'completed' } }),
    StudentContract.updateMany({ status: 'completed', endDate: { $gte: threshold }, cancelledAt: null }, { $set: { status: 'active' } }),
  ])
  return { changed: (completed.modifiedCount || 0) + (restored.modifiedCount || 0) }
}

export function scheduleDailyContractSync(io) {
  const scheduleNext = () => {
    const now = new Date()
    const next = new Date(tashkentDayEnd(now).getTime() + 1)
    setTimeout(async () => {
      try {
        await syncContractStatuses()
        const occurredAt = new Date().toISOString()
        // Calendar-day changes also affect future reservations becoming current,
        // even when no contract status needed updating.
        io.emit('student-contracts:changed', { action: 'statuses-synced', occurredAt })
        io.emit('rooms:changed', { action: 'occupancy-changed', occurredAt })
        await createContractExpiryNotification(io)
        await createDebtorDeadlineNotification(io)
      } catch (error) { console.error(`Shartnoma statuslarini yangilashda xatolik: ${error.message}`) }
      scheduleNext()
    }, next.getTime() - now.getTime())
  }
  scheduleNext()
}
