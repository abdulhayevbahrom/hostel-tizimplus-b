import test from 'node:test'
import assert from 'node:assert/strict'
import { vacancyLossProgress } from '../../frontend/src/utils/vacancyLossProgress.js'

const live = {
  todayStart: '2026-11-18T19:00:00Z', todayFullLoss: 80000,
  monthStart: '2026-10-31T19:00:00Z', monthEnd: '2026-11-30T19:00:00Z',
  completedDaysLoss: 18 * 80000, includesToday: true,
}
test('live vacancy amounts accrue by the second and cap at the day boundary', () => {
  const start = Date.parse(live.todayStart)
  const half = vacancyLossProgress(live, start + 43200000)
  assert.equal(half.todayLoss, 40000)
  assert.equal(half.monthLoss, 18 * 80000 + 40000)
  assert.equal(half.monthElapsed, 18.5 * 86400000)
  assert.equal(vacancyLossProgress(live, start + 1000).todayLoss, 80000 / 86400)
  assert.equal(vacancyLossProgress(live, start - 1000).todayLoss, 0)
  assert.equal(vacancyLossProgress(live, start + 2 * 86400000).todayLoss, 80000)
})
test('historical months stay fixed and future months have zero elapsed time', () => {
  const now = Date.parse('2026-11-19T07:00:00Z')
  const historical = vacancyLossProgress({ ...live, includesToday: false, completedDaysLoss: 123, monthStart: '2026-09-30T19:00:00Z', monthEnd: '2026-10-31T19:00:00Z' }, now)
  assert.equal(historical.monthLoss, 123)
  assert.equal(historical.monthElapsed, 31 * 86400000)
  const future = vacancyLossProgress({ ...live, includesToday: false, completedDaysLoss: 0, monthStart: '2026-11-30T19:00:00Z', monthEnd: '2026-12-31T19:00:00Z' }, now)
  assert.equal(future.monthLoss, 0)
  assert.equal(future.monthElapsed, 0)
})
