import assert from 'node:assert/strict'
import { hostname } from 'node:os'
import { dayTotal, deviceId, foldLine, human, levelOf, levelThresholds, mergeDaily, streak } from './src/usage.js'
import { buildGrid, renderCard } from './src/render.js'

const TZ = 'UTC'
const rec = (o) => JSON.stringify(o)
const assistant = (ts, usage, ids = {}) =>
  rec({
    type: 'assistant',
    timestamp: ts,
    requestId: ids.requestId ?? `req_${ts}`,
    uuid: ids.uuid ?? `u_${ts}`,
    message: { id: ids.messageId ?? `msg_${ts}`, model: 'claude-opus-5', usage },
    cwd: '/secret/work/project',
    gitBranch: 'feature/internal',
  })

// --- fold: sums the four token fields, keyed by local day ---------------------
{
  const daily = {}
  const seen = new Set()
  const usage = { input_tokens: 2, output_tokens: 201, cache_read_input_tokens: 27837, cache_creation_input_tokens: 23243 }
  assert.equal(foldLine(assistant('2026-09-21T01:17:35.210Z', usage), daily, seen, TZ), true)
  assert.deepEqual(daily['2026-09-21'], { in: 2, out: 201, cacheR: 27837, cacheW: 23243 })
  assert.equal(dayTotal(daily['2026-09-21']), 51283)
}

// --- fold: the same API response in two files is counted once -----------------
{
  const daily = {}
  const seen = new Set()
  const usage = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  const ids = { messageId: 'msg_A', requestId: 'req_A', uuid: 'u1' }
  foldLine(assistant('2026-09-21T10:00:00.000Z', usage, ids), daily, seen, TZ)
  foldLine(assistant('2026-09-21T10:00:00.000Z', usage, { ...ids, uuid: 'u2' }), daily, seen, TZ)
  assert.equal(dayTotal(daily['2026-09-21']), 30, 'duplicate requestId must not double-count')
}

// --- fold: ignores anything that is not an assistant response with usage ------
{
  const daily = {}
  const seen = new Set()
  assert.equal(foldLine('', daily, seen, TZ), false)
  assert.equal(foldLine('not json', daily, seen, TZ), false)
  assert.equal(foldLine(rec({ type: 'user', message: { content: 'usage' } }), daily, seen, TZ), false)
  assert.equal(foldLine(rec({ type: 'assistant', message: { usage: { input_tokens: 1 } } }), daily, seen, TZ), false, 'no timestamp')
  assert.deepEqual(daily, {})
}

// --- levels: quartiles over active days, zero stays level 0 -------------------
{
  const daily = {}
  for (const [day, out] of [[1, 10], [2, 20], [3, 30], [4, 40], [5, 0]]) {
    daily[`2026-09-0${day}`] = { in: 0, out, cacheR: 0, cacheW: 0 }
  }
  const t = levelThresholds(daily)
  assert.equal(levelOf(0, t), 0)
  assert.equal(levelOf(10, t), 1)
  assert.equal(levelOf(40, t), 4)
  assert.ok(levelOf(20, t) < levelOf(40, t))
}

// --- streak: counts back from today, a quiet today does not break it ----------
{
  const daily = { '2026-09-19': { in: 1, out: 0, cacheR: 0, cacheW: 0 }, '2026-09-20': { in: 1, out: 0, cacheR: 0, cacheW: 0 } }
  assert.equal(streak(daily, new Date('2026-09-20T12:00:00Z'), TZ), 2)
  assert.equal(streak(daily, new Date('2026-09-21T12:00:00Z'), TZ), 2, 'nothing logged yet today')
  assert.equal(streak(daily, new Date('2026-09-22T12:00:00Z'), TZ), 0, 'a full missed day ends it')
  assert.equal(streak({}, new Date('2026-09-21T12:00:00Z'), TZ), 0)
}

// --- grid: ends on today, nothing in the future, right number of cells --------
{
  const end = new Date('2026-09-21T12:00:00Z') // a Monday
  const cols = buildGrid({}, { end, weeks: 4, timeZone: TZ })
  assert.equal(cols.length, 4)
  assert.equal(cols.flat().length, 28)
  const visible = cols.flat().filter((c) => !c.future)
  assert.equal(visible.at(-1).key, '2026-09-21', 'last drawn cell is today')
  assert.ok(cols.at(-1).some((c) => c.future), 'rest of the current week is not drawn')
  assert.ok(visible.every((c) => c.key <= '2026-09-21'))
}

// --- render: totals only the visible window, emits well-formed svg ------------
{
  const daily = {
    '2026-09-20': { in: 1, out: 2, cacheR: 3, cacheW: 4 }, // inside a 4-week window
    '2020-01-01': { in: 1e6, out: 0, cacheR: 0, cacheW: 0 }, // far outside it
  }
  const end = new Date('2026-09-21T12:00:00Z')
  const drawn = buildGrid(daily, { end, weeks: 4, timeZone: TZ }).flat().filter((c) => !c.future).length
  const svg = renderCard(daily, { end, weeks: 4, timeZone: TZ, title: 'a & b' })
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  assert.match(svg, /<\/svg>\s*$/)
  assert.match(svg, /10 tokens · 1 active days/, 'out-of-window days must not be summed')
  assert.match(svg, /a &amp; b/, 'title is xml-escaped')
  assert.doesNotMatch(svg, /project|feature\/internal/, 'no path or branch may reach the card')
  assert.equal((svg.match(/<rect/g) || []).length, drawn + 1 + 5, 'one rect per drawn day, plus card bg and legend')
}

// --- merge: two machines add up on shared days, keep their own elsewhere ------
{
  const work = { '2026-09-20': { in: 1, out: 2, cacheR: 3, cacheW: 4 }, '2026-09-21': { in: 5, out: 0, cacheR: 0, cacheW: 0 } }
  const home = { '2026-09-21': { in: 10, out: 20, cacheR: 30, cacheW: 40 } }
  const merged = mergeDaily([work, home])
  assert.deepEqual(merged['2026-09-20'], { in: 1, out: 2, cacheR: 3, cacheW: 4 })
  assert.deepEqual(merged['2026-09-21'], { in: 15, out: 20, cacheR: 30, cacheW: 40 })
  assert.deepEqual(work['2026-09-21'], { in: 5, out: 0, cacheR: 0, cacheW: 0 }, 'inputs must not be mutated')
  assert.deepEqual(mergeDaily([]), {})
  assert.deepEqual(mergeDaily([work]), work)
}

// --- device id: stable, opaque, never the raw hostname ------------------------
{
  const id = deviceId()
  assert.match(id, /^[0-9a-f]{8}$/)
  assert.equal(id, deviceId(), 'same machine must keep the same file')
  assert.doesNotMatch(id, new RegExp(hostname().slice(0, 4), 'i'), 'hostname must not be readable from the id')
}

// --- human -------------------------------------------------------------------
assert.equal(human(999), '999')
assert.equal(human(1500), '2K')
assert.equal(human(2_300_000), '2.3M')
assert.equal(human(4_100_000_000), '4.1B')

console.log('ok')
