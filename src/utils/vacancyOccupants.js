import { isActiveRoomStay, recordId } from './roomBeds.js'

const roomId = (value) => value == null ? null : recordId(value)
const location = (value, rooms, bedNumber) => {
  const key = roomId(value)
  if (!key) return null
  const room = rooms.get(key) || value
  if (!room?.roomNumber) return null
  return { id: key, roomNumber: room.roomNumber, block: room.block || '', floor: room.floor ?? '', bedNumber: bedNumber ?? null }
}
const newer = (first, second) => new Date(first.startDate) - new Date(second.startDate)
  || new Date(first.createdAt || first.startDate) - new Date(second.createdAt || second.startDate)
  || recordId(first).localeCompare(recordId(second))

// Current placement is independent of the dashboard's selected month or day.
// Audit snapshots also retain transfers made by editing the same contract.
export function vacancyOccupantContexts({ contracts, rooms, roomMoves = [], todayStart, todayEnd }) {
  const byRoom = new Map(rooms.map((room) => [recordId(room), room]))
  const currentByStudent = new Map()
  for (const contract of contracts) {
    if (!isActiveRoomStay(contract, { startDate: todayStart, endDate: todayEnd })) continue
    const key = recordId(contract.student)
    const previous = currentByStudent.get(key)
    if (!previous || newer(contract, previous) > 0) currentByStudent.set(key, contract)
  }
  const latestMoves = new Map()
  for (const move of [...roomMoves].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    || recordId(b).localeCompare(recordId(a)))) {
    const previous = move.oldValue?.room
    const updated = (move.newValue?.contract || move.newValue)?.room
    if (!roomId(previous) || !roomId(updated) || roomId(previous) === roomId(updated)) continue
    const key = String(move.entityId)
    if (!latestMoves.has(key)) latestMoves.set(key, move)
  }
  return new Map(contracts.map((contract) => {
    const current = currentByStudent.get(recordId(contract.student))
    const currentRoom = current ? location(current.room, byRoom, current.bedNumber) : null
    const historicalRoom = location(contract.room, byRoom, contract.bedNumber)
    let previousRoom = historicalRoom && currentRoom && historicalRoom.id !== currentRoom.id ? historicalRoom : null
    if (!previousRoom && current && currentRoom) {
      const move = latestMoves.get(recordId(current))
      const updated = (move?.newValue?.contract || move?.newValue)?.room
      // Ignore an old transfer log if it no longer points to the current room.
      if (move && roomId(updated) === currentRoom.id) {
        previousRoom = location(move.oldValue.room, byRoom, move.oldValue.bedNumber)
      }
    }
    return [contract, { status: contract.status || null, cancelledAt: contract.cancelledAt || null,
      previousRoom, currentRoom: previousRoom ? currentRoom : null }]
  }))
}
