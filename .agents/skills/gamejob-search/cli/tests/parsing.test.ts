import { describe, expect, test } from "bun:test"
import {
  parseDeadline,
  parseIframeBody,
  parseJobCards,
  parseJobDetail,
  parseRegistered,
  parseTotalCount,
} from "../src/helpers"
import { normalizeId } from "../src/commands/detail"
import { buildBody, filterByAge } from "../src/commands/search"

// Fixed "today": Saturday 2026-11-14.
const TODAY = new Date(2026, 10, 14, 9, 0, 0)

// Trimmed copy of one /Recruit/_GI_Job_List/ row (live markup, 2026-11-14).
const ROW = `
<span class="count totalJobcnt">(78)</span>
<tr>
  <td><div class="company noLogo"><a href="/Company/Detail?tabcode=1&M=1"><strong>(주)무브인터렉티브</strong></a></div></td>
  <td><div class="tit">
    <a href="/Recruit/GI_Read/View?GI_No=286906" target="_blank"><strong>[무브인터렉티브-대구] 게임 클라이언트 프로그래머 모집</strong></a>
    <p class="info">
      <span>경력무관</span><span>학력무관</span><span>대구 &gt; 중구</span>
      <span>온라인PC게임, 콘솔게임</span><span>정규직, 계약직</span>
    </p></div></td>
  <td><span class="date">~12/12</span><span class="modifyDate">13시간 전 등록</span></td>
</tr>
<tr><td>no posting link here</td></tr>
<tr>
  <td><div class="company"><strong>테스트&amp;컴퍼니</strong></div></td>
  <td><div class="tit"><a href="/Recruit/GI_Read/View?GI_No=286578"><strong>모바일 2D <span style="display:none">IGNORE THIS</span>유니티 프로그래머</strong></a>
  <p class="info"><span>경력5년↑</span><span>대졸↑</span><span>서울 &gt; 마포구</span><span>모바일게임</span><span>정규직</span></p></div></td>
  <td><span class="date">채용시</span><span class="modifyDate">10/27(화) 등록</span></td>
</tr>`

describe("parseJobCards", () => {
  const cards = parseJobCards(ROW, TODAY)

  test("parses one card per posting row and skips rows without a posting link", () => {
    expect(cards.map((c) => c.id)).toEqual(["286906", "286578"])
  })

  test("extracts the contract fields", () => {
    const c = cards[0]
    expect(c.title).toBe("[무브인터렉티브-대구] 게임 클라이언트 프로그래머 모집")
    expect(c.company).toBe("(주)무브인터렉티브")
    expect(c.location).toBe("대구 > 중구")
    expect(c.date).toBe("2026-11-13")
    expect(c.deadline).toBe("2026-12-12")
    expect(c.url).toBe("https://www.gamejob.co.kr/Recruit/GI_Read/View?GI_No=286906")
    expect(c.career).toBe("경력무관")
    expect(c.employmentType).toBe("정규직, 계약직")
    expect(c.gameField).toBe("온라인PC게임, 콘솔게임")
  })

  test("decodes entities, drops hidden text, resolves a weekday date to its year", () => {
    const c = cards[1]
    expect(c.company).toBe("테스트&컴퍼니")
    expect(c.title).toBe("모바일 2D 유니티 프로그래머")
    expect(c.date).toBe("2026-10-27") // 2026-10-27 is a Tuesday
    expect(c.deadline).toBe("채용시")
  })

  test("reads the total hit count", () => {
    expect(parseTotalCount(ROW)).toBe(78)
  })
})

describe("dates", () => {
  test("relative registration labels", () => {
    expect(parseRegistered("1일 전 등록", TODAY)).toBe("2026-11-13")
    expect(parseRegistered("3일 전 등록", TODAY)).toBe("2026-11-11")
  })

  test("a weekday that does not fit this year picks the earlier year", () => {
    // 10/27 was a Monday in 2025.
    expect(parseRegistered("10/27(월) 등록", TODAY)).toBe("2025-10-27")
  })

  test("a year-less deadline before today rolls into next year", () => {
    expect(parseDeadline("~01/03", TODAY)).toBe("2027-01-03")
  })

  test("filterByAge keeps undated postings and drops old ones", () => {
    const cards = parseJobCards(ROW, TODAY)
    const kept = filterByAge([...cards, { ...cards[0], id: "x", date: null }], 14, TODAY)
    expect(kept.map((c) => c.id)).toEqual(["286906", "x"])
  })
})

describe("buildBody", () => {
  test("sends searchtype=all so the keyword filter applies", () => {
    const body = buildBody({ query: "유니티", order: "recent", page: 2, format: "json" })
    expect(body.get("condition[searchtype]")).toBe("all")
    expect(body.get("condition[searchstring]")).toBe("유니티")
    expect(body.get("order")).toBe("3")
    expect(body.get("page")).toBe("2")
  })
})

describe("detail parsing", () => {
  const html = `
<meta property="og:title" content="[무브] 클라이언트 프로그래머 채용">
<meta property="og:description" content="[무브]의 채용이 채용시 마감까지 진행 됩니다. 근무 예정지는 대구 &gt; 중구 입니다.">
<section class="section-view-top"><div class="view__header-title"><div class="corp-name">
<a href="/Company/Detail?M=1">(주)무브인터렉티브</a></div><h1>[무브인터렉티브-대구] 클라이언트 프로그래머 모집</h1></div></section>
<dl><dt class="recruit-data-title">모집분야</dt><dd class="recruit-data-text">게임개발(클라이언트)</dd></dl>
<dl><dt class="recruit-data-title">경력</dt><dd class="recruit-data-text">무관</dd></dl>
<dl><dt class="recruit-data-title">급여</dt><dd class="recruit-data-text"><span>면접 시 협의</span> <a>연봉검색</a></dd></dl>
<dl><dt class="recruit-data-title">마감일</dt><dd class="recruit-data-text"><p class="end-date">채용시 마감</p></dd></dl>
<dl><dt>시작일</dt><dd>2026-11-13(금)</dd></dl>
<input type="hidden" id="GI_Read_Stat" value="Open" />`

  test("extracts the summary fields", () => {
    const d = parseJobDetail(html, "286906", TODAY)
    expect(d.title).toBe("[무브인터렉티브-대구] 클라이언트 프로그래머 모집")
    expect(d.company).toBe("(주)무브인터렉티브")
    expect(d.location).toBe("대구 > 중구")
    expect(d.field).toBe("게임개발(클라이언트)")
    expect(d.career).toBe("무관")
    expect(d.salary).toBe("면접 시 협의")
    expect(d.deadline).toBe("채용시 마감")
    expect(d.date).toBe("2026-11-13")
    expect(d.isActive).toBe(true)
  })

  test("iframe body keeps line breaks and counts images", () => {
    const r = parseIframeBody(`<body><p>* 서버<br>- C++ / IOCP</p><!-- hidden note --><img src="a.png"><p>* 클라이언트</p></body>`)
    expect(r.text).toBe("* 서버\n- C++ / IOCP\n* 클라이언트")
    expect(r.images).toBe(1)
  })
})

describe("normalizeId", () => {
  test("accepts a GI_No or a gamejob URL", () => {
    expect(normalizeId("286906")).toBe("286906")
    expect(normalizeId("https://www.gamejob.co.kr/Recruit/GI_Read/View?GI_No=286906")).toBe("286906")
    expect(normalizeId("gamejob.co.kr/List_GI/GIB_Read.asp?GI_No=253223")).toBe("253223")
  })

  test("rejects other hosts and look-alikes", () => {
    expect(normalizeId("https://evil.io/?GI_No=286906")).toBeNull()
    expect(normalizeId("https://gamejob.co.kr.evil.io/?GI_No=286906")).toBeNull()
    expect(normalizeId("https://gamejob.co.kr@evil.io/?GI_No=286906")).toBeNull()
  })
})
