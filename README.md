# tokengrass

Your AI coding tokens as a contribution-style heatmap — **without faking your real GitHub grass.**

[![AI usage](https://raw.githubusercontent.com/ppirae/ai-usage/main/card.svg)](https://ppirae.github.io/ai-usage/)

Every other tool in this space renders a card and then commits it to a repo every day, which quietly
fills your real contribution graph with automated commits. tokengrass authors those commits as an
address that isn't connected to any GitHub account, so the card updates and your calendar stays honest.

## Quick start

```sh
mkdir ai-usage && cd ai-usage
npx github:ppirae/tokengrass init    # git repo + a daily scheduled run
npx github:ppirae/tokengrass         # scan, render, commit, push
```

(Not on npm yet, hence the `github:` prefix.)

Then drop this in your profile README:

```markdown
![AI usage](https://raw.githubusercontent.com/<you>/ai-usage/main/card.svg)
```

Works on Windows, macOS and Linux. Node 20+. No dependencies, no build step, no account, no server.

## What leaves your machine

Claude Code session logs hold a lot more than token counts — working directories, branch names, file
names, whole prompts. tokengrass reads four numbers and a timestamp per response and nothing else.
The entire payload it commits looks like this:

```json
// data/4edcd9a8.json
{ "2026-09-21": { "in": 490, "out": 211861, "cacheR": 75526724, "cacheW": 3277496 } }
```

That file name is a hash of the machine's hostname, not the hostname itself — work machines are
often named after a staff number, and this ends up in a public repo.

That matters if you use Claude through a work account and want the card on a personal profile. Costs
are deliberately not computed or shown. Check your employer's policy before publishing usage anyway —
the numbers are yours to publish, the decision isn't this tool's to make.

## Why your contribution graph stays clean

GitHub only counts a commit toward your contribution calendar when the author email is connected to
your account ([docs](https://docs.github.com/en/account-and-profile/how-tos/contribution-settings/troubleshooting-missing-contributions)).
So every commit is authored as `bot@tokengrass.invalid` (`.invalid` is reserved by
[RFC 2606](https://www.rfc-editor.org/rfc/rfc2606), it can never belong to anyone). The commits are
still in the repo and the card still updates — the calendar just doesn't count them.

Want the grass? `--grass` commits with your own git identity instead.

## Hovering a day

Each cell carries a `<title>` with its date and token count, but a README renders the card through
`<img>`, and an SVG pulled in that way is a flat image — no tooltips, no hover, no links. GitHub also
strips `<style>`, `<script>`, `<object>`, `<iframe>`, image maps and inline `<svg>` from markdown, so
there is no surface left to attach anything to. Per-day hover inside a README is not possible.

What works instead: every run also writes `index.html`, the same card inlined into a page where the
tooltips do fire. Turn on GitHub Pages for the repo and link the card at it:

```html
<a href="https://<you>.github.io/ai-usage/"><img src="https://raw.githubusercontent.com/<you>/ai-usage/main/card.svg" alt="AI coding activity"></a>
```

Static card in the README, hoverable card one click away.

## More than one machine

The scan is local, so each machine only sees its own `~/.claude`. Run `init` on every machine you
code from and point them at the same repo — each one writes its own file and the card is the sum:

```
data/
  4edcd9a8.json   # work laptop
  9c17b3e0.json   # desktop
card.svg          # all of them, merged
```

Nothing overwrites anything, because no machine ever writes another machine's file. Give them
readable names with `--device work` if you prefer. A machine that was off simply catches up on its
next run — every run rescans the full history rather than appending, so a missed day is not a lost day.

## Usage

```
npx tokengrass            scan logs, update the card, commit & push
npx tokengrass init       set this folder up as a card repo and schedule a daily run
npx tokengrass uninstall  remove the scheduled run
```

### Leaving a machine behind

`init` schedules a job and `gh auth login` stores a GitHub token in that machine's credential store.
On a work laptop you are handing back, both should go:

```sh
npx tokengrass uninstall   # stops the daily run
gh auth logout             # removes the stored token
```

Your card and its history live in the repo, so nothing is lost. Run `init` on the next machine and it
picks up where this one left off — a new machine writes a new `data/` file and the old one stays.

| flag | |
|---|---|
| `--out <dir>` | where to write (default: cwd) |
| `--title <str>` | card title (default: `AI Coding Activity`) |
| `--weeks <n>` | columns to draw (default: 53) |
| `--tz <zone>` | IANA time zone for day boundaries (default: system) |
| `--device <id>` | name this machine's data file (default: hashed hostname) |
| `--at <HH:MM>` | daily run time, `init` only (default: 09:00) |
| `--no-commit` | just write the files |
| `--no-push` | commit but don't push |
| `--grass` | commit as yourself — this **does** plant real grass |

`init` registers a daily task via `schtasks` on Windows and `crontab` elsewhere. The scan runs
locally, so it has to be your machine — a GitHub Action can't see `~/.claude`.

Set `CLAUDE_CONFIG_DIR` if your Claude Code config lives somewhere other than `~/.claude`.

## Notes

- Totals include cache reads, matching how ccusage and tokscale count, so the numbers are comparable.
  Cache reads dominate — a heavy day is billions of tokens, and that's normal.
- Colour intensity is quartiles over your own active days, so the scale fits whoever is running it.
- Duplicate records (sessions get rewritten on resume and compaction) are collapsed by message +
  request id, so nothing is double counted.
- Claude Code only, for now.

## Development

```sh
node test.js
```

## Legal

Not affiliated with, endorsed by, or sponsored by Anthropic. "Claude" and "Claude Code" are
trademarks of Anthropic, used here only to say what this tool reads.

MIT
