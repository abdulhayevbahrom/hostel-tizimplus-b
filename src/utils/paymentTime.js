export const TASHKENT_TIME_ZONE = 'Asia/Tashkent'

export const parsePaymentDate = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T([01]\d|2[0-3]):([0-5]\d))?$/.exec(String(value || ''))
  if (!match) return null
  const [, year, month, day] = match.slice(0, 4).map(Number)
  const calendarDate = new Date(Date.UTC(year, month - 1, day))
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) return null
  return new Date(`${match[0].slice(0, 10)}T${match[4] ?? '00'}:${match[5] ?? '00'}:00+05:00`)
}

const tashkentDateParts = (value) => new Intl.DateTimeFormat('en-US', {
  timeZone: TASHKENT_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).formatToParts(new Date(value))

export const periodKeyInTashkent = (value) => {
  const parts = tashkentDateParts(value)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  return `${year}-${month}`
}

export const tashkentDayEnd = (value = new Date()) => {
  const parts = tashkentDateParts(value)
  const number = (type) => Number(parts.find((part) => part.type === type)?.value)
  // Uzbekistan is UTC+05:00 and does not observe daylight-saving time.
  return new Date(Date.UTC(number('year'), number('month') - 1, number('day'), 18, 59, 59, 999))
}

export const tashkentDayStart = (value = new Date()) => new Date(tashkentDayEnd(value).getTime() - (24 * 60 * 60 * 1000) + 1)

const DAY_MS = 24 * 60 * 60 * 1000

export const paymentTimingDetails = ({ dueDate, completedAt, isPaid, now = new Date() }) => {
  const dueEnd = tashkentDayEnd(dueDate)
  const onTimeEnd = new Date(dueEnd.getTime() + (3 * DAY_MS))
  const almostOnTimeEnd = new Date(dueEnd.getTime() + (5 * DAY_MS))
  if (isPaid) {
    const paidAt = new Date(completedAt)
    if (paidAt <= onTimeEnd) return { status: 'onTime', days: null }
    if (paidAt <= almostOnTimeEnd) return { status: 'almostOnTime', days: null }
    return { status: 'late', days: Math.ceil((paidAt - almostOnTimeEnd) / DAY_MS) }
  }
  const daysUntilLateDeadline = (almostOnTimeEnd - tashkentDayEnd(now)) / DAY_MS
  return daysUntilLateDeadline < 0
    ? { status: 'late', days: -daysUntilLateDeadline }
    : { status: 'pending', days: daysUntilLateDeadline }
}

export const paymentTimingStatus = (options) => paymentTimingDetails(options).status
