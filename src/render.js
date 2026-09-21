import { dayKey, dayTotal, emptyDay, human, levelOf, levelThresholds, streak } from './usage.js'

const PAD = 16
const LABEL_W = 26
const CELL = 9
const GAP = 2
const STEP = CELL + GAP
const TITLE_Y = 26
const MONTH_Y = 52
const GRID_Y = 58
const GRID_H = 7 * STEP - GAP

// Warm terracotta ramp — deliberately not GitHub green, so nobody mistakes this
// card for a real contribution graph, and deliberately not any vendor's exact
// brand colour either, since this will grow past a single tool.
const EMPTY = '#21262d'
const LEVELS = ['#21262d', '#4a2a20', '#8c4a2e', '#c4703c', '#f0944e']

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c])

/** Columns of 7 days, oldest first, last column holding `end`. */
export function buildGrid(daily, { end = new Date(), weeks = 53, timeZone } = {}) {
  const start = new Date(end)
  start.setHours(12, 0, 0, 0) // noon: keeps DST from shifting a day across the tz conversion
  start.setDate(start.getDate() - (weeks - 1) * 7 - end.getDay())
  const endKey = dayKey(end.toISOString(), timeZone)

  const cols = []
  for (let w = 0; w < weeks; w++) {
    const col = []
    for (let d = 0; d < 7; d++) {
      const date = new Date(start)
      date.setDate(start.getDate() + w * 7 + d)
      const key = dayKey(date.toISOString(), timeZone)
      col.push({ key, date, future: key > endKey, total: dayTotal(daily[key] ?? emptyDay()) })
    }
    cols.push(col)
  }
  return cols
}

function monthLabels(cols) {
  const out = []
  let prev = null
  cols.forEach((col, w) => {
    const m = col[0].date.getMonth()
    if (prev !== null && m !== prev && w < cols.length - 1) out.push({ w, text: MONTHS[m] })
    prev = m
  })
  return out
}

export function renderCard(daily, { title = 'AI Coding Activity', end = new Date(), weeks = 53, timeZone } = {}) {
  const cols = buildGrid(daily, { end, weeks, timeZone })
  const thresholds = levelThresholds(daily)
  const shown = cols.flat().filter((c) => !c.future)
  const total = shown.reduce((s, c) => s + c.total, 0)
  const days = shown.filter((c) => c.total > 0).length
  const run = streak(daily, end, timeZone)

  const gridW = weeks * STEP - GAP
  const W = PAD * 2 + LABEL_W + gridW
  const footY = GRID_Y + GRID_H + 26
  const H = footY + 14

  const cells = cols
    .map((col, w) =>
      col
        .map((c, d) => {
          if (c.future) return ''
          const fill = c.total > 0 ? LEVELS[levelOf(c.total, thresholds)] : EMPTY
          const x = PAD + LABEL_W + w * STEP
          const y = GRID_Y + d * STEP
          return `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${fill}"><title>${c.key}: ${human(c.total)} tokens</title></rect>`
        })
        .join(''),
    )
    .join('')

  const months = monthLabels(cols)
    .map((m) => `<text class="m" x="${PAD + LABEL_W + m.w * STEP}" y="${MONTH_Y}">${m.text}</text>`)
    .join('')

  const weekdays = [
    [1, 'Mon'],
    [3, 'Wed'],
    [5, 'Fri'],
  ]
    .map(([d, t]) => `<text class="m" x="${PAD}" y="${GRID_Y + d * STEP + CELL - 1}">${t}</text>`)
    .join('')

  const legend = LEVELS.map(
    (fill, i) => `<rect x="${W - PAD - 12 - (LEVELS.length - 1 - i) * 12}" y="${footY - 9}" width="9" height="9" rx="2" fill="${fill}"/>`,
  ).join('')

  const summary = `${human(total)} tokens · ${days} active days${run ? ` · ${run} day streak` : ''}`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}: ${esc(summary)}">
<style>
  text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
  .t { font-size: 14px; font-weight: 600; fill: #e6edf3; }
  .m { font-size: 9px; fill: #7d8590; }
  .f { font-size: 11px; fill: #c9d1d9; }
</style>
<rect width="${W}" height="${H}" rx="8" fill="#0d1117" stroke="#30363d"/>
<text class="t" x="${PAD}" y="${TITLE_Y}">${esc(title)}</text>
${months}${weekdays}${cells}
<text class="f" x="${PAD}" y="${footY}">${esc(summary)}</text>
${legend}
</svg>
`
}
