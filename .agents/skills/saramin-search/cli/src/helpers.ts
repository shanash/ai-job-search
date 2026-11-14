// Data source: Saramin (saramin.co.kr) public pages. No authentication required.
// Search reads the server-rendered result page (/zf_user/search/recruit) and
// parses each `item_recruit` card independently. Detail reads the posting
// fragment the site's own posting page loads (/zf_user/jobs/relay/view-ajax)
// plus the description iframe (/zf_user/jobs/relay/view-detail). Parsing is
// plain regex - zero runtime dependencies.

import { AREAS, type AreaParam } from "./areas.js"

export const BASE_URL = "https://www.saramin.co.kr"
export const SEARCH_URL = `${BASE_URL}/zf_user/search/recruit`
export const VIEW_URL = `${BASE_URL}/zf_user/jobs/relay/view`
export const VIEW_AJAX_URL = `${BASE_URL}/zf_user/jobs/relay/view-ajax`
export const VIEW_DETAIL_URL = `${BASE_URL}/zf_user/jobs/relay/view-detail`

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; saramin-cli/1.0)"

export interface FetchOpts {
  /** Form fields, sent as a POST with application/x-www-form-urlencoded. */
  form?: Record<string, string>
  /** Referer header; the posting fragment endpoint answers 404 without its posting page as referer. */
  referer?: string
}

/** Fetch with exponential backoff (plus jitter) on 429/5xx. Returns "" on a 404. */
export async function httpFetch(url: string, opts: FetchOpts = {}): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      method: opts.form ? "POST" : "GET",
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
        ...(opts.form ? { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" } : {}),
        ...(opts.referer ? { Referer: opts.referer } : {}),
      },
      body: opts.form ? new URLSearchParams(opts.form).toString() : undefined,
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, delay + jitter))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return ""
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return response.text()
  }
  throw new Error("Request failed after max retries")
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null // YYYY-MM-DD: the date the card shows (registration or last edit, see dateType)
  dateType: "registered" | "modified" | null
  deadline: string | null // YYYY-MM-DD, or "상시" / "채용시" for open-ended postings
  career: string | null
  education: string | null
  employmentType: string | null
  salary: string | null
  keywords: string | null
  url: string
}

export interface JobDetail {
  id: string
  title: string
  company: string | null
  location: string | null
  address: string | null
  date: string | null
  deadline: string | null
  url: string
  isActive: boolean
  career: string | null
  education: string | null
  employmentType: string | null
  salary: string | null
  workHours: string | null
  position: string | null
  preferred: string | null
  keywords: string | null
  description: string | null
  descriptionImages: number
}

// ---------------------------------------------------------------------------
// Text hygiene (copied from linkedin-search: listing text is third-party data)
// ---------------------------------------------------------------------------

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&nbsp;/g, " ")
}

/**
 * Characters a reader of the posting never sees but a model reading this
 * output does: C0/C1 controls other than tab, newline and carriage return, the
 * soft hyphen, bidi marks/embeddings/overrides/isolates, zero-width characters
 * and invisible operators, the BOM, variation selectors, and Unicode tag
 * characters (U+E0000-E007F).
 */
const INVISIBLE_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F­؜᠎​-‏‪-‮⁠-⁯︀-️﻿\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu

/** Strip INVISIBLE_CHARS from every string in a result, recursively: the CLI's output boundary. */
export function stripInvisible<T>(value: T): T {
  if (typeof value === "string") return value.replace(INVISIBLE_CHARS, "") as T
  if (Array.isArray(value)) return value.map(stripInvisible) as T
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripInvisible(v)])) as T
  }
  return value
}

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"])

/** Whether an opening tag's attributes keep it from rendering: `hidden`, or an inline style that hides it. */
function isHiddenTag(attrs: string): boolean {
  for (const m of attrs.matchAll(/([^\s"'=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    const name = m[1].toLowerCase()
    const value = m[2] ?? m[3] ?? m[4] ?? ""
    if (name === "hidden") return true
    if (name === "style" && /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all)\b/i.test(value)) {
      return true
    }
  }
  return false
}

/**
 * Drop markup a browser never renders - comments, <script>/<style>/<template>
 * blocks, and elements marked hidden - before tags are stripped.
 */
export function visibleHtml(html: string): string {
  const src = html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, "")
  const open = /<([a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*)?>/g
  const kept: string[] = []
  let from = 0
  let m: RegExpExecArray | null
  while ((m = open.exec(src)) !== null) {
    if (!m[2] || !isHiddenTag(m[2])) continue
    const tag = m[1].toLowerCase()
    let end = open.lastIndex
    if (!VOID_TAGS.has(tag) && !m[0].endsWith("/>")) {
      const same = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi")
      same.lastIndex = end
      end = src.length
      let depth = 1
      let s: RegExpExecArray | null
      while ((s = same.exec(src)) !== null) {
        if (s[1]) depth--
        else if (!s[0].endsWith("/>")) depth++
        if (depth === 0) {
          end = same.lastIndex
          break
        }
      }
    }
    kept.push(src.slice(from, m.index))
    from = end
    open.lastIndex = end
  }
  kept.push(src.slice(from))
  return kept.join("")
}

export function clean(html: string): string {
  return decodeHtmlEntities(visibleHtml(html).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
}

/** Render an HTML fragment as text, keeping paragraph and line breaks. */
export function htmlToText(html: string): string {
  const withBreaks = visibleHtml(html)
    .replace(/\s+/g, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d|tr|table)>/gi, "\n")
  return withBreaks
    .split("\n")
    .map(clean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}


// ---------------------------------------------------------------------------
// Dates ("today" is the KST calendar day; the site shows KST dates)
// ---------------------------------------------------------------------------

/** The KST calendar date (YYYY-MM-DD) of `now`. */
export function kstToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10)
}

/** YYYY-MM-DD plus `days` calendar days (negative to go back). */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** A card's "등록일 26/11/13" / "수정일 26/11/13" line -> ISO date and which date it is. */
export function parseCardDate(text: string | null | undefined): { date: string | null; dateType: JobCard["dateType"] } {
  const m = (text ?? "").match(/(등록일|수정일)\s*(\d{2})\/(\d{1,2})\/(\d{1,2})/)
  if (!m) return { date: null, dateType: null }
  return {
    date: `20${m[2]}-${m[3].padStart(2, "0")}-${m[4].padStart(2, "0")}`,
    dateType: m[1] === "등록일" ? "registered" : "modified",
  }
}

/**
 * A card's deadline label -> ISO date or open-ended label. Cards show no year
 * ("~ 12/13(일)"), so the year is the one that puts the date nearest after
 * today: a month/day more than ~6 months behind today belongs to next year.
 */
export function parseCardDeadline(label: string | null | undefined, today: string = kstToday()): string | null {
  const t = (label ?? "").replace(/\s+/g, " ").trim()
  if (!t) return null
  if (t.includes("오늘마감")) return today
  if (t.includes("내일마감")) return addDays(today, 1)
  if (t.includes("상시")) return "상시"
  if (t.includes("채용시")) return "채용시"
  const m = t.match(/(\d{1,2})\/(\d{1,2})/)
  if (!m) return t
  const year = Number(today.slice(0, 4))
  const md = `${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`
  const candidate = `${year}-${md}`
  return candidate < addDays(today, -180) ? `${year + 1}-${md}` : candidate
}

/** A detail-page date ("2026.12.13 23:59") -> ISO date; open-ended labels normalized like the cards. */
export function parseDetailDate(label: string | null | undefined): string | null {
  const t = (label ?? "").replace(/\s+/g, " ").trim()
  if (!t) return null
  const m = t.match(/(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`
  if (t.includes("상시")) return "상시"
  if (t.includes("채용시")) return "채용시"
  return t
}

// ---------------------------------------------------------------------------
// Area codes
// ---------------------------------------------------------------------------

const AREA_NAME = new Map<string, string>(AREAS.map(([code, name]) => [code, name]))
const AREA_PARAM = new Map<string, AreaParam>(AREAS.map(([code, , param]) => [code, param]))

const norm = (s: string): string => s.replace(/[\s>·]/g, "").toLowerCase()

// Common names that are not region names in the table itself.
const AREA_ALIASES: Record<string, string> = {
  판교: "102190", // 판교 sits in 성남시 분당구
  서울특별시: "101000",
  경기도: "102000",
  인천광역시: "108000",
}

/**
 * Lookup from normalized names to area codes: the full name ("서울 강남구"),
 * and - when unique across the table - the name without its province
 * ("성남시 분당구", "강남구") and its last word ("분당구").
 */
const AREA_LOOKUP: Map<string, string> = (() => {
  const map = new Map<string, string>()
  const partial = (name: string): string[] => {
    const words = name.split(" ")
    if (words.length < 2) return []
    const leaf = words.slice(1).join(" ")
    const last = words[words.length - 1]
    return leaf === last ? [leaf] : [leaf, last]
  }
  const counts = new Map<string, number>()
  for (const [, name] of AREAS) {
    for (const p of partial(name)) counts.set(norm(p), (counts.get(norm(p)) ?? 0) + 1)
  }
  for (const [code, name] of AREAS) map.set(norm(name), code)
  for (const [code, name] of AREAS) {
    for (const p of partial(name)) {
      if (counts.get(norm(p)) === 1 && !map.has(norm(p))) map.set(norm(p), code)
    }
  }
  for (const [alias, code] of Object.entries(AREA_ALIASES)) map.set(norm(alias), code)
  return map
})()

/**
 * Resolve a --location value (comma-separated names or raw area codes) to the
 * site's two location parameters: whole provinces go in loc_mcd, cities and
 * districts in loc_cd. Unresolved entries come back separately so the caller
 * can reject them.
 */
export function resolveLocations(input: string): { mcd: string[]; cd: string[]; unknown: string[] } {
  const mcd: string[] = []
  const cd: string[] = []
  const unknown: string[] = []
  for (const raw of input.split(",").map((s) => s.trim()).filter(Boolean)) {
    const code = AREA_NAME.has(raw) ? raw : AREA_LOOKUP.get(norm(raw))
    if (!code) {
      unknown.push(raw)
      continue
    }
    const list = AREA_PARAM.get(code) === "mcd" ? mcd : cd
    if (!list.includes(code)) list.push(code)
  }
  return { mcd, cd, unknown }
}

// ---------------------------------------------------------------------------
// Element helpers
// ---------------------------------------------------------------------------

/**
 * Outer HTML of every element whose opening tag matches `openTag`, found by
 * counting nested tags of the same name - so a field is read from inside its
 * own element and never runs into the next section.
 */
export function elementsMatching(html: string, openTag: RegExp): string[] {
  const out: string[] = []
  const re = new RegExp(openTag.source, openTag.flags.includes("g") ? openTag.flags : openTag.flags + "g")
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const tag = m[0].match(/^<([a-zA-Z][a-zA-Z0-9-]*)/)?.[1]?.toLowerCase()
    if (!tag) continue
    const same = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi")
    same.lastIndex = m.index + m[0].length
    let depth = 1
    let end = html.length
    let s: RegExpExecArray | null
    while ((s = same.exec(html)) !== null) {
      if (s[1]) depth--
      else if (!s[0].endsWith("/>")) depth++
      if (depth === 0) {
        end = same.lastIndex
        break
      }
    }
    out.push(html.slice(m.index, end))
    re.lastIndex = end
  }
  return out
}

/** `html` with every element matching `openTag` removed. */
function withoutElements(html: string, openTag: RegExp): string {
  let out = html
  for (const el of elementsMatching(html, openTag)) out = out.replace(el, " ")
  return out
}

const nonEmpty = (s: string): string | null => (s.trim() ? s.trim() : null)

/** Text of each `<a>` inside a fragment, cleaned, without a leading "#". */
function anchorTexts(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => clean(m[1]).replace(/^#/, "")).filter(Boolean)
}

// ---------------------------------------------------------------------------
// Search parsing
// ---------------------------------------------------------------------------

export function jobUrl(id: string): string {
  return `${VIEW_URL}?rec_idx=${id}`
}

/**
 * A card's location span -> readable region list. The span links each area
 * (`…/area-list/area/<code>`): a province ("경기" / "서울전체") followed by its
 * cities and districts. Codes are named from the area table, and a name that
 * a more specific one extends is dropped: "경기, 경기 성남시, 경기 성남시 분당구"
 * becomes "경기 성남시 분당구". Unknown codes (overseas) fall back to link text.
 */
export function locationFromSpan(span: string): string | null {
  const names: string[] = []
  for (const m of span.matchAll(/<a\b[^>]*href="[^"]*\/area\/(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const name = AREA_NAME.get(m[1]) ?? clean(m[2])
    if (name && !names.includes(name)) names.push(name)
  }
  const kept = names.filter((n) => !names.some((o) => o !== n && o.startsWith(n + " ")))
  return kept.length ? kept.join(", ") : null
}

/**
 * Sort the `job_condition` spans of a card into fields. The site renders them
 * in order (location, career, education, employment type, optional salary)
 * but omits empty ones, so each is recognized by its content rather than its
 * position.
 */
export function classifyConditions(spans: string[]): Pick<JobCard, "location" | "career" | "education" | "employmentType" | "salary"> {
  const out: Pick<JobCard, "location" | "career" | "education" | "employmentType" | "salary"> = {
    location: null,
    career: null,
    education: null,
    employmentType: null,
    salary: null,
  }
  for (const raw of spans) {
    const text = clean(raw)
    if (!text) continue
    if (!out.location && /area-recruit|area-list/.test(raw)) out.location = locationFromSpan(raw) ?? text
    else if (!out.career && /^(신입|경력)/.test(text)) out.career = text
    else if (!out.education && /(졸|학력무관)/.test(text)) out.education = text
    else if (!out.salary && /(만원|원)$/.test(text)) out.salary = text
    else if (!out.employmentType) out.employmentType = text
  }
  return out
}

/** Parse one `item_recruit` card; returns null when it lacks an id or a title. */
export function parseCard(card: string, today: string = kstToday()): JobCard | null {
  const id = card.match(/^<div\b[^>]*class="item_recruit"[^>]*\bvalue="(\d+)"/)?.[1]
  if (!id) return null
  const tit = card.match(/<h2 class="job_tit">[\s\S]*?<a\b([^>]*)>([\s\S]*?)<\/a>/)
  const titleAttr = tit?.[1].match(/\btitle="([^"]*)"/)?.[1] ?? ""
  const title = clean(tit?.[2] ?? "") || clean(titleAttr)
  if (!title) return null

  const corp = card.match(/<strong class="corp_name">([\s\S]*?)<\/strong>/)
  const condition = elementsMatching(card, /<div class="job_condition">/)[0] ?? ""
  const spans = [...condition.matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi)].map((m) => m[1])
  const sector = elementsMatching(card, /<div class="job_sector">/)[0] ?? ""
  const dateText = sector.match(/<span class="job_day">([\s\S]*?)<\/span>/)?.[1] ?? card.match(/<span class="job_day">([\s\S]*?)<\/span>/)?.[1]
  const keywords = anchorTexts(sector.replace(/<span class="job_day">[\s\S]*?<\/span>/g, ""))
  const deadline = card.match(/<span class="date">([\s\S]*?)<\/span>/)?.[1]

  return {
    id,
    title,
    company: nonEmpty(clean(corp?.[1] ?? "")),
    ...classifyConditions(spans),
    ...parseCardDate(clean(dateText ?? "")),
    deadline: parseCardDeadline(clean(deadline ?? ""), today),
    keywords: keywords.length ? keywords.join(", ") : null,
    url: jobUrl(id),
  }
}

/**
 * Parse a search result page into cards. The page is split at each card's
 * opening tag and every chunk is parsed independently inside a try block, so
 * one malformed card cannot break the rest.
 */
export function parseSearchPage(html: string, today: string = kstToday()): { cards: JobCard[]; total: number | null } {
  const cards: JobCard[] = []
  const seen = new Set<string>()
  for (const chunk of html.split(/(?=<div\b[^>]*class="item_recruit")/).slice(1)) {
    try {
      const card = elementsMatching(chunk, /^<div\b[^>]*class="item_recruit"[^>]*>/)[0] ?? chunk
      const parsed = parseCard(card, today)
      if (!parsed || seen.has(parsed.id)) continue
      seen.add(parsed.id)
      cards.push(parsed)
    } catch {
      continue
    }
  }
  const t = html.match(/class="cnt_result">\s*총\s*([\d,]+)\s*건/)
  return { cards, total: t ? Number(t[1].replace(/,/g, "")) : null }
}

// ---------------------------------------------------------------------------
// Detail parsing
// ---------------------------------------------------------------------------

/** Label -> value pairs from the fragment's 핵심 정보 (jv_summary) block, tooltips and buttons dropped. */
export function summaryItems(html: string): Record<string, string> {
  const out: Record<string, string> = {}
  const summary = elementsMatching(html, /<div class="jv_cont jv_summary"[^>]*>/)[0]
  if (!summary) return out
  for (const dl of elementsMatching(summary, /<dl\b[^>]*>/i)) {
    const dt = dl.match(/<dt\b[^>]*>([\s\S]*?)<\/dt>/i)
    const dd = elementsMatching(dl, /<dd\b[^>]*>/i)[0]
    if (!dt || !dd) continue
    const key = clean(dt[1])
    if (!key || key in out) continue
    const value = clean(
      withoutElements(withoutElements(dd, /<div\b[^>]*class="toolTipWrap[^"]*"[^>]*>/i), /<button\b[^>]*>/i),
    )
    if (value) out[key] = value
  }
  return out
}

/** 시작일 / 마감일 from the 접수기간 (info_period) block. */
export function periodItems(html: string): { start: string | null; end: string | null } {
  const period = html.match(/<dl class="info_period">([\s\S]*?)<\/dl>/)
  if (!period) return { start: null, end: null }
  const out: Record<string, string> = {}
  for (const m of period[1].matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)) {
    out[clean(m[1])] = clean(m[2])
  }
  return { start: out["시작일"] ?? null, end: out["마감일"] ?? null }
}

/** Whether a fragment response is a real posting (a missing one redirects to an error page). */
export function isPostingFragment(html: string): boolean {
  return /<h1 class="tit_job">/.test(html)
}

/**
 * The posting fragment -> detail fields. The fragment's 담당자 / 연락처
 * (recruiter name and phone) are deliberately not read: personal data the
 * CLI has no use for.
 */
export function parseJobDetail(
  html: string,
  id: string,
  today: string = kstToday(),
): Omit<JobDetail, "description" | "descriptionImages"> {
  const header = elementsMatching(html, /<div class="jv_header"[^>]*>/)[0] ?? html
  const title = clean(header.match(/<h1 class="tit_job">([\s\S]*?)<\/h1>/)?.[1] ?? "") || "(untitled)"
  const company = nonEmpty(clean(header.match(/<a\b[^>]*\bclass="company"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? ""))
  const items = summaryItems(html)
  const period = periodItems(html)
  const addressAttr = html.match(/class="jv_cont jv_location"[^>]*\bdata-address="([^"]*)"/)?.[1]
  const address = addressAttr ? nonEmpty(clean(addressAttr)) : null
  // Tags link to job categories (kept) and to the work region (dropped: already in location).
  const tags = elementsMatching(html, /<div class="tags">/)[0] ?? ""
  const keywords = [...tags.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
    .filter((m) => /href="[^"]*job-category/.test(m[1]))
    .map((m) => clean(m[2]).replace(/^#/, ""))
    .filter(Boolean)

  const deadline = parseDetailDate(period.end)
  const isActive = deadline && /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? deadline >= today : true

  return {
    id,
    title,
    company,
    location: items["근무지역"] ?? null,
    address,
    date: parseDetailDate(period.start),
    deadline,
    url: jobUrl(id),
    isActive,
    career: items["경력"] ?? null,
    education: items["학력"] ?? null,
    employmentType: items["근무형태"] ?? null,
    salary: items["급여"] ?? null,
    workHours: items["근무일시"] ?? null,
    position: items["직급/직책"] ?? null,
    preferred: items["우대사항"] ?? null,
    keywords: keywords.length ? keywords.join(", ") : null,
  }
}

/** Text of the description iframe's `user_content` element, plus how many real images it carries. */
export function parseDescription(html: string): { text: string | null; images: number } {
  const visible = visibleHtml(html)
  const content = elementsMatching(visible, /<div\b[^>]*\bclass="user_content"[^>]*>/i)[0]
  if (!content) return { text: null, images: 0 }
  const images = [...content.matchAll(/<img\b[^>]*>/gi)].filter((m) => !/\/blank\.png/i.test(m[0])).length
  const text = htmlToText(content)
  return { text: text || null, images }
}
