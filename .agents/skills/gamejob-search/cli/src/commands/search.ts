import {
  SEARCH_URL,
  htmlFetch,
  parseJobCards,
  parseTotalCount,
  stripInvisible,
  writeError,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  jobage?: number
  order: "recommended" | "recent"
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

const PAGE_SIZE = 40

/**
 * Form body for the list endpoint, mirroring what the site's own result page
 * sends from Joblist.js (_getGIList). `condition[searchtype]=all` is what makes
 * the keyword filter apply; other values silently return the unfiltered list.
 */
export function buildBody(opts: SearchOpts): URLSearchParams {
  const body = new URLSearchParams()
  if (opts.query) {
    body.set("condition[searchtype]", "all")
    body.set("condition[searchstring]", opts.query)
  }
  body.set("page", String(opts.page))
  body.set("pagesize", String(PAGE_SIZE))
  body.set("order", opts.order === "recent" ? "3" : "1")
  body.set("tabcode", "1")
  body.set("direct", "0")
  return body
}

/** Keep postings registered within `days` days; postings with no parsable date are kept. */
export function filterByAge(cards: JobCard[], days: number, today: Date = new Date()): JobCard[] {
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - days)
  return cards.filter((c) => {
    if (!c.date) return true
    const [y, m, d] = c.date.split("-").map(Number)
    return new Date(y, m - 1, d) >= cutoff
  })
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 34).padEnd(34)
    const company = (c.company || "—").slice(0, 16).padEnd(16)
    const loc = (c.location || "—").slice(0, 14).padEnd(14)
    const date = (c.date || "—").padEnd(10)
    return `${c.id.padEnd(7)} ${title} ${company} ${loc} ${date} ${c.deadline || "—"}`
  })
  const header =
    "ID".padEnd(7) + " " + "TITLE".padEnd(34) + " " + "COMPANY".padEnd(16) + " " + "LOCATION".padEnd(14) + " " + "DATE".padEnd(10) + " DEADLINE"
  return [header, "-".repeat(header.length + 4), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const html = await htmlFetch(SEARCH_URL, buildBody(opts))
    let cards = stripInvisible(parseJobCards(html))
    const total = parseTotalCount(html)
    if (opts.jobage !== undefined) cards = filterByAge(cards, opts.jobage)
    if (opts.limit !== undefined && opts.limit >= 0) cards = cards.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        cards
          .map(
            (c) =>
              `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.date || "—"} · 마감 ${c.deadline || "—"}\n  ${[c.career, c.employmentType].filter(Boolean).join(" · ") || "—"}\n  id: ${c.id}\n  ${c.url}`,
          )
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify({ meta: { count: cards.length, page: opts.page, total }, results: cards }, null, 2) + "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
