#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { claudeProjectsDir, deviceId, human, mergeDaily, scanUsage } from '../src/usage.js'
import { renderCard } from '../src/render.js'

// Authoring commits as an address that is not attached to any GitHub account is
// what keeps the real contribution calendar clean — GitHub only counts commits
// whose author email is connected to your account.
const BOT_EMAIL = 'bot@tokengrass.invalid'
const BOT_NAME = 'tokengrass'

const HELP = `tokengrass — your AI coding tokens as a heatmap, without faking your real GitHub grass

  npx tokengrass            scan logs, write data.json + card.svg, commit & push
  npx tokengrass init       set this folder up as a card repo and schedule a daily run

Options
  --out <dir>     where to write (default: cwd)
  --title <str>   card title (default: "AI Coding Activity")
  --weeks <n>     columns to draw (default: 53)
  --tz <zone>     IANA time zone for day boundaries (default: system)
  --device <id>   name this machine's data file (default: hashed hostname)
  --at <HH:MM>    daily run time, init only (default: 09:00)
  --no-commit     just write the files
  --no-push       commit but do not push
  --grass         commit with your own git identity (this DOES plant real grass)
`

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string' },
    title: { type: 'string' },
    weeks: { type: 'string' },
    tz: { type: 'string' },
    at: { type: 'string' },
    device: { type: 'string' },
    'no-commit': { type: 'boolean', default: false },
    'no-push': { type: 'boolean', default: false },
    grass: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
})

const outDir = resolve(values.out ?? process.cwd())
const git = (args, opts = {}) => spawnSync('git', args, { cwd: outDir, encoding: 'utf8', ...opts })
const gitOut = (args) => {
  const r = git(args)
  return r.status === 0 ? r.stdout.trim() : ''
}

function rawUrl() {
  const remote = gitOut(['remote', 'get-url', 'origin'])
  const m = remote.match(/github\.com[:/](.+?)(?:\.git)?$/)
  const branch = gitOut(['rev-parse', '--abbrev-ref', 'HEAD']) || 'main'
  const slug = m ? m[1] : '<you>/<repo>'
  return `https://raw.githubusercontent.com/${slug}/${branch}/card.svg`
}

async function run() {
  const dir = claudeProjectsDir()
  if (!existsSync(dir)) {
    console.error(`No Claude Code logs at ${dir}. Set CLAUDE_CONFIG_DIR if yours lives elsewhere.`)
    process.exit(1)
  }

  const daily = await scanUsage({ dir, timeZone: values.tz })
  if (!Object.keys(daily).length) {
    console.error(`No usage found in ${dir}.`)
    process.exit(1)
  }

  const isRepo = gitOut(['rev-parse', '--is-inside-work-tree']) === 'true'
  // Pull first so other machines' files are on disk before we merge and render.
  if (isRepo && gitOut(['remote'])) git(['pull', '--rebase', '--autostash'])

  // One file per machine: every device only ever writes its own, so two laptops
  // pushing to the same repo add up instead of overwriting each other.
  const dataDir = join(outDir, 'data')
  await mkdir(dataDir, { recursive: true })
  const device = values.device || deviceId()
  await writeFile(join(dataDir, `${device}.json`), `${JSON.stringify(daily)}\n`)

  // Other machines write these, so a half-pushed or hand-edited file must not
  // take the whole run down — skip it and carry on with the rest.
  const files = []
  for (const f of (await readdir(dataDir)).filter((f) => f.endsWith('.json'))) {
    try {
      files.push([f, JSON.parse((await readFile(join(dataDir, f), 'utf8')).replace(/^﻿/, ''))])
    } catch (e) {
      console.warn(`Skipping unreadable ${join('data', f)}: ${e.message}`)
    }
  }
  const merged = mergeDaily(files.map(([, d]) => d))

  const svg = renderCard(merged, {
    title: values.title,
    weeks: values.weeks ? Number(values.weeks) : undefined,
    timeZone: values.tz,
  })
  await writeFile(join(outDir, 'card.svg'), svg)

  const days = Object.keys(merged).length
  const total = Object.values(merged).reduce((s, d) => s + d.in + d.out + d.cacheR + d.cacheW, 0)
  const from = files.length > 1 ? ` from ${files.length} devices` : ''
  console.log(`${days} days · ${human(total)} tokens${from} → ${join(outDir, 'card.svg')}`)

  if (values['no-commit']) return
  if (!isRepo) {
    console.log('Not a git repo — skipping commit. Run `tokengrass init` here first.')
    return
  }

  git(['add', 'data', 'card.svg'])
  if (git(['diff', '--cached', '--quiet']).status === 0) {
    console.log('No change since last run.')
    return
  }

  const identity = values.grass ? [] : ['-c', `user.email=${BOT_EMAIL}`, '-c', `user.name=${BOT_NAME}`]
  const commit = git([...identity, 'commit', '-m', `chore: update card (${human(total)} tokens)`])
  if (commit.status !== 0) {
    console.error(commit.stderr.trim())
    process.exit(1)
  }
  console.log(values.grass ? 'Committed with your identity — this will show on your contribution graph.' : 'Committed as an unlinked author — your contribution graph is untouched.')

  if (values['no-push']) return
  const push = git(['push'])
  console.log(push.status === 0 ? 'Pushed.' : `Push failed:\n${push.stderr.trim()}`)
}

function schedule(at) {
  if (process.platform === 'win32') {
    const r = spawnSync(
      'schtasks',
      ['/Create', '/F', '/SC', 'DAILY', '/ST', at, '/TN', 'tokengrass', '/TR', `cmd /c cd /d "${outDir}" && npx -y tokengrass`],
      { encoding: 'utf8' },
    )
    return r.status === 0 ? 'Scheduled daily via schtasks (task "tokengrass").' : `Could not schedule: ${r.stderr.trim()}`
  }
  const [h, m] = at.split(':')
  const line = `${Number(m)} ${Number(h)} * * * cd ${outDir} && npx -y tokengrass`
  const current = spawnSync('crontab', ['-l'], { encoding: 'utf8' })
  const existing = current.status === 0 ? current.stdout : ''
  if (existing.includes('tokengrass')) return 'crontab already has a tokengrass entry.'
  const w = spawnSync('crontab', ['-'], { input: `${existing}${existing.endsWith('\n') || !existing ? '' : '\n'}${line}\n`, encoding: 'utf8' })
  return w.status === 0 ? 'Scheduled daily via crontab.' : `Add this to your crontab manually:\n  ${line}`
}

function init() {
  if (gitOut(['rev-parse', '--is-inside-work-tree']) !== 'true') {
    git(['init', '-b', 'main'])
    console.log('Initialised a git repo here.')
  }
  console.log(schedule(values.at ?? '09:00'))
  console.log(`
Done. Next:
  1. create a repo and point origin at it, e.g.
       gh repo create ai-usage --public --source . --remote origin
  2. run once to fill the card:
       npx tokengrass
  3. embed it in your profile README:

![AI usage](${rawUrl()})
`)
}

if (values.help) {
  console.log(HELP)
} else if (positionals[0] === 'init') {
  init()
} else if (positionals.length) {
  console.error(`Unknown command: ${positionals[0]}\n\n${HELP}`)
  process.exit(1)
} else {
  await run()
}
