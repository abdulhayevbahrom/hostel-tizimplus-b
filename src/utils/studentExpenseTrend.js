import { tashkentDayEnd, tashkentDayStart } from './paymentTime.js'

function countResidents(date, contracts) {
  const start = tashkentDayStart(date)
  const end = tashkentDayEnd(date)
  const students = new Set()

  for (const contract of contracts) {
    const student = contract.student
    if (!student || contract.startDate > end || contract.endDate < start) continue
    if (contract.status === 'cancelled' && (!contract.cancelledAt || contract.cancelledAt <= end)) continue
    if (student.isDeleted && (!student.deletedAt || student.deletedAt <= end)) continue
    students.add(String(student._id))
  }
  return students.size
}

export function yearlyStudentCounts(year, todayKey, contracts) {
  const [currentYear, currentMonth, currentDay] = todayKey.split('-').map(Number)
  const monthCount = year < currentYear ? 12 : year === currentYear ? currentMonth : 0
  return Array.from({ length: monthCount }, (_, month) => {
    const date = year === currentYear && month === currentMonth - 1
      ? new Date(Date.UTC(year, month, currentDay))
      : new Date(Date.UTC(year, month + 1, 0))
    return { month: month + 1, studentCount: countResidents(date, contracts) }
  })
}

export function studentExpenseTrend({ period, days, expenses, contracts }) {
  const [year, month] = period.split('-').map(Number)
  let totalExpense = 0
  let totalOfRatios = 0
  let measuredDays = 0
  const rows = Array.from({ length: days }, (_, index) => {
    const day = index + 1
    const date = new Date(Date.UTC(year, month - 1, day))
    totalExpense += expenses.get(day) || 0
    const studentCount = countResidents(date, contracts)
    const cost = studentCount ? totalExpense / studentCount : null
    if (cost !== null) {
      totalOfRatios += cost
      measuredDays += 1
    }
    return { day, totalExpense, studentCount, cost }
  })
  return { rows, average: measuredDays ? totalOfRatios / measuredDays : null }
}
