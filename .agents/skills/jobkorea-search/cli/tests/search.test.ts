import { describe, expect, test } from "bun:test"
import { parseJSON, runCLI } from "./helpers"

interface SearchResult {
  meta: { count: number; page: number; total: number | null }
  results: { id: string | null; title: string | null; company: string | null; url: string | null }[]
}

// Live smoke tests: these hit jobkorea.co.kr, so keep them few.
describe("search (live)", () => {
  test("returns real postings for a realistic query", async () => {
    const out = parseJSON<SearchResult>(await runCLI(["search", "-q", "유니티 클라이언트", "--limit", "5"]))
    expect(out.results.length).toBeGreaterThanOrEqual(1)
    for (const r of out.results) {
      expect(r.id).toBeTruthy()
      expect(r.title).toBeTruthy()
      expect(r.url).toMatch(/^https:\/\/www\.(jobkorea|gamejob)\.co\.kr\/Recruit\/GI_Read/)
    }
  })

  test("detail reads one posting from the search results", async () => {
    const out = parseJSON<SearchResult>(await runCLI(["search", "-q", "게임 클라이언트", "-l", "서울", "--limit", "1"]))
    const id = out.results[0].id as string
    const detail = parseJSON<{ id: string; title: string }>(await runCLI(["detail", id]))
    expect(detail.id).toBe(id)
    expect(detail.title.length).toBeGreaterThan(0)
  })
})

describe("argument errors", () => {
  test("an unknown flag exits 1 with a JSON error on stderr", async () => {
    const r = await runCLI(["search", "--city", "서울"])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toBe("")
    expect(JSON.parse(r.stderr).code).toBe("UNKNOWN_FLAG")
  })

  test("detail without an id exits 1", async () => {
    const r = await runCLI(["detail"])
    expect(r.exitCode).toBe(1)
    expect(JSON.parse(r.stderr).code).toBe("NO_ID")
  })

  test("an empty query is rejected rather than returning every posting", async () => {
    const r = await runCLI(["search", "-q", ""])
    expect(r.exitCode).toBe(1)
    expect(JSON.parse(r.stderr).code).toBe("BAD_ARG")
  })

  test("a query the site would ignore (over 30 characters) is rejected", async () => {
    const r = await runCLI(["search", "-q", "유".repeat(31)])
    expect(r.exitCode).toBe(1)
    expect(JSON.parse(r.stderr).code).toBe("BAD_ARG")
  })

  test("an unknown location is rejected", async () => {
    const r = await runCLI(["search", "-q", "유니티", "-l", "아틀란티스"])
    expect(r.exitCode).toBe(1)
    expect(JSON.parse(r.stderr).code).toBe("BAD_ARG")
  })

  test("a bad --jobage is rejected", async () => {
    const r = await runCLI(["search", "-q", "유니티", "--jobage", "0.5"])
    expect(r.exitCode).toBe(1)
    expect(JSON.parse(r.stderr).code).toBe("BAD_ARG")
  })
})
