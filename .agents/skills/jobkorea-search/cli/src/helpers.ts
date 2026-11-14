// Data source: JobKorea (jobkorea.co.kr) public pages. No authentication required.
// Search posts to the same JSON endpoint the site's own result page calls
// (/Search/api/display/v2/jobs) and maps the returned job objects.
// Detail reads the public posting page (JSON-LD + summary items) plus the
// description iframe it embeds. Parsing is plain JSON + regex - zero runtime
// dependencies.

import { AREAS } from "./areas.js"

export const BASE_URL = "https://www.jobkorea.co.kr"
export const SEARCH_API_URL = `${BASE_URL}/Search/api/display/v2/jobs`
export const DETAIL_URL = `${BASE_URL}/Recruit/GI_Read`
export const DESCRIPTION_IFRAME_URL = `${BASE_URL}/Recruit/GI_Read_Comt_Ifrm`
export const GAMEJOB_DETAIL_URL = "https://www.gamejob.co.kr/Recruit/GI_Read/View"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; jobkorea-cli/1.0)"

/**
 * Fetch with exponential backoff (plus jitter) on 429/5xx. Returns "" on a 404.
 * A `json` body is sent as a POST with Content-Type application/json.
 */
export async function httpFetch(url: string, json?: unknown): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      method: json !== undefined ? "POST" : "GET",
      headers: {
        "User-Agent": UA,
        Accept: json !== undefined ? "application/json" : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: json !== undefined ? JSON.stringify(json) : undefined,
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
  date: string | null // registration date, YYYY-MM-DD (KST)
  deadline: string | null // YYYY-MM-DD, or "상시" for open-ended postings
  career: string | null
  education: string | null
  employmentType: string | null
  salary: string | null
  field: string | null
  source: "jobkorea" | "gamejob" | "external"
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
  field: string | null
  headcount: string | null
  career: string | null
  employmentType: string | null
  education: string | null
  salary: string | null
  workHours: string | null
  skills: string | null
  preferred: string | null
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
// Dates (JobKorea timestamps carry +09:00; "today" is the KST calendar day)
// ---------------------------------------------------------------------------

/** The KST calendar date (YYYY-MM-DD) of `now`. */
export function kstToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10)
}

/** YYYY-MM-DD minus `days` calendar days. */
export function minusDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10)
}

/** The KST calendar date of an ISO timestamp such as "2026-11-12T13:22:16.483+09:00". */
export function kstDate(timestamp: string | null | undefined): string | null {
  if (!timestamp) return null
  const ms = Date.parse(timestamp)
  if (Number.isNaN(ms)) return null
  return kstToday(new Date(ms))
}

/** Deadline from applicationPeriod.end: far-future placeholders (2070-01-01) mean open-ended. */
export function deadlineFromEnd(end: string | null | undefined): string | null {
  const d = kstDate(end)
  if (!d) return null
  return Number(d.slice(0, 4)) >= 2060 ? "상시" : d
}

/** Detail-page deadline label: "2027.01.11" -> ISO date; "상시채용" / "채용시마감" kept as labels. */
export function parseDeadlineLabel(label: string | null | undefined): string | null {
  const t = (label ?? "").trim()
  if (!t) return null
  const m = t.match(/(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`
  return t
}

// ---------------------------------------------------------------------------
// Code tables (mirroring the labels the site's own result cards render)
// ---------------------------------------------------------------------------

const AREA_NAME = new Map<string, string>(AREAS)

export function areaName(code: string): string {
  return AREA_NAME.get(code) ?? code
}

const norm = (s: string): string => s.replace(/[\s>·]/g, "").toLowerCase()

// Common names that are not region names in the table itself.
const AREA_ALIASES: Record<string, string> = {
  판교: "B150", // 판교 sits in 성남시 분당구
  서울특별시: "I000",
  경기도: "B000",
  인천광역시: "K000",
}

/** Lookup from normalized names ("서울", "서울강남구", "강남구" when unique) to area codes. */
const AREA_LOOKUP: Map<string, string> = (() => {
  const map = new Map<string, string>()
  const leafCount = new Map<string, number>()
  for (const [code, name] of AREAS) {
    if (code.endsWith("_")) continue
    const leaf = name.split(" ").slice(1).join(" ")
    if (leaf) leafCount.set(norm(leaf), (leafCount.get(norm(leaf)) ?? 0) + 1)
  }
  for (const [code, name] of AREAS) {
    if (code.endsWith("_")) continue
    map.set(norm(name), code)
    const leaf = name.split(" ").slice(1).join(" ")
    if (leaf && leafCount.get(norm(leaf)) === 1 && !map.has(norm(leaf))) map.set(norm(leaf), code)
  }
  for (const [alias, code] of Object.entries(AREA_ALIASES)) map.set(norm(alias), code)
  return map
})()

/**
 * Resolve a --location value (comma-separated names or raw area codes) to area codes.
 * Returns the unresolved entries separately so the caller can reject them.
 */
export function resolveLocations(input: string): { codes: string[]; unknown: string[] } {
  const codes: string[] = []
  const unknown: string[] = []
  for (const raw of input.split(",").map((s) => s.trim()).filter(Boolean)) {
    const upper = raw.toUpperCase()
    const code = AREA_NAME.has(upper) ? upper : AREA_LOOKUP.get(norm(raw))
    if (code) {
      if (!codes.includes(code)) codes.push(code)
    } else {
      unknown.push(raw)
    }
  }
  return { codes, unknown }
}

const EMPLOYMENT: Record<string, string> = {
  "1": "정규직",
  "2": "계약직",
  "3": "인턴",
  "4": "파견직",
  "5": "도급",
  "6": "프리랜서",
  "7": "아르바이트",
  "8": "연수생/교육생",
  "9": "병역특례",
  "10": "위촉직/개인사업자",
}

const EDUCATION: Record<string, string> = {
  "0": "학력무관",
  "3": "고졸↑",
  "4": "초대졸↑",
  "5": "대졸↑",
  "6": "석사↑",
  "7": "박사↑",
}

const PAY_TYPE: Record<string, string> = { "1": "연봉", "2": "월급", "3": "주급", "4": "일급", "5": "시급", "6": "건별" }

export function careerLabel(type: unknown, range: unknown): string | null {
  const years = typeof range === "number" && range > 0 && range !== 100 ? `${range}년↑` : ""
  switch (String(type ?? "")) {
    case "1":
      return "신입"
    case "2":
      return `경력${years}`
    case "3":
      return `신입·경력${years}`
    case "4":
      return "경력무관"
    default:
      return null
  }
}

function employmentLabel(list: unknown): string | null {
  if (!Array.isArray(list)) return null
  const names = list
    .map((v) => EMPLOYMENT[String(v).split("/")[0]])
    .filter((v): v is string => Boolean(v))
  return names.length ? [...new Set(names)].join(", ") : null
}

/** "연봉 2,600~3,000만원" for annual/monthly pay (the site's 만원 unit); bare numbers otherwise; null when unset. */
function salaryLabel(payType: unknown, range: unknown): string | null {
  if (!range || typeof range !== "object") return null
  const start = Number((range as { start?: unknown }).start)
  const end = Number((range as { end?: unknown }).end)
  if (!Number.isFinite(start) || !Number.isFinite(end) || (start === 0 && end === 0)) return null
  const type = PAY_TYPE[String(payType ?? "")] ?? "급여"
  const fmt = (n: number) => n.toLocaleString("en-US")
  const span = start && end && start !== end ? `${fmt(start)}~${fmt(end)}` : fmt(start || end)
  return type === "연봉" || type === "월급" ? `${type} ${span}만원` : `${type} ${span}`
}

// ---------------------------------------------------------------------------
// Search parsing
// ---------------------------------------------------------------------------

export function jobUrl(id: string): string {
  return `${DETAIL_URL}/${id}`
}

/** Posting URL per userRefType, mirroring the site's own card link builder. */
function cardUrl(id: string, refType: string): { url: string; source: JobCard["source"] } {
  if (refType === "G") return { url: `${GAMEJOB_DETAIL_URL}?GI_No=${id}`, source: "gamejob" }
  if (refType === "WN") return { url: `${DETAIL_URL}/${id}/Ext`, source: "external" }
  return { url: jobUrl(id), source: "jobkorea" }
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null)

/**
 * Map the search API's `content` array to result cards. Each job object is
 * mapped independently inside a try block, so one malformed entry cannot
 * break the rest. Text fields go through `clean` because titles occasionally
 * carry entities or stray markup.
 */
export function parseJobList(payload: unknown): { cards: JobCard[]; total: number | null } {
  const data = payload as { content?: unknown; totalElements?: unknown } | null
  const content = Array.isArray(data?.content) ? data.content : []
  const cards: JobCard[] = []
  const seen = new Set<string>()
  for (const raw of content) {
    try {
      const j = raw as Record<string, unknown>
      const id = String(j.id ?? "").trim()
      if (!/^\d+$/.test(id) || seen.has(id)) continue
      const title = clean(String(j.title ?? ""))
      if (!title) continue
      const areas = Array.isArray(j.areaCodeList) ? j.areaCodeList.map((c) => areaName(String(c))) : []
      const period = j.applicationPeriod as { end?: string } | undefined
      const fieldRaw = str(j.jobClassificationOrIndustry)
      const { url, source } = cardUrl(id, String(j.userRefType ?? "C"))
      seen.add(id)
      cards.push({
        id,
        title,
        company: clean(String(j.postingCompanyName ?? j.companyName ?? "")) || null,
        location: areas.length ? areas.join(", ") : null,
        date: kstDate(str(j.createdAt)),
        deadline: deadlineFromEnd(period?.end),
        career: careerLabel(j.careerType, j.careerRange),
        education: EDUCATION[String(j.educationCode ?? "")] ?? null,
        employmentType: employmentLabel(j.employmentTypeCodeList),
        salary: salaryLabel(j.payTypeCode, j.payRange),
        field: fieldRaw ? clean(fieldRaw.split(",").filter(Boolean).join(", ")) || null : null,
        source,
        url,
      })
    } catch {
      continue
    }
  }
  const total = typeof data?.totalElements === "number" ? data.totalElements : null
  return { cards, total }
}

// ---------------------------------------------------------------------------
// Detail parsing
// ---------------------------------------------------------------------------

/**
 * Outer HTML of every element whose opening tag matches `openTag`, found by
 * counting nested tags of the same name - so a summary item's value is read
 * from inside its own element and never runs into the next section.
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

/** Summary label -> value from the RecruitmentField / RecruitmentItem / QualificationItem blocks. */
export function summaryItems(html: string): Record<string, string> {
  const out: Record<string, string> = {}
  const blocks = elementsMatching(
    html,
    /<div\b[^>]*data-sentry-component="(?:RecruitmentField|RecruitmentItem|QualificationItem)"[^>]*>/i,
  )
  for (const block of blocks) {
    const label = block.match(/<span\b[^>]*>([\s\S]*?)<\/span>/i)
    if (!label) continue
    const key = clean(label[1])
    if (!key || key in out) continue
    const rest = block.slice((label.index ?? 0) + label[0].length)
    const value = clean(rest.replace(/<button\b[\s\S]*?<\/button>/gi, " "))
      .replace(/^[,\s]+/, "")
      .trim()
    if (value) out[key] = value
  }
  return out
}

interface JsonLdPosting {
  title?: string
  datePosted?: string
  validThrough?: string
  hiringOrganization?: { name?: string }
  jobLocation?: { address?: { streetAddress?: string } } | { address?: { streetAddress?: string } }[]
}

function jsonLdPosting(html: string): JsonLdPosting | null {
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1])
      const list = Array.isArray(data) ? data : [data]
      const posting = list.find((d) => d && d["@type"] === "JobPosting")
      if (posting) return posting as JsonLdPosting
    } catch {
      continue
    }
  }
  return null
}

/** The "마감일 : X" entry of the page's meta description. */
function metaDeadline(html: string): string | null {
  const meta = html.match(/<meta name="description" content="([^"]*)"/i)
  if (!meta) return null
  const m = decodeHtmlEntities(meta[1]).match(/마감일\s*:\s*([^,]+)/)
  return m ? m[1].trim() : null
}

/**
 * Region of a street address as the search results name it: province + city/district
 * ("서울 강남구", "경기 부천시"), plus the 구 for cities divided into districts
 * ("경기 성남시 분당구").
 */
export function regionOf(address: string): string | null {
  const words = address.trim().split(/\s+/)
  if (words.length < 2) return words[0] || null
  const n = words[1].endsWith("시") && words[2]?.endsWith("구") ? 3 : 2
  return words.slice(0, n).join(" ")
}

export function parseJobDetail(
  html: string,
  id: string,
  today: string = kstToday(),
): Omit<JobDetail, "description" | "descriptionImages"> {
  const ld = jsonLdPosting(html)
  const items = summaryItems(html)

  const ogTitle = html.match(/<meta property="og:title" content="([^"]*)"/i)
  const title =
    (ld?.title ? clean(ld.title) : "") ||
    (ogTitle ? clean(ogTitle[1]).replace(/\s*\|\s*잡코리아\s*$/, "").replace(/^.*?채용\s*-\s*/, "") : "") ||
    "(untitled)"
  const writer = html.match(/<meta name="writer" content="([^"]*)"/i)
  const company = (ld?.hiringOrganization?.name ? clean(ld.hiringOrganization.name) : "") || (writer ? clean(writer[1]) : "") || null

  const loc = Array.isArray(ld?.jobLocation) ? ld?.jobLocation[0] : ld?.jobLocation
  const address = items["근무지주소"] || (loc?.address?.streetAddress ? clean(loc.address.streetAddress) : "") || null
  const location = address ? regionOf(address) : null

  const deadlineLabel = metaDeadline(html)
  let deadline = parseDeadlineLabel(deadlineLabel)
  if (!deadline && ld?.validThrough) deadline = ld.validThrough.slice(0, 10)
  const isActive = deadline && /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? deadline >= today : true

  return {
    id,
    title,
    company,
    location,
    address,
    date: ld?.datePosted ? ld.datePosted.slice(0, 10) : null,
    deadline,
    url: jobUrl(id),
    isActive,
    field: items["모집분야"] ?? null,
    headcount: items["모집인원"] ?? null,
    career: items["경력"] ?? null,
    employmentType: items["고용형태"] ?? null,
    education: items["학력"] ?? null,
    salary: items["급여"] ?? null,
    workHours: items["근무시간"] ?? null,
    skills: items["스킬"] ?? null,
    preferred: items["우대조건"] ?? null,
  }
}

/** Text of the description iframe's #detail-content element, plus how many images it carries. */
export function parseDescription(html: string): { text: string | null; images: number } {
  const visible = visibleHtml(html)
  const content = elementsMatching(visible, /<div\b[^>]*\bid="detail-content"[^>]*>/i)[0]
  if (!content) return { text: null, images: 0 }
  const images = (content.match(/<img\b/gi) ?? []).length
  const text = htmlToText(content)
  return { text: text || null, images }
}
