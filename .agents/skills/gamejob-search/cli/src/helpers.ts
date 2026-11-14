// Data source: GameJob (gamejob.co.kr) public pages. No authentication required.
// Search posts to the same list endpoint the site's own result page calls
// (/Recruit/_GI_Job_List/) and parses the returned HTML table of postings.
// Detail reads the public posting page plus its two description iframes.
// Parsing is plain regex over shallow, stable markup - zero runtime dependencies.

export const BASE_URL = "https://www.gamejob.co.kr"
export const SEARCH_URL = `${BASE_URL}/Recruit/_GI_Job_List/`
export const DETAIL_URL = `${BASE_URL}/Recruit/GI_Read/View`
export const WORK_IFRAME_URL = `${BASE_URL}/Recruit/GI_Read_Comt_Ifrm`
export const COMMENT_IFRAME_URL = `${BASE_URL}/Recruit/GI_Read_GI_Comment_Ifrm`

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; gamejob-cli/1.0)"

/** Fetch with exponential backoff (plus jitter) on 429/5xx. Returns "" on a 404. */
export async function htmlFetch(url: string, body?: URLSearchParams): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
        "X-Requested-With": "XMLHttpRequest",
        ...(body ? { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" } : {}),
      },
      body: body ? body.toString() : undefined,
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
  date: string | null // registration date, YYYY-MM-DD
  deadline: string | null // YYYY-MM-DD, or a label such as "채용시" / "상시"
  career: string | null
  education: string | null
  employmentType: string | null
  gameField: string | null
  url: string
}

export interface JobDetail {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  deadline: string | null
  url: string
  isActive: boolean
  field: string | null
  keywords: string | null
  career: string | null
  employmentType: string | null
  education: string | null
  position: string | null
  salary: string | null
  description: string | null
  qualifications: string | null
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
// Dates
// ---------------------------------------------------------------------------

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"]

function iso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/**
 * Resolve a year-less "MM/DD" (optionally with a Korean weekday such as "(화)")
 * to a full date. The weekday picks the year when one is given; otherwise the
 * closest year to `today` in the requested direction wins.
 */
export function resolveMonthDay(
  month: number,
  day: number,
  weekday: string | null,
  today: Date,
  direction: "past" | "future",
): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const base = today.getFullYear()
  const years = direction === "past" ? [base, base - 1, base - 2, base + 1] : [base, base + 1, base - 1]
  const wanted = weekday ? WEEKDAYS.indexOf(weekday) : -1
  if (wanted >= 0) {
    for (const y of years) {
      const d = new Date(y, month - 1, day)
      if (d.getMonth() === month - 1 && d.getDay() === wanted) return iso(d)
    }
  }
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  for (const y of years) {
    const d = new Date(y, month - 1, day)
    if (d.getMonth() !== month - 1) continue
    if (direction === "past" ? d <= midnight : d >= midnight) return iso(d)
  }
  return null
}

/** Parse a list row's registration label: "13시간 전 등록", "3일 전 등록", "11/05(목) 등록". */
export function parseRegistered(label: string, today: Date = new Date()): string | null {
  const t = label.trim()
  const rel = t.match(/(\d+)\s*(분|시간|일)\s*전/)
  if (rel) {
    const n = parseInt(rel[1], 10)
    const ms = rel[2] === "분" ? n * 60_000 : rel[2] === "시간" ? n * 3_600_000 : n * 86_400_000
    return iso(new Date(today.getTime() - ms))
  }
  if (/오늘/.test(t)) return iso(today)
  if (/어제/.test(t)) return iso(new Date(today.getTime() - 86_400_000))
  const full = t.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/)
  if (full) return iso(new Date(+full[1], +full[2] - 1, +full[3]))
  const md = t.match(/(\d{1,2})\/(\d{1,2})(?:\s*\(([일월화수목금토])\))?/)
  if (md) return resolveMonthDay(+md[1], +md[2], md[3] ?? null, today, "past")
  return null
}

/** Parse a list row's deadline label: "~12/12" -> date; "채용시" / "상시" kept as labels. */
export function parseDeadline(label: string, today: Date = new Date()): string | null {
  const t = label.trim()
  if (!t) return null
  const full = t.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/)
  if (full) return iso(new Date(+full[1], +full[2] - 1, +full[3]))
  const md = t.match(/(\d{1,2})\/(\d{1,2})(?:\s*\(([일월화수목금토])\))?/)
  if (md) return resolveMonthDay(+md[1], +md[2], md[3] ?? null, today, "future")
  return t
}

// ---------------------------------------------------------------------------
// Search parsing
// ---------------------------------------------------------------------------

export function jobUrl(id: string): string {
  return `${DETAIL_URL}?GI_No=${id}`
}

/**
 * Parse the list endpoint's HTML. Each posting is one <tr>; we split on <tr
 * and parse each chunk independently so one malformed row cannot break the
 * rest. Rows without a GI_No link (headers, banners) are skipped.
 */
export function parseJobCards(html: string, today: Date = new Date()): JobCard[] {
  const results: JobCard[] = []
  const seen = new Set<string>()
  for (const chunk of html.split(/<tr[\s>]/i).slice(1)) {
    const link = chunk.match(/<div class="tit">[\s\S]*?href="\/Recruit\/GI_Read\/View\?GI_No=(\d+)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!link) continue
    const id = link[1]
    if (seen.has(id)) continue
    const title = clean(link[2])
    if (!title) continue

    const companyBlock = chunk.match(/<div class="company[^"]*">([\s\S]*?)<\/div>/i)
    const companyStrong = companyBlock?.[1].match(/<strong>([\s\S]*?)<\/strong>/i)
    const company = companyStrong ? clean(companyStrong[1]) || null : companyBlock ? clean(companyBlock[1]) || null : null

    // <p class="info"> holds career, education, location, game field, employment type in order.
    const info = chunk.match(/<p class="info">([\s\S]*?)<\/p>/i)
    const spans = info ? [...info[1].matchAll(/<span[^>]*>([\s\S]*?)<\/span>/gi)].map((m) => clean(m[1])) : []
    const pick = (re: RegExp): string | null => spans.find((s) => re.test(s)) ?? null
    const location = pick(/>|서울|경기|인천|부산|대구|대전|광주|울산|세종|강원|충[북남]|전[북남]|경[북남]|제주|해외|재택/)
    const career = pick(/경력|신입/)
    const education = pick(/학력|졸|대학/)
    const employmentType = pick(/정규직|계약직|인턴|프리랜서|아르바이트|병역특례|파견|위촉/)
    const gameField = spans.find((s) => s !== location && s !== career && s !== education && s !== employmentType) ?? null

    const reg = chunk.match(/class="modifyDate"[^>]*>([\s\S]*?)<\/span>/i)
    const dead = chunk.match(/class="date"[^>]*>([\s\S]*?)<\/span>/i)

    seen.add(id)
    results.push({
      id,
      title,
      company,
      location,
      date: reg ? parseRegistered(clean(reg[1]), today) : null,
      deadline: dead ? parseDeadline(clean(dead[1]).replace(/^~\s*/, "~"), today) : null,
      career,
      education,
      employmentType,
      gameField,
      url: jobUrl(id),
    })
  }
  return results
}

/** Total hit count from the "전체 (N)" tab, or null. */
export function parseTotalCount(html: string): number | null {
  const m = html.match(/class="count totalJobcnt"[^>]*>\((\d[\d,]*)\)/i)
  return m ? parseInt(m[1].replace(/,/g, ""), 10) : null
}

// ---------------------------------------------------------------------------
// Detail parsing
// ---------------------------------------------------------------------------

/** dt/dd pairs from the summary boxes: label -> text. */
function dataItems(html: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /<dt class="recruit-data-title">([\s\S]*?)<\/dt>\s*<dd class="recruit-data-text">([\s\S]*?)<\/dd>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const key = clean(m[1])
    if (key && !(key in out)) out[key] = clean(m[2])
  }
  return out
}

export function parseJobDetail(html: string, id: string, today: Date = new Date()): Omit<JobDetail, "description" | "qualifications" | "descriptionImages"> {
  const items = dataItems(html)
  const header = html.match(/class="view__header-title"([\s\S]*?)<\/section>/i)?.[1] ?? html
  const h1 = [...header.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => clean(m[1])).find((t) => t.length > 0)
  const ogTitle = html.match(/<meta property="og:title" content="([^"]*)"/i)
  const title = h1 || (ogTitle ? clean(ogTitle[1]) : "") || "(untitled)"

  const corp = html.match(/<div class="corp-name">\s*<a[^>]*>([\s\S]*?)<\/a>/i)
  const company = corp ? clean(corp[1]) || null : null

  // Location appears only in the og:description sentence ("근무 예정지는 X 입니다.").
  const ogDesc = html.match(/<meta property="og:description" content="([^"]*)"/i)
  const locMatch = ogDesc ? decodeHtmlEntities(ogDesc[1]).match(/근무\s*예정지는\s*(.+?)\s*입니다/) : null
  const location = locMatch ? locMatch[1].trim() || null : null

  const start = html.match(/<dt>\s*시작일\s*<\/dt>\s*<dd>([\s\S]*?)<\/dd>/i)
  const date = start ? parseRegistered(clean(start[1]), today) : null

  const deadlineRaw = items["마감일"] ?? null
  const deadline = deadlineRaw ? parseDeadline(deadlineRaw, today) : null

  const stat = html.match(/id="GI_Read_Stat"\s+value="([^"]*)"/i)
  const isActive = stat ? /^open$/i.test(stat[1]) : !/마감된\s*공고|채용이\s*마감/.test(html)

  return {
    id,
    title,
    company,
    location,
    date,
    deadline,
    url: jobUrl(id),
    isActive,
    field: items["모집분야"] ?? null,
    keywords: items["키워드"] ?? null,
    career: items["경력"] ?? null,
    employmentType: items["고용형태"] ?? null,
    education: items["학력"] ?? null,
    position: items["직급/직책"] ?? null,
    salary: items["급여"] ? items["급여"].replace(/\s*연봉검색\s*$/, "") || null : null,
  }
}

/** Text of a description iframe body, plus how many images it carries. */
export function parseIframeBody(html: string): { text: string | null; images: number } {
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html
  const images = (visibleHtml(body).match(/<img\b/gi) ?? []).length
  const text = htmlToText(body)
  return { text: text || null, images }
}
