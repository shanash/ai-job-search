import {
  SEARCH_URL,
  addDays,
  httpFetch,
  kstToday,
  parseSearchPage,
  stripInvisible,
  writeError,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  locMcd: string[] // province codes (loc_mcd), already resolved
  locCd: string[] // city/district codes (loc_cd), already resolved
  jobage?: number
  order: "relevance" | "recent"
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

export const PAGE_SIZE = 40

/** Result-page URL, mirroring the parameters the site's own search form sends. */
export function buildSearchUrl(opts: SearchOpts): string {
  const params = new URLSearchParams({
    searchType: "search",
    searchword: opts.query ?? "",
    recruitPage: String(opts.page),
    recruitPageCount: String(PAGE_SIZE),
    recruitSort: opts.order === "recent" ? "reg_dt" : "relation",
  })
  if (opts.locMcd.length) params.set("loc_mcd", opts.locMcd.join(","))
  if (opts.locCd.length) params.set("loc_cd", opts.locCd.join(","))
  return `${SEARCH_URL}?${params.toString()}`
}

/**
 * Keep cards whose shown date falls within `days` KST calendar days; cards with
 * no date are kept. A card shows its registration date, or its last-edit date
 * once edited, so an older posting edited recently passes too.
 */
export function filterByAge(cards: JobCard[], days: number, today: string = kstToday()): JobCard[] {
  const cutoff = addDays(today, -days)
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
    const html = await httpFetch(buildSearchUrl(opts))
    if (!html || !/class="cnt_result"|class="item_recruit"|검색결과가 없습니다/.test(html)) {
      writeError("Search page did not have the expected result markup - the site may have changed; see url-reference.md", "BAD_RESPONSE")
      return 1
    }
    const parsed = parseSearchPage(html)
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
              `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.dateType === "modified" ? "수정" : "등록"} ${c.date || "—"} · 마감 ${c.deadline || "—"}\n  ${[c.career, c.education, c.employmentType, c.salary].filter(Boolean).join(" · ") || "—"}\n  id: ${c.id}\n  ${c.url}`,
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
