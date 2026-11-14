import {
  COMMENT_IFRAME_URL,
  DETAIL_URL,
  WORK_IFRAME_URL,
  htmlFetch,
  parseIframeBody,
  parseJobDetail,
  stripInvisible,
  writeError,
  type JobDetail,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

const GAMEJOB_HOST = /(^|\.)gamejob\.co\.kr$/i

/**
 * Accept a raw GI_No (digits) or a gamejob.co.kr posting URL carrying GI_No.
 * A URL on any other host is rejected, read through real URL parsing so
 * look-alike hosts (gamejob.co.kr.evil.io) and userinfo tricks fail too.
 */
export function normalizeId(input: string): string | null {
  const trimmed = input.trim()
  if (/^\d{4,}$/.test(trimmed)) return trimmed
  const hasScheme = /^https?:\/\//i.test(trimmed)
  if (hasScheme || /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) {
    let parsed: URL
    try {
      parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)
    } catch {
      return null
    }
    if (!GAMEJOB_HOST.test(parsed.hostname)) return null
    for (const [k, v] of parsed.searchParams) {
      if (k.toLowerCase() === "gi_no" && /^\d{4,}$/.test(v)) return v
    }
    return null
  }
  return null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`Could not parse a GameJob posting ID (GI_No) from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const html = await htmlFetch(`${DETAIL_URL}?GI_No=${id}`)
    if (!html || !/recruit-data-title|view__header-title/.test(html)) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }
    const base = parseJobDetail(html, id)
    const [work, comment] = await Promise.all([
      htmlFetch(`${WORK_IFRAME_URL}?gno=${id}`),
      htmlFetch(`${COMMENT_IFRAME_URL}?gno=${id}`),
    ])
    const w = parseIframeBody(work)
    const c = parseIframeBody(comment)
    const job: JobDetail = stripInvisible({
      ...base,
      description: w.text,
      qualifications: c.text,
      descriptionImages: w.images + c.images,
    })

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
        job.keywords ? `키워드: ${job.keywords}` : "",
        job.career ? `경력: ${job.career}` : "",
        job.employmentType ? `고용형태: ${job.employmentType}` : "",
        job.education ? `학력: ${job.education}` : "",
        job.position ? `직급/직책: ${job.position}` : "",
        job.salary ? `급여: ${job.salary}` : "",
        `시작일: ${job.date || "—"} · 마감일: ${job.deadline || "—"}`,
        `Status: ${job.isActive ? "ACTIVE" : "CLOSED / EXPIRED"}`,
        "",
        job.description || "(본문 텍스트 없음)",
        job.qualifications ? `\n${job.qualifications}` : "",
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
