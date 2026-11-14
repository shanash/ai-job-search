---
name: gamejob-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search for game-industry jobs in South
  Korea on GameJob (gamejob.co.kr), find Korean game company job listings, or look
  up a specific GameJob posting — game client/server programmers, Unity or Unreal
  developers, game designers (기획), artists, QA, live ops. Trigger phrases include:
  gamejob, 게임잡, 게임 채용, 게임 회사 채용, 게임 구인, 게임 개발자 채용, 게임
  클라이언트 프로그래머, 유니티 개발자 채용, 언리얼 개발자 채용, 게임 기획자 채용,
  게임 공고, 채용공고, game jobs korea, korean game company jobs, game developer
  jobs seoul, unity developer korea, unreal programmer korea, game jobs pangyo.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/gamejob-search/cli/src/cli.ts *)
---

# GameJob Search Skill

Search live game-industry job listings in South Korea from **GameJob**
(gamejob.co.kr, a JobKorea-family board dedicated to game companies). No
authentication, no API key, and **zero runtime dependencies** — it runs with just
`bun`. Postings are in Korean.

## ⚠️ Personal use only

This reads GameJob's public pages (robots.txt allows `/Recruit/`, checked
2026-11-14). Keep volume low, don't use it commercially or for bulk data
collection, and run it on your own responsibility.

## When to use this skill

- Search Korean game-company openings by keyword (role, engine, skill)
- Keep only recent postings (registered within N days)
- Read one posting's summary (field, career, employment type, salary, deadline) and
  its text description

## Commands

### Search job listings

```bash
bun run .agents/skills/gamejob-search/cli/src/cli.ts search [-q "<keywords>"] [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keywords, e.g. `"유니티 클라이언트"`. Words are
  matched loosely across title, company and posting keywords, so results are broad;
  pre-filter on title.
- `--jobage <days>` — keep postings registered within N days. **Client-side**: the
  board has no age parameter, so this filters the fetched page by each row's
  registration date (postings with no parsable date are kept).
- `--order recommended|recent` — `recommended` (default, the site's own ranking,
  which puts paid listings first) or `recent` (registration date). Use `recent`
  together with `--jobage`.
- `--page <n>` — 1-indexed page, 40 results per page.
- `--limit <n>` / `-n <n>` — cap results emitted (client-side).
- `--format json|table|plain` — default `json`.

There is **no location flag**: keyword search has no location parameter. Filter on
each result's `location` field (e.g. `서울 > 강남구`, `경기 > 성남시`).

### Fetch full job detail

```bash
bun run .agents/skills/gamejob-search/cli/src/cli.ts detail <GI_No|url> [--format json|plain]
```

`GI_No` is the numeric `id` from search results (e.g. `286906`); a
`gamejob.co.kr` posting URL also works. Returns title, company, location, field,
keywords, career, employment type, education, position, salary, start date,
deadline, open/closed status, the description text and the qualifications text.

## Usage examples

```bash
# Unity client roles registered in the last 14 days, newest first
bun run .agents/skills/gamejob-search/cli/src/cli.ts search -q "유니티 클라이언트" --order recent --jobage 14 --format table

# Unreal client roles
bun run .agents/skills/gamejob-search/cli/src/cli.ts search -q "언리얼 클라이언트" --order recent --format table

# Combat client programmers, readable list
bun run .agents/skills/gamejob-search/cli/src/cli.ts search -q "전투 클라이언트" --limit 10 --format plain

# Build / tooling roles at game companies
bun run .agents/skills/gamejob-search/cli/src/cli.ts search -q "빌드 엔지니어" --order recent --format table

# Full details for one posting
bun run .agents/skills/gamejob-search/cli/src/cli.ts detail 286906 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a list or a single posting's detail |

Search JSON: `{ "meta": { "count", "page", "total" }, "results": [...] }`; each result
has `id`, `title`, `company`, `location`, `date` (registration, `YYYY-MM-DD`),
`deadline` (`YYYY-MM-DD`, or a label such as `채용시` / `상시`), `career`,
`education`, `employmentType`, `gameField`, `url`. Missing values are `null`.

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the
process exits with code `1`.

## Notes

- **Many descriptions are images.** Korean boards often post the whole job
  description as images. `detail` then returns a `null`/short description and a
  `descriptionImages` count; read the summary fields and open the URL for the rest.
- Dates on list rows have no year (`11/05(목)`); the CLI resolves the year from the
  weekday, so a 2025 posting is not mistaken for 2026. Relative labels
  (`13시간 전`) are resolved against the current date.
- The list row date is the registration/modification date, which can differ by a
  day from the detail page's 시작일.
- The search posts to `/Recruit/_GI_Job_List/`, the same endpoint the site's
  result page uses; see `url-reference.md` for parameters and parsing anchors.
