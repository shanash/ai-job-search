import {
  DESCRIPTION_IFRAME_URL,
  DETAIL_URL,
  httpFetch,
  parseDescription,
  parseJobDetail,
  stripInvisible,
  writeError,
  type JobDetail,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

const JOBKOREA_HOST = /(^|\.)jobkorea\.co\.kr$/i
const GAMEJOB_HOST = /(^|\.)gamejob\.co\.kr$/i

/**
 * Accept a raw posting id (digits) or a jobkorea.co.kr posting URL
 * (/Recruit/GI_Read/<id>). A URL on any other host is rejected, read through
 * real URL parsing so look-alike hosts (jobkorea.co.kr.evil.io) and userinfo
 * tricks fail too. GameJob URLs get their own error pointing at gamejob-search.
 */
export function normalizeId(input: string): { id: string } | { error: string; code: string } {
  const trimmed = input.trim()
  if (/^\d{5,}$/.test(trimmed)) return { id: trimmed }
  const hasScheme = /^https?:\/\//i.test(trimmed)
  if (hasScheme || /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) {
    let parsed: URL
    try {
      parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)
    } catch {
      return { error: `Could not parse "${input}" as a URL`, code: "BAD_ID" }
    }
    if (GAMEJOB_HOST.test(parsed.hostname)) {
      return { error: "This is a GameJob posting - read it with the gamejob-search skill", code: "WRONG_PORTAL" }
    }
    if (!JOBKOREA_HOST.test(parsed.hostname)) {
      return { error: `Not a JobKorea URL: "${input}"`, code: "BAD_ID" }
    }
    const m = parsed.pathname.match(/\/Recruit\/GI_Read\/(\d{5,})(?:\/|$)/i)
    if (m) return { id: m[1] }
    for (const [k, v] of parsed.searchParams) {
      if (/^(gno|gi_no)$/i.test(k) && /^\d{5,}$/.test(v)) return { id: v }
    }
  }
  return { error: `Could not parse a JobKorea posting id from "${input}"`, code: "BAD_ID" }
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const norm = normalizeId(opts.id)
  if ("error" in norm) {
    writeError(norm.error, norm.code)
    return 1
  }
  const id = norm.id
  try {
    const html = await httpFetch(`${DETAIL_URL}/${id}`)
    if (!html || !/application\/ld\+json|data-sentry-component="RecruitmentItem"/.test(html)) {
      writeError("Job not found (GameJob-sourced postings are read with the gamejob-search skill)", "NOT_FOUND")
      return 1
    }
    const base = parseJobDetail(html, id)
    const iframe = await httpFetch(`${DESCRIPTION_IFRAME_URL}?Gno=${id}`)
    const desc = iframe ? parseDescription(iframe) : { text: null, images: 0 }
    const job: JobDetail = stripInvisible({ ...base, description: desc.text, descriptionImages: desc.images })

    if (opts.format === "plain") {
      const imgNote =
        job.descriptionImages > 0
          ? `(본문에 이미지 ${job.descriptionImages}개 - 이미지 속 글자는 읽지 못합니다. 원문: ${job.url})`
          : ""
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        job.field ? `모집분야: ${job.field}` : "",
        job.headcount ? `모집인원: ${job.headcount}` : "",
        job.career ? `경력: ${job.career}` : "",
        job.employmentType ? `고용형태: ${job.employmentType}` : "",
        job.education ? `학력: ${job.education}` : "",
        job.salary ? `급여: ${job.salary}` : "",
        job.workHours ? `근무시간: ${job.workHours}` : "",
        job.address ? `근무지주소: ${job.address}` : "",
        job.skills ? `스킬: ${job.skills}` : "",
        job.preferred ? `우대조건: ${job.preferred}` : "",
        `등록일: ${job.date || "—"} · 마감일: ${job.deadline || "—"}`,
        `Status: ${job.isActive ? "ACTIVE" : "CLOSED / EXPIRED"}`,
        "",
        job.description || "(본문 텍스트 없음)",
        imgNote,
        "",
        `URL: ${job.url}`,
      ].filter((l) => l !== "")
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
