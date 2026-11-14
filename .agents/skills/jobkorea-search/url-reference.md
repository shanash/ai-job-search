# JobKorea URL Reference

Public, unauthenticated endpoints used by this skill (verified live 2026-11-14).

> Personal use only — keep volume low. robots.txt (`User-agent: *`) disallows
> `/login/`, `/User/`, `/my/`, `/account/`, `/RecrtMng/`, `/corp/`, `/text_co/`,
> `/Salary/mylist` and `/Recruit/JobList/SpaceClick`; everything used here is under
> `/Search/` or `/Recruit/GI_Read…`, which are allowed. (AI *training* crawlers such
> as ClaudeBot/GPTBot are blocked site-wide; this is a user-run CLI with its own
> honest User-Agent, `Mozilla/5.0 (compatible; jobkorea-cli/1.0)`.)

## Search

```
POST https://www.jobkorea.co.kr/Search/api/display/v2/jobs
Content-Type: application/json
```

This is the request the result page (`/Search/?stext=…&tabType=recruit`) makes from
its client bundle (`queryKey: JOB_LIST`, `queryFn: post("/Search/api/display", "/v2/jobs")`).
The server-rendered page ignores the `local` URL parameter (location comes from
client state), so the CLI calls the JSON endpoint directly.

| Body field | Meaning | Values |
|------------|---------|--------|
| `keyword` | Keywords | UTF-8 text, **≤ 30 chars** (the site sends `""` for longer input, which returns everything) |
| `page` | **0-indexed** page | `0`, `1`, … (site UI caps at 499) |
| `pageSize` | Rows per page | site uses `20`; `40`/`50` also work. CLI sends `40` |
| `sortProperty` | Sort | `1` 관련도순 · `2` 등록일순 · `3` 최신업데이트순 · `4` 마감임박순 · `5` 조회수순 · `6` 지원자순 |
| `sortDirection` | Direction | site always sends `DESC` |
| `locationList` | Area codes | e.g. `["I000","B150"]`; `[]` = everywhere |
| `period` | Registration window | `""`/`1` 전체 · `2` 오늘 · `3` 최근3일 · `4` 최근1주일 · `5` 최근1개월 |
| `deviceType` | Client | `PC` |

Other accepted lists (`jobClassificationCodeList`, `careerList`, `employmentTypeList`,
`educationCodeList`, `companyTypeList`, `excludeKeywordList`, …) take internal codes;
the CLI does not send them. Omitted fields default to "no filter".

### Response structure (JSON)

`{ pageSize, pageNumber, totalElements, totalPages, content: [job…] }`. Fields read per job:

| Field | Use |
|-------|-----|
| `id` | posting id → `https://www.jobkorea.co.kr/Recruit/GI_Read/<id>` |
| `title`, `postingCompanyName` (fallback `companyName`) | title, company |
| `createdAt` | registration timestamp, `+09:00` → `date` |
| `applicationPeriod.end` | deadline; `2070-01-01…` means open-ended → `"상시"` |
| `areaCodeList` | area codes → names via `src/areas.ts` |
| `careerType` / `careerRange` | `1` 신입 · `2` 경력 · `3` 신입·경력 · `4` 경력무관; range = years (`100`/`0` = none) |
| `educationCode` | `0` 학력무관 · `3` 고졸↑ · `4` 초대졸↑ · `5` 대졸↑ · `6` 석사↑ · `7` 박사↑ |
| `employmentTypeCodeList` | `"<code>/<flag>"`; code `1` 정규직 · `2` 계약직 · `3` 인턴 · `4` 파견직 · `5` 도급 · `6` 프리랜서 · `7` 아르바이트 · `8` 연수생/교육생 · `9` 병역특례 · `10` 위촉직/개인사업자 |
| `payTypeCode` / `payRange` | `1` 연봉 · `2` 월급 (만원) · `3` 주급 · `4` 일급 · `5` 시급 · `6` 건별; `0~0` = not given |
| `jobClassificationOrIndustry` | `",게임·애니메이션,게임개발자,"` → `field` |
| `userRefType` | link type, mirroring the site's card link builder: `C` / `S` → `/Recruit/GI_Read/<id>`; `WN` → `/Recruit/GI_Read/<id>/Ext`; `G` → `https://www.gamejob.co.kr/Recruit/GI_Read/View?GI_No=<id>` |

### Area codes

`src/areas.ts` holds the full code table (631 entries) copied from the `area` list the
search page embeds in its server-rendered data (`self.__next_f` payload, React Query
key `CODES`). Province codes: `I000` 서울 · `B000` 경기 · `K000` 인천 · `G000` 대전 ·
`1000` 세종 · `O000` 충남 · `P000` 충북 · `L000` 전남광주 · `M000` 전북 · `F000` 대구 ·
`D000` 경북 · `H000` 부산 · `J000` 울산 · `C000` 경남 · `A000` 강원 · `N000` 제주 ·
`Q000` 전국 · overseas `R000`–`Z000`. Useful districts: `I010` 서울 강남구,
`I070` 구로구, `I080` 금천구, `I130` 마포구, `I150` 서초구, `I180` 송파구, `B150` 경기 성남시 분당구 (판교), `B160`/`B170` 성남시 수정구/중원구,
`B201` 수원시 영통구, `B311` 용인시 수지구, `B380` 하남시. Codes ending `_` are a
province's 전지역 entry. Regenerate the table if the site changes its codes.

## Detail

```
GET https://www.jobkorea.co.kr/Recruit/GI_Read/<id>                       # posting page (404 for unknown ids)
GET https://www.jobkorea.co.kr/Recruit/GI_Read_Comt_Ifrm?Gno=<id>         # 상세요강 iframe (description)
```

Anchors in the posting page:

- `<script type="application/ld+json">` JobPosting: `title`, `datePosted`,
  `validThrough`, `hiringOrganization.name`, `jobLocation.address.streetAddress`.
  (`validThrough` is a year out for 상시채용 postings — the CLI prefers the meta label.)
- Deadline label: `<meta name="description" content="… 마감일 : 2027.01.11">` or `상시채용`.
- Summary items: `<div data-sentry-component="RecruitmentField|RecruitmentItem|QualificationItem">`
  whose first `<span>` is the label (모집분야, 모집인원, 고용형태, 급여, 근무시간,
  근무지주소, 경력, 학력, 스킬, 우대조건) and the rest of the element is the value.
  Each element is extracted by tag-depth counting, then `<button>`s (지도보기) dropped.
- Fallbacks: `og:title` (`<company> 채용 - <title> | 잡코리아`), `<meta name="writer">` (company).

The iframe is its own Next.js page; the employer's content is
`<div id="detail-content" class="… invisible opacity-0">` (the class is revealed by
script after load — it is visible content, not hidden text). Templates are often
text; many postings are a single `<img>`. The CLI returns the text with line breaks
and counts the images (`descriptionImages`).
