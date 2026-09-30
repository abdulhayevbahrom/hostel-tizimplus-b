export const TASHKENT_TIME_ZONE = 'Asia/Tashkent'

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
