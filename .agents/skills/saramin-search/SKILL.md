---
name: saramin-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search for jobs in South Korea on
  Saramin (saramin.co.kr), one of Korea's largest general job boards, find Korean
  job listings by keyword and region, or look up a specific Saramin posting — game
  client/server programmers, Unity or Unreal developers, software engineers, and
  any other role. Trigger phrases include: saramin, 사람인, 채용공고, 채용 검색,
  구인, 일자리, 이직, 경력 채용, 신입 채용, 개발자 채용, 프로그래머 채용, 게임
  개발자 채용, 유니티 개발자 채용, 언리얼 개발자 채용, 판교 채용, 서울 채용,
  job search korea, korean job listings, developer jobs seoul, jobs pangyo,
  unity developer korea.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/saramin-search/cli/src/cli.ts *)
---

# Saramin Search Skill

Search live job listings in South Korea from **Saramin** (saramin.co.kr), one of the
country's largest general job boards. No authentication, no API key, and **zero
runtime dependencies** — it runs with just `bun`. Postings are in Korean.

## ⚠️ Personal use only

This reads Saramin's public search and posting pages (robots.txt allows
`/zf_user/search/` and `/zf_user/jobs/relay/` for general user agents, checked
2026-11-14). Saramin's member terms forbid passing on information from the service
or using it for anything but job seeking. Keep volume low, use it only for your own
job search, don't share or republish what it returns, and run it on your own
responsibility.

## When to use this skill

- Search Korean openings by keyword (role, engine, skill, company)
- Narrow by region (서울, 경기, 판교 / 성남시 분당구, …) on the site's side
- Keep only recent postings (shown date within N days)
- Read one posting's summary (career, education, employment type, salary, work
  hours, address, keywords, deadline) and its text description

## Commands

### Search job listings

```bash
bun run .agents/skills/saramin-search/cli/src/cli.ts search [-q "<keywords>"] [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keywords. Every word must match, but matching is
  broad (company tags and body text count), so unrelated postings slip in — pre-filter
  on title. Fewer words find more.
- `--location <list>` / `-l <list>` — comma-separated regions, applied by the site:
  province names (`서울`, `경기`, `인천`, …), `"서울 강남구"`, `"성남시 분당구"`, a
  unique district name (`분당구`), the alias `판교` (= 성남시 분당구), or raw Saramin
  area codes (`101000`, `102190`). An unknown or ambiguous name (`중구`) is an error,
  never dropped.
- `--jobage <days>` — keep postings whose shown date is within N days. Saramin has no
  posting-age parameter, so this cuts the fetched page client-side: use it with
  `--order recent` and page further if needed. A card shows its last-edit date once a
  posting is edited (`dateType: "modified"`), so recently edited older postings pass.
- `--order relevance|recent` — `relevance` (default, 관련도순) or `recent` (등록일순).
- `--page <n>` — 1-indexed page, 40 results per page.
- `--limit <n>` / `-n <n>` — cap results emitted (client-side).
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/saramin-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the numeric `rec_idx` from search results (e.g. `55569320`); any
`saramin.co.kr` URL carrying `rec_idx=` also works. Returns title, company, region,
address, start date, deadline, open/closed status, 경력, 학력, 근무형태, 급여,
근무일시, 직급/직책, 우대사항, keywords and the description text.

## Usage examples

```bash
# Unity client roles in Seoul or Gyeonggi, newest first, shown within the last 14 days
bun run .agents/skills/saramin-search/cli/src/cli.ts search -q "유니티 클라이언트" -l "서울,경기" --order recent --jobage 14 --format table

# Game client roles in Pangyo (성남시 분당구)
bun run .agents/skills/saramin-search/cli/src/cli.ts search -q "게임 클라이언트" -l 판교 --format table

# Unreal roles in Seoul, readable list
bun run .agents/skills/saramin-search/cli/src/cli.ts search -q "언리얼" -l 서울 --order recent --limit 10 --format plain

# Build / DevOps roles at game companies
bun run .agents/skills/saramin-search/cli/src/cli.ts search -q "게임 빌드" --order recent --jobage 30 --format table

# Full details for one posting
bun run .agents/skills/saramin-search/cli/src/cli.ts detail 55569320 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a list or a single posting's detail |

Search JSON: `{ "meta": { "count", "page", "total" }, "results": [...] }`; each result
has `id`, `title`, `company`, `location` (e.g. `경기 성남시 분당구`), `career`,
`education`, `employmentType`, `salary`, `date` (`YYYY-MM-DD`), `dateType`
(`registered` | `modified`), `deadline` (`YYYY-MM-DD`, or `상시` / `채용시` for
open-ended postings), `keywords` and `url`. Missing values are `null`. `meta.total` is
the site's hit count before the client-side `--jobage` cut.

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the
process exits with code `1`.

## Notes

- **Many descriptions are images.** Korean boards often post the whole description
  as an image. `detail` then returns `description: null` and a `descriptionImages`
  count; the summary fields (경력, 근무형태, 급여, …) are still text. Open the URL for
  the rest.
- **Overlap with JobKorea / GameJob.** Many companies post the same opening on
  several boards. Deduplicate across portals by company + title.
- Card deadlines carry no year (`~ 12/13(일)`); the CLI picks the year that puts the
  date nearest after today. `detail` reads the full date.
- `salary` on a card appears only when the employer entered a figure; `detail` returns
  the 급여 text (often 면접 후 결정 / 회사내규에 따름).
- Recruiter names and phone numbers on the posting are deliberately not returned.
- `isActive` in `detail` is derived from the deadline (a dated deadline in the past
  means closed); open-ended postings count as active.
- The posting content comes from `POST /zf_user/jobs/relay/view-ajax`, the request
  the posting page itself makes; see `url-reference.md` for parameters, area codes
  and parsing anchors.
