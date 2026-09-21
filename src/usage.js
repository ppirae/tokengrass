import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'

/** Where Claude Code keeps its session logs. Honours CLAUDE_CONFIG_DIR. */
export function claudeProjectsDir() {
  const base = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  return join(base, 'projects')
}

export async function findLogs(dir) {
  const names = await readdir(dir, { recursive: true }).catch(() => [])
  return names.filter((n) => n.endsWith('.jsonl')).map((n) => join(dir, n))
}

/** UTC ISO timestamp -> local YYYY-MM-DD. en-CA formats as ISO. */
export function dayKey(iso, timeZone) {
  return new Date(iso).toLocaleDateString('en-CA', timeZone ? { timeZone } : undefined)
}

export function emptyDay() {
  return { in: 0, out: 0, cacheR: 0, cacheW: 0 }
}

export function dayTotal(d) {
  return d.in + d.out + d.cacheR + d.cacheW
}

/**
 * Fold one JSONL line into the daily totals. Returns true if it counted.
 * Only date + token counts are kept — cwd, gitBranch, prompts and file names
 * are never read out of the record, so nothing identifying can leak into the card.
 */
export function foldLine(line, daily, seen, timeZone) {
  if (!line || line[0] !== '{' || !line.includes('"usage"')) return false
  let r
  try {
    r = JSON.parse(line)
  } catch {
    return false
  }
  if (r.type !== 'assistant') return false
  const u = r.message?.usage
  if (!u || !r.timestamp) return false

  // Sessions get re-written on resume/compaction, so the same API response can
  // appear in several files. messageId+requestId is the stable identity.
  const id = r.message?.id && r.requestId ? `${r.message.id}:${r.requestId}` : r.requestId || r.uuid
  if (id) {
    if (seen.has(id)) return false
    seen.add(id)
  }

  const key = dayKey(r.timestamp, timeZone)
  const d = (daily[key] ??= emptyDay())
  d.in += u.input_tokens || 0
  d.out += u.output_tokens || 0
  d.cacheR += u.cache_read_input_tokens || 0
  d.cacheW += u.cache_creation_input_tokens || 0
  return true
}

export async function scanUsage({ dir = claudeProjectsDir(), timeZone } = {}) {
  const daily = {}
  const seen = new Set()
  for (const file of await findLogs(dir)) {
    const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity })
    for await (const line of rl) foldLine(line, daily, seen, timeZone)
  }
  return daily
}

/** Consecutive days with usage, counting back from today (a quiet today doesn't break it). */
export function streak(daily, today = new Date(), timeZone) {
  const cursor = new Date(today)
  const key = () => dayKey(cursor.toISOString(), timeZone)
  let n = 0
  if (!daily[key()]) cursor.setDate(cursor.getDate() - 1)
  while (daily[key()]) {
    n++
    cursor.setDate(cursor.getDate() - 1)
  }
  return n
}

/** GitHub-style quartiles over active days only, so the scale fits whoever is running it. */
export function levelThresholds(daily) {
  const totals = Object.values(daily).map(dayTotal).filter((t) => t > 0).sort((a, b) => a - b)
  if (!totals.length) return [0, 0, 0]
  const at = (q) => totals[Math.floor((totals.length - 1) * q)]
  const [q1, q2, q3] = [at(0.25), at(0.5), at(0.75)]
  // Too few days, or every day the same: no spread to show, so light them all up.
  return q1 === q3 ? [0, 0, 0] : [q1, q2, q3]
}

export function levelOf(total, thresholds) {
  if (total <= 0) return 0
  const [q1, q2, q3] = thresholds
  if (total <= q1) return 1
  if (total <= q2) return 2
  if (total <= q3) return 3
  return 4
}

/**
 * Stable per-machine id. Hashed, because a work machine's hostname often carries
 * a staff number and this lands in a public repo. Override with --device.
 */
export function deviceId() {
  return createHash('sha256').update(hostname()).digest('hex').slice(0, 8)
}

/** Sum several devices' daily totals into one calendar. */
export function mergeDaily(perDevice) {
  const out = {}
  for (const daily of perDevice) {
    for (const [day, d] of Object.entries(daily)) {
      const t = (out[day] ??= emptyDay())
      t.in += d.in || 0
      t.out += d.out || 0
      t.cacheR += d.cacheR || 0
      t.cacheW += d.cacheW || 0
    }
  }
  return out
}

export function human(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`
  return String(n)
}
