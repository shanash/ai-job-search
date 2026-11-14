#!/usr/bin/env bun
// Self-contained CLI for searching job listings on JobKorea (jobkorea.co.kr),
// Korea's general job board. No external CLI framework, so it runs anywhere
// `bun` is available with zero install beyond the repo clone.
//
// Personal use only: keep volume low and do not use it commercially or for
// bulk data collection.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { resolveLocations } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", n: "limit", l: "location" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("--") || a.startsWith("-")) {
      const key = alias[a.replace(/^-+/, "")] ?? a.replace(/^-+/, "")
      const next = argv[i + 1]
      if (next === undefined || next.startsWith("-")) {
        flags[key] = true
      } else {
        flags[key] = next
        i++
      }
    } else {
      ;(flags._ as string[]).push(a)
    }
  }
  return flags
}

const HELP = `jobkorea-cli — search job listings on JobKorea (jobkorea.co.kr, Korea)

USAGE
  bun run src/cli.ts search [-q "<keywords>"] [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keywords (job title, skill, company), at most 30
                          characters, e.g. "유니티 클라이언트".
  --location, -l <list>   Comma-separated regions: names ("서울", "경기",
                          "서울 강남구", "성남시 분당구", "판교") or JobKorea area
                          codes ("I000", "B150"). Applied by the site.
  --jobage <days>         Keep postings registered within N days. The site
                          narrows by period first; the exact cut is client-side.
  --order <mode>          relevance (default) | recent (registration date).
  --page <n>              1-indexed page (40 results/page, max 500). Default 1.
  --limit, -n <n>         Cap results emitted (client-side).
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "유니티 클라이언트" -l "서울,경기" --jobage 14 --format table
  bun run src/cli.ts search -q "언리얼 클라이언트" --order recent --format table
  bun run src/cli.ts search -q "게임 클라이언트" -l 판교 --limit 10 --format plain
  bun run src/cli.ts detail 50353055 --format plain

Personal use only — keep volume low.
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "location", "jobage", "order", "page", "limit", "format", "help", "h"]),
  detail: new Set(["format", "help", "h"]),
}

function fail(error: string, code: string): number {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
  return 1
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  // Reject unknown flags instead of silently discarding them: a discarded
  // filter changes what the search returns with no error.
  const knownFlags = KNOWN_FLAGS[cmd]
  if (knownFlags) {
    for (const key of Object.keys(flags)) {
      if (key === "_" || knownFlags.has(key)) continue
      return fail(
        `unknown flag --${key} for '${cmd}' - flags are never silently ignored, because a discarded filter changes what the search returns; see --help for the supported flags`,
        "UNKNOWN_FLAG",
      )
    }
  }

  if (cmd === "search") {
    if (flags.query !== undefined && (typeof flags.query !== "string" || !flags.query.trim())) {
      return fail("--query requires a non-empty value", "BAD_ARG")
    }
    // The site drops keywords longer than 30 characters and returns the
    // unfiltered list, so a long query would silently match everything.
    if (typeof flags.query === "string" && flags.query.trim().length > 30) {
      return fail("--query must be at most 30 characters (JobKorea ignores longer keywords)", "BAD_ARG")
    }
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table", "plain"].includes(fmt)) {
      return fail(`--format must be one of json|table|plain, got "${fmt}"`, "BAD_ARG")
    }
    const order = flags.order !== undefined ? String(flags.order) : "relevance"
    if (!["relevance", "recent"].includes(order)) {
      return fail(`--order must be one of relevance|recent, got "${order}"`, "BAD_ARG")
    }

    let locations: string[] = []
    if (flags.location !== undefined) {
      if (typeof flags.location !== "string" || !flags.location.trim()) {
        return fail("--location requires a value", "BAD_ARG")
      }
      const { codes, unknown } = resolveLocations(flags.location)
      if (unknown.length) {
        return fail(
          `unknown --location ${unknown.map((u) => `"${u}"`).join(", ")} - use a region name such as "서울", "경기", "서울 강남구", "성남시 분당구", or an area code such as "I000" (see url-reference.md)`,
          "BAD_ARG",
        )
      }
      locations = codes
    }

    const ints: Record<string, number | undefined> = {}
    for (const name of ["jobage", "page", "limit"]) {
      if (flags[name] === undefined) continue
      const raw = flags[name]
      const val = typeof raw === "string" ? Number(raw.trim()) : NaN
      if (!Number.isInteger(val) || val < 1) {
        return fail(`--${name} must be a whole number of at least 1, got "${raw}"`, "BAD_ARG")
      }
      ints[name] = val
    }
    if (ints.page !== undefined && ints.page > 500) {
      return fail("--page must be at most 500 (the site's own limit)", "BAD_ARG")
    }

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query.trim() : undefined,
      locations,
      jobage: ints.jobage,
      order: order as SearchOpts["order"],
      page: ints.page ?? 1,
      limit: ints.limit,
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) return fail("detail requires an <id|url>", "NO_ID")
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "plain"].includes(fmt)) {
      return fail(`--format must be one of json|plain, got "${fmt}"`, "BAD_ARG")
    }
    const opts: DetailOpts = { id, format: fmt as DetailOpts["format"] }
    return runDetail(opts)
  }

  return fail(`Unknown command "${cmd}"`, "BAD_CMD")
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e), code: "INTERNAL_ERROR" }) + "\n",
    )
    process.exit(1)
  })
