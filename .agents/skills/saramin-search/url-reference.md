# Saramin URL Reference

Public, unauthenticated endpoints used by this skill (verified live 2026-11-14).

> Personal use only — keep volume low. robots.txt (`User-agent: *`) allows
> `/zf_user/search/` and `/zf_user/jobs/relay/…`; it disallows, among others,
> `/zf_user/recruit/view/`, `/recruit/recruit_view.php`, `/zf_user/company/`,
> `/zf_user/jobs/view/etc`, `/zf_user/special-recruit/` and the apply/resume paths.
> GPTBot and Bytespider are blocked site-wide; this is a user-run CLI with its own
> honest User-Agent, `Mozilla/5.0 (compatible; saramin-cli/1.0)`. The member terms
> (개인회원 이용약관) forbid copying or passing on information from the service
> without consent and using it for anything but job seeking.
>
> Saramin also runs an official Open API (`oapi.saramin.co.kr`) that needs an access
> key issued on application; this skill does not use it.

## Search

```
GET https://www.saramin.co.kr/zf_user/search/recruit?searchType=search&searchword=<q>&recruitPage=<n>&recruitPageCount=40&recruitSort=<sort>[&loc_mcd=<codes>][&loc_cd=<codes>]
```

Server-rendered HTML; the results are in the page, no XHR needed.

| Parameter | Meaning | Values |
|-----------|---------|--------|
| `searchword` | Keywords | UTF-8 text; all words must match (broadly — company tags and body text count). Empty = everything |
| `recruitPage` | **1-indexed** page | `1`, `2`, … |
| `recruitPageCount` | Rows per page | `10`/`20`/`30`/`40`/`50`/`80`/`100`; CLI sends `40` |
| `recruitSort` | Sort | `relation` 관련도순 · `accuracy` 정확도순 · `reg_dt` 등록일순 · `edit_dt` 수정일순 · `closing_dt` 마감일순 · `apply_cnt` 지원자순 · `employ_cnt` 사원수순 |
| `loc_mcd` | Whole provinces | comma-separated, e.g. `101000,102000` |
| `loc_cd` | Cities / districts | comma-separated, e.g. `101010,102190`; combined with `loc_mcd` as OR |
| `job_type[]` | Employment type | `1` 정규직 · `2` 계약직 · `4` 인턴직 · … (not sent by the CLI) |

There is **no posting-age parameter**; `--jobage` is applied client-side to the page
fetched. Other filters (`exp_cd`, `edu_min`, `sal_min`, `company_type`, `cat_kewd`, …)
exist but the CLI does not send them.

### Result anchors

- Total: `<span class="cnt_result">총 1,234건</span>`.
- Each result: `<div class="item_recruit" value="<rec_idx>">`. The page is split at each
  of these and every chunk parsed on its own; within a chunk the card is cut by
  `<div>` depth counting.
- Title: `<h2 class="job_tit"><a title="…" href="/zf_user/jobs/relay/view?…rec_idx=<id>…"><span>…</span></a>`
  (employers' titles are sometimes cut short on the site itself; the detail page has
  the same text).
- Company: `<strong class="corp_name"><a …>name</a></strong>`.
- Deadline: `<span class="date">` → `~ 12/13(일)` (no year: the CLI picks the year
  that puts it nearest after today), `오늘마감`, `내일마감`, `상시채용` → `"상시"`,
  `채용시` → `"채용시"`.
- Conditions: `<div class="job_condition">` spans, in order location (area links
  `/zf_user/area-recruit/area-list/area/<code>`), career (`신입`/`경력…`), education
  (`…졸↑`/`학력무관`), employment type (`정규직·계약직`), optional salary (`4,000 만원`).
  Empty ones are omitted, so the CLI recognizes each by content, not position.
- Keywords and date: `<div class="job_sector">` anchors (job-category / industry
  links), then `<span class="job_day">등록일 26/11/13</span>` or `수정일 26/11/13` —
  an edited posting shows its edit date instead of its registration date
  (`dateType: "modified"`). `recruitSort=reg_dt` still orders by registration.

### Area codes

`src/areas.ts` holds the 288 domestic codes from the `area` table the search page
embeds in its inline `options` JSON (`'options' : '{…"area":{…}}'`). Each entry
carries `id` `loc_mcd` (whole province, `type: "all"`) or `loc_cd` (city/district).
Provinces: `101000` 서울 · `102000` 경기 · `108000` 인천 · `106000` 부산 ·
`104000` 대구 · `105000` 대전 · `112000` 전남광주 · `107000` 울산 · `118000` 세종 ·
`109000` 강원 · `110000` 경남 · `111000` 경북 · `113000` 전북 · `115000` 충남 ·
`114000` 충북 · `116000` 제주 · `117000` 전국. Useful districts: `101010` 서울 강남구,
`101070` 구로구, `101080` 금천구, `101130` 마포구, `101150` 서초구, `101180` 송파구,
`102180` 성남시 (whole), `102190` 성남시 분당구 (판교), `102240` 수원시 영통구,
`102420` 용인시 수지구, `102500` 하남시. Regenerate the table if the site changes its codes.

## Detail

```
GET  https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=<id>              # posting page (public URL; a shell)
POST https://www.saramin.co.kr/zf_user/jobs/relay/view-ajax                      # the posting itself
     body: rec_idx=<id>&rec_seq=0&view_type=search   Referer: <posting page URL>
GET  https://www.saramin.co.kr/zf_user/jobs/relay/view-detail?rec_idx=<id>&rec_seq=0  # 상세요강 iframe
```

The posting page only carries meta tags and a script (`JobsView.init`) that POSTs to
`view-ajax` for the content. That endpoint answers **404 unless the Referer is the
posting page**; an unknown `rec_idx` answers `302` to an error page (the CLI reports
`NOT_FOUND` when the response has no `<h1 class="tit_job">`).

Anchors in the `view-ajax` fragment:

- `<div class="jv_header">`: `<a … class="company">` (company), `<h1 class="tit_job">` (title).
- `<div class="jv_cont jv_summary">` (핵심 정보): `<dl><dt>label</dt><dd>value</dd></dl>`
  for 경력, 학력, 근무형태, 급여, 근무일시, 근무지역, sometimes 직급/직책, 우대사항.
  `<div class="toolTipWrap …">` (click-to-open details such as 수습기간 and the
  최저임금 notice) and `<button>`s (지도보기) are dropped from values.
- `<div class="tags">`: `#…` links; `job-category` links are kept as `keywords`,
  `domestic?loc_cd=` (region) links dropped.
- `<dl class="info_period"><dt>시작일</dt><dd>2026.11.13 17:00</dd><dt class="end">마감일</dt><dd>…</dd>`.
- `<div class="jv_cont jv_location" data-address="(06121) 서울 강남구 …">` (address).
- `<dl class="guide">` also holds 담당자 / 연락처 (recruiter name and phone). The CLI
  **does not read them**.

The iframe's employer content is `<div class="user_content">`. Templates hide unused
blocks with `style="display:none"` (removed by `visibleHtml`) and include a
`…/hiring/images/blank.png` placeholder (not counted). Many postings are a single
uploaded `<img>` — `description` is then `null` and `descriptionImages` counts them.
