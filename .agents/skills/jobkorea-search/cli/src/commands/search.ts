import {
  SEARCH_API_URL,
  httpFetch,
  kstToday,
  minusDays,
  parseJobList,
  stripInvisible,
  writeError,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  locations: string[] // area codes, already resolved
  jobage?: number
  order: "relevance" | "recent"
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

export const PAGE_SIZE = 40

/**
 * Server-side registration window for --jobage: the smallest site period
 * (최근3일 / 최근1주일 / 최근1개월) strictly wider than the requested age, so
 * the exact client-side cut that follows never loses a posting the site
 * dropped first. Ages of 30+ days send no period.
 */
export function periodCode(days: number | undefined): string {
  if (days === undefined) return ""
  if (days < 3) return "3"
  if (days < 7) return "4"
  if (days < 30) return "5"
  return ""
}

/** JSON body for the jobs API, mirroring what the site's result page sends. */
export function buildBody(opts: SearchOpts): Record<string, unknown> {
  return {
    pageSize: PAGE_SIZE,
    page: opts.page - 1,
    sortProperty: opts.order === "recent" ? "2" : "1",
    sortDirection: "DESC",
    keyword: opts.query ?? "",
    locationList: opts.locations,
    period: periodCode(opts.jobage),
    deviceType: "PC",
  }
}

/** Keep postings registered within `days` KST calendar days; postings with no date are kept. */
export function filterByAge(cards: JobCard[], days: number, today: string = kstToday()): JobCard[] {
  const cutoff = minusDays(today, days)
  return cards.filter((c) => !c.date || c.date >= cutoff)
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 34).padEnd(34)
    const company = (c.company || "—").slice(0, 16).padEnd(16)
    const loc = (c.location || "—").slice(0, 14).padEnd(14)
    const date = (c.date || "—").padEnd(10)
    return `${c.id.padEnd(8)} ${title} ${company} ${loc} ${date} ${c.deadline || "—"}`
  })
  const header =
    "ID".padEnd(8) + " " + "TITLE".padEnd(34) + " " + "COMPANY".padEnd(16) + " " + "LOCATION".padEnd(14) + " " + "DATE".padEnd(10) + " DEADLINE"
  return [header, "-".repeat(header.length + 4), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const text = await httpFetch(SEARCH_API_URL, buildBody(opts))
    let payload: unknown
    try {
      payload = JSON.parse(text)
    } catch {
      writeError("Search endpoint did not return JSON - the site may have changed; see url-reference.md", "BAD_RESPONSE")
      return 1
    }
    const parsed = parseJobList(payload)
    let cards = stripInvisible(parsed.cards)
    if (opts.jobage !== undefined) cards = filterByAge(cards, opts.jobage)
    if (opts.limit !== undefined && opts.limit >= 0) cards = cards.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        cards
          .map(
            (c) =>
              `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.date || "—"} · 마감 ${c.deadline || "—"}\n  ${[c.career, c.employmentType, c.salary].filter(Boolean).join(" · ") || "—"}\n  id: ${c.id}\n  ${c.url}`,
          )
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify({ meta: { count: cards.length, page: opts.page, total: parsed.total }, results: cards }, null, 2) + "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
