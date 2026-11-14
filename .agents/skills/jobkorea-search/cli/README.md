# jobkorea-cli

CLI for searching job listings on **JobKorea** (jobkorea.co.kr), South Korea's largest
general job board.

**Data source**: JobKorea's public search API (`POST /Search/api/display/v2/jobs`) and
posting pages (`/Recruit/GI_Read/<id>` + `/Recruit/GI_Read_Comt_Ifrm`).
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

> **Personal use only.** Keep volume low, don't use it commercially or for bulk data
> collection, and run it on your own responsibility.

## Installation

```bash
cd .agents/skills/jobkorea-search/cli
bun install   # optional — only installs TypeScript dev types for `bun run typecheck`
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search job listings by keyword, region and posting age |
| `detail` | Fetch one posting's summary and description text |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
bun run src/cli.ts search -q "유니티 클라이언트" -l "서울,경기" --order recent --jobage 14 --format table
bun run src/cli.ts search -q "게임 클라이언트" -l 판교 --format table
bun run src/cli.ts detail 50353055 --format plain
```

## Tests

```bash
bun run test        # parsing tests (offline) + a few live smoke tests
bun run typecheck   # needs `bun install` first
```

See `../url-reference.md` for the endpoint, body fields, area codes and the parsing
anchors to update if JobKorea changes its API or markup.
