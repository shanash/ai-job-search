import {
  VIEW_AJAX_URL,
  VIEW_DETAIL_URL,
  httpFetch,
  isPostingFragment,
  jobUrl,
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

const SARAMIN_HOST = /(^|\.)saramin\.co\.kr$/i

/**
 * Accept a raw posting id (rec_idx digits) or a saramin.co.kr URL carrying
 * `rec_idx` (e.g. /zf_user/jobs/relay/view?rec_idx=…). A URL on any other host
 * is rejected, read through real URL parsing so look-alike hosts
 * (saramin.co.kr.evil.io) and userinfo tricks fail too.
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
    if (!SARAMIN_HOST.test(parsed.hostname)) {
      return { error: `Not a Saramin URL: "${input}"`, code: "BAD_ID" }
    }
    const rec = parsed.searchParams.get("rec_idx")
    if (rec && /^\d{5,}$/.test(rec)) return { id: rec }
    const m = parsed.pathname.match(/\/rec_idx\/(\d{5,})(?:\/|$)/)
    if (m) return { id: m[1] }
  }
  return { error: `Could not parse a Saramin posting id (rec_idx) from "${input}"`, code: "BAD_ID" }
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const norm = normalizeId(opts.id)
  if ("error" in norm) {
    writeError(norm.error, norm.code)
    return 1
  }
  const id = norm.id
  const referer = jobUrl(id)
  try {
    // The posting page itself is a shell; the site loads the posting from this
    // fragment endpoint, which answers 404 unless the posting page is the referer.
    const html = await httpFetch(VIEW_AJAX_URL, {
      form: { rec_idx: id, rec_seq: "0", view_type: "search" },
      referer,
    })
    if (!html || !isPostingFragment(html)) {
      writeError("Job not found (removed, or not a Saramin posting id)", "NOT_FOUND")
      return 1
    }
    const base = parseJobDetail(html, id)
    const iframe = await httpFetch(`${VIEW_DETAIL_URL}?rec_idx=${id}&rec_seq=0`, { referer })
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
        job.career ? `경력: ${job.career}` : "",
        job.education ? `학력: ${job.education}` : "",
        job.employmentType ? `근무형태: ${job.employmentType}` : "",
        job.salary ? `급여: ${job.salary}` : "",
        job.workHours ? `근무일시: ${job.workHours}` : "",
        job.position ? `직급/직책: ${job.position}` : "",
        job.preferred ? `우대사항: ${job.preferred}` : "",
        job.address ? `근무지주소: ${job.address}` : "",
        job.keywords ? `키워드: ${job.keywords}` : "",
        `시작일: ${job.date || "—"} · 마감일: ${job.deadline || "—"}`,
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
