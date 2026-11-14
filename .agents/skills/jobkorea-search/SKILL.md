---
name: jobkorea-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search for jobs in South Korea on
  JobKorea (jobkorea.co.kr), Korea's largest general job board, find Korean job
  listings by keyword and region, or look up a specific JobKorea posting — game
  client/server programmers, Unity or Unreal developers, software engineers, and
  any other role. Trigger phrases include: jobkorea, 잡코리아, 채용공고, 채용 검색,
  구인, 일자리, 이직, 경력 채용, 신입 채용, 개발자 채용, 프로그래머 채용, 게임
  개발자 채용, 유니티 개발자 채용, 언리얼 개발자 채용, 판교 채용, 서울 채용,
  job search korea, korean job listings, developer jobs seoul, jobs pangyo,
  unity developer korea.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/jobkorea-search/cli/src/cli.ts *)
---

# JobKorea Search Skill

Search live job listings in South Korea from **JobKorea** (jobkorea.co.kr), the
country's largest general job board. No authentication, no API key, and **zero
runtime dependencies** — it runs with just `bun`. Postings are in Korean.

## ⚠️ Personal use only

This reads JobKorea's public search API and posting pages (robots.txt allows
`/Search/` and `/Recruit/GI_Read/` for general user agents, checked 2026-11-14).
Keep volume low, don't use it commercially or for bulk data collection, and run it
on your own responsibility.

## When to use this skill

- Search Korean openings by keyword (role, engine, skill, company)
- Narrow by region (서울, 경기, 판교 / 성남시 분당구, …) on the site's side
- Keep only recent postings (registered within N days)
- Read one posting's summary (field, career, employment type, salary, address,
  skills, preferred qualifications, deadline) and its text description

## Commands

### Search job listings

```bash
bun run .agents/skills/jobkorea-search/cli/src/cli.ts search [-q "<keywords>"] [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keywords, at most **30 characters** (the site
  ignores longer ones and returns everything, so the CLI rejects them). Matching is
  broad — a keyword can match an unrelated posting's tags — so pre-filter on title.
- `--location <list>` / `-l <list>` — comma-separated regions, applied by the site:
  province names (`서울`, `경기`, `인천`, …), `"서울 강남구"`, `"성남시 분당구"`,
  a unique district name (`분당구`), the alias `판교` (= 성남시 분당구), or raw
  JobKorea area codes (`I000`, `B150`). An unknown name is an error, never dropped.
- `--jobage <days>` — keep postings registered within N days. The site narrows by
  its own period first (최근3일 / 1주일 / 1개월); the exact cut is client-side on each
  posting's registration date.
- `--order relevance|recent` — `relevance` (default, the site's 관련도순) or
  `recent` (등록일순). Use `recent` together with `--jobage`.
- `--page <n>` — 1-indexed page, 40 results per page (max 500).
- `--limit <n>` / `-n <n>` — cap results emitted (client-side).
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/jobkorea-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the numeric `id` from search results (e.g. `50353055`); a
`jobkorea.co.kr/Recruit/GI_Read/<id>` URL also works. Returns title, company,
region, full address, registration date, deadline, open/closed status, 모집분야,
모집인원, 경력, 고용형태, 학력, 급여, 근무시간, 스킬, 우대조건 and the description text.

## Usage examples

```bash
# Unity client roles in Seoul or Gyeonggi registered in the last 14 days, newest first
bun run .agents/skills/jobkorea-search/cli/src/cli.ts search -q "유니티 클라이언트" -l "서울,경기" --order recent --jobage 14 --format table

# Game client roles in Pangyo (성남시 분당구)
bun run .agents/skills/jobkorea-search/cli/src/cli.ts search -q "게임 클라이언트" -l 판교 --format table

# Unreal roles in Seoul, readable list
bun run .agents/skills/jobkorea-search/cli/src/cli.ts search -q "언리얼" -l 서울 --order recent --limit 10 --format plain

# Build / DevOps roles at game companies
bun run .agents/skills/jobkorea-search/cli/src/cli.ts search -q "게임 빌드 엔지니어" --order recent --jobage 30 --format table

# Full details for one posting
bun run .agents/skills/jobkorea-search/cli/src/cli.ts detail 50353055 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a list or a single posting's detail |

Search JSON: `{ "meta": { "count", "page", "total" }, "results": [...] }`; each result
has `id`, `title`, `company`, `location` (e.g. `경기 성남시 분당구`), `date`
(registration, `YYYY-MM-DD` KST), `deadline` (`YYYY-MM-DD`, or `상시` for open-ended
postings), `career`, `education`, `employmentType`, `salary`, `field`, `source`
(`jobkorea` | `gamejob` | `external`) and `url`. Missing values are `null`.
`meta.total` is the site's hit count before the client-side `--jobage` cut.

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the
process exits with code `1`.

## Notes

- **Many descriptions are images.** Korean boards often post the whole description
  as images. `detail` then returns `description: null` and a `descriptionImages`
  count; the summary fields (경력, 고용형태, 스킬, 우대조건, …) are still text. Open
  the URL for the rest.
- **GameJob overlap.** JobKorea and GameJob are the same company; game postings often
  appear on both. A result with `source: "gamejob"` links to gamejob.co.kr — read it
  with the `gamejob-search` skill. Deduplicate across the two by company + title.
- `salary` is shown only when the employer entered a range (연봉/월급 in 만원);
  most postings say 회사 내규에 따름, which `detail` returns as text.
- `isActive` in `detail` is derived from the deadline (a dated deadline in the past
  means closed); open-ended postings (`상시채용`) count as active.
- The search posts JSON to `/Search/api/display/v2/jobs`, the same endpoint the
  site's result page calls; see `url-reference.md` for the body fields, area codes
  and parsing anchors.
