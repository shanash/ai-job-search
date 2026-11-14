# gamejob-cli

CLI for searching game-industry job listings on **GameJob** (gamejob.co.kr), South
Korea's game job board.

**Data source**: GameJob public pages (`/Recruit/_GI_Job_List/` and `/Recruit/GI_Read/View`).
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

> **Personal use only.** Keep volume low, don't use it commercially or for bulk data
> collection, and run it on your own responsibility.

## Installation

```bash
cd .agents/skills/gamejob-search/cli
bun install   # optional — only installs TypeScript dev types for `bun run typecheck`
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search job listings by keyword |
| `detail` | Fetch one posting's summary and description text |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
bun run src/cli.ts search -q "유니티 클라이언트" --order recent --jobage 14 --format table
bun run src/cli.ts search -q "언리얼 클라이언트" --format table
bun run src/cli.ts detail 286906 --format plain
```

## Tests

```bash
bun run test        # parsing tests (offline) + a few live smoke tests
bun run typecheck   # needs `bun install` first
```

See `../url-reference.md` for the endpoints and the parsing anchors to update if
GameJob changes its markup.
