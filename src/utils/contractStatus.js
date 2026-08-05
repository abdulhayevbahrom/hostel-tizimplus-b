import { StudentContract } from '../models/StudentContract.js'

export async function syncContractStatuses({ includeToday = false } = {}) {
  const now = new Date()
  const threshold = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (includeToday ? 1 : 0))
  const [completed, restored] = await Promise.all([
    StudentContract.updateMany({ status: 'active', endDate: { $lt: threshold } }, { $set: { status: 'completed' } }),
    StudentContract.updateMany({ status: 'completed', endDate: { $gte: threshold }, cancelledAt: null }, { $set: { status: 'active' } }),
  ])
  return { changed: (completed.modifiedCount || 0) + (restored.modifiedCount || 0) }
}

export function scheduleDailyContractSync(io) {
  const scheduleNext = () => {
    const now = new Date()
    const next = new Date(now)
    next.setHours(23, 55, 0, 0)
    if (next <= now) next.setDate(next.getDate() + 1)
    setTimeout(async () => {
      try {
        const result = await syncContractStatuses({ includeToday: true })
        if (result.changed) io.emit('student-contracts:changed', { action: 'statuses-synced', occurredAt: new Date().toISOString() })
      } catch (error) { console.error(`Shartnoma statuslarini yangilashda xatolik: ${error.message}`) }
      scheduleNext()
    }, next.getTime() - now.getTime())
  }
  scheduleNext()
}
