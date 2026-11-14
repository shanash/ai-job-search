# GameJob URL Reference

Public, unauthenticated pages used by this skill (verified live 2026-11-14).

> Personal use only — keep volume low. robots.txt disallows `/List_GG/`, `/Login/`,
> `/Text_User/`, `/Text_Co/`, `/Project/`, `/Help/`; everything used here is under
> `/Recruit/`, which is allowed.

## Search

```
POST https://www.gamejob.co.kr/Recruit/_GI_Job_List/
Content-Type: application/x-www-form-urlencoded; charset=UTF-8
X-Requested-With: XMLHttpRequest
```

This is the endpoint `/Scripts/Recruit/Joblist.js` (`_getGIList`) calls to fill the
result list on `/Recruit/joblist?menucode=searchtot&searchtype=all&searchstring=...`.
jQuery serializes the nested `condition` object as bracketed keys.

| Param | Meaning | Values |
|-------|---------|--------|
| `condition[searchtype]` | Keyword scope | `all` — **required for the keyword to apply**; `A` or a missing value returns the unfiltered list |
| `condition[searchstring]` | Keywords | UTF-8 text, e.g. `유니티 클라이언트` |
| `page` | 1-indexed page | `1`, `2`, … |
| `pagesize` | Rows per page | `20` or `40` |
| `order` | Sort | `1` 추천순 · `2` 경력순 · `3` 등록일순 · `4` 수정일순 · `5` 마감일순 |
| `tabcode` | Company-type tab | `1` 전체 · `2` 대기업 · `3` 중견·중소 · `4` 벤처 · `5` 외국계 · `6` 헤드헌팅 |
| `direct` | Instant-apply only | `0` / `1` |

Other `condition[...]` keys exist on the site (`local`, `duty`, `career`, …) but take
internal codes; the CLI does not send them.

### Response structure (HTML fragment)

- Total count: `<span class="count totalJobcnt">(78)</span>`.
- One `<tr>` per posting. Anchors used by `parseJobCards`:
  - Company: `<div class="company ..."> ... <strong>NAME</strong>`
  - Title + id: `<div class="tit"><a href="/Recruit/GI_Read/View?GI_No=<id>"><strong>TITLE</strong></a>`
  - `<p class="info">` with `<span>`s in order: career (`경력무관`, `경력3년↑`),
    education (`학력무관`, `대졸↑`), location (`서울 &gt; 강남구`), game field
    (`모바일게임`), employment type (`정규직, 계약직`). The CLI matches each span by
    content, not position.
  - Deadline: `<span class="date">` — `~12/12`, `채용시`, `상시`.
  - Registered: `<span class="modifyDate">` — `13시간 전 등록`, `3일 전 등록`,
    `11/05(목) 등록` (no year; resolved from the weekday).

## Detail

```
GET https://www.gamejob.co.kr/Recruit/GI_Read/View?GI_No=<id>
GET https://www.gamejob.co.kr/Recruit/GI_Read_Comt_Ifrm?gno=<id>        # 담당업무 (description)
GET https://www.gamejob.co.kr/Recruit/GI_Read_GI_Comment_Ifrm?gno=<id>  # 자격요건 (qualifications)
```

Anchors in the posting page:

- Title: `<h1>` inside `class="view__header-title"`; fallback `og:title`.
- Company: `<div class="corp-name"><a ...>NAME</a>`.
- Location: only in `og:description` — `근무 예정지는 <location> 입니다.`
- Summary items: `<dt class="recruit-data-title">LABEL</dt><dd class="recruit-data-text">VALUE</dd>`
  for 모집분야, 키워드, 대표게임, 게임분야, 경력, 고용형태, 학력, 직급/직책, 모집인원,
  급여 (trailing `연봉검색` link text removed), 마감일.
- Start date: `<dt>시작일</dt><dd>2026-11-13(금)</dd>`.
- Open/closed: `<input type="hidden" id="GI_Read_Stat" value="Open" />`.

The two iframes are small HTML documents whose `<body>` holds the employer's editor
content: sometimes text, often only `<img>` tags. The CLI returns the text with line
breaks and counts the images (`descriptionImages`).

An unknown `GI_No` returns HTTP 200 without the summary markup; the CLI reports
`NOT_FOUND`.
