import { parsePaymentDate } from './paymentTime.js'

const DAY_MS = 86400000
const id = (value) => String(value?._id ?? value)
const ended = (record, end) => record?.isDeleted && (!record.deletedAt || new Date(record.deletedAt) <= end)

// One empty bed for one calendar day is one vacant bed-day.
export function vacancyLoss({ period, todayKey, dailyRate, rooms, contracts }) {
  const year = Number(period.slice(0, 4))
  const rate = Number(dailyRate || 0)
  const contractsByRoom = new Map()
  for (const contract of contracts) {
    const key = id(contract.room)
    if (!contractsByRoom.has(key)) contractsByRoom.set(key, [])
    contractsByRoom.get(key).push(contract)
  }
  const eligibleRooms = rooms.filter((room) => room.status === 'available')
  const vacantOnDay = (room, start, end) => {
    if ((room.createdAt && new Date(room.createdAt) > end) || ended(room, end)) return 0
    const occupied = new Set()
    for (const contract of contractsByRoom.get(id(room)) || []) {
      if (!contract.student || new Date(contract.startDate) > end || new Date(contract.endDate) < start) continue
      if (contract.status === 'cancelled' && (!contract.cancelledAt || new Date(contract.cancelledAt) <= end)) continue
      if (ended(contract, end) || ended(contract.student, end)) continue
      occupied.add(id(contract.student))
    }
    return Math.max(0, room.capacity - occupied.size)
  }
  const todayStart = parsePaymentDate(todayKey)
  const todayEnd = new Date(todayStart.getTime() + DAY_MS - 1)
  const todayVacantBeds = eligibleRooms.reduce((sum, room) => sum + vacantOnDay(room, todayStart, todayEnd), 0)
  const months = Array.from({ length: 12 }, (_, index) => {
    const monthKey = `${year}-${String(index + 1).padStart(2, '0')}`
    const calendarDays = new Date(Date.UTC(year, index + 1, 0)).getUTCDate()
    const days = monthKey < todayKey.slice(0, 7) ? calendarDays : monthKey === todayKey.slice(0, 7) ? Number(todayKey.slice(8)) : 0
    const roomRows = eligibleRooms.map((room) => {
      let vacantBedDays = 0
      let capacityBedDays = 0
      for (let day = 1; day <= days; day += 1) {
        const start = parsePaymentDate(`${monthKey}-${String(day).padStart(2, '0')}`)
        const end = new Date(start.getTime() + DAY_MS - 1)
        if ((room.createdAt && new Date(room.createdAt) > end) || ended(room, end)) continue
        capacityBedDays += room.capacity
        vacantBedDays += vacantOnDay(room, start, end)
      }
      return { id: id(room), roomNumber: room.roomNumber, block: room.block, floor: room.floor, capacityBedDays, vacantBedDays, loss: vacantBedDays * rate }
    }).filter((room) => room.capacityBedDays > 0)
    const vacantBedDays = roomRows.reduce((sum, room) => sum + room.vacantBedDays, 0)
    return { period: monthKey, days, vacantBedDays, loss: vacantBedDays * rate, rooms: roomRows }
  })
  const selected = months.find((month) => month.period === period)
  const floors = new Map()
  for (const room of selected.rooms) {
    const key = JSON.stringify([room.block, room.floor])
    if (!floors.has(key)) floors.set(key, { id: key, block: room.block, floor: room.floor, vacantBedDays: 0, loss: 0 })
    const floor = floors.get(key)
    floor.vacantBedDays += room.vacantBedDays
    floor.loss += room.loss
  }
  return {
    live: {
      todayStart: todayStart.toISOString(),
      todayVacantBeds,
      todayFullLoss: todayVacantBeds * rate,
      monthStart: parsePaymentDate(`${period}-01`).toISOString(),
      monthEnd: new Date(Date.UTC(year, Number(period.slice(5)), 1) - 5 * 60 * 60 * 1000).toISOString(),
      completedDaysLoss: selected.loss - (period === todayKey.slice(0, 7) ? todayVacantBeds * rate : 0),
      includesToday: period === todayKey.slice(0, 7),
    },
    dailyRate: rate,
    period,
    days: selected.days,
    vacantBedDays: selected.vacantBedDays,
    loss: selected.loss,
    yearLoss: months.reduce((sum, month) => sum + month.loss, 0),
    rooms: selected.rooms,
    floors: [...floors.values()],
    months: months.map(({ rooms: _rooms, ...month }) => month),
  }
}
