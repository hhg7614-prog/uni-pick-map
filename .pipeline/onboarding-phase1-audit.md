# 온보딩 파이프라인 재건 — Phase 1: 247개 홈페이지 + robots 전수 감사

실행일: 2026-08-31. 스크립트: 247개 대학 `universities.js` 홈페이지 URL 실측 + robots.txt 정책(`server/agent/screening/` 모듈) 전수.

## 결과 요약

### 홈페이지 도달성 (247)
| | 수 |
|---|---|
| 200 OK | 237 |
| 302 / 404 / 406 | 4 |
| 헤더 오류(HPE_INVALID_HEADER_TOKEN) | 4 |
| ECONNRESET / ECONNREFUSED | 2 |

→ **홈페이지 데이터는 대체로 정상**. (이전 feed-agent 프로브의 404는 발굴이 따라간 하위 링크였지 홈페이지가 아님.)

### robots 정책 (247, origin 기준 dedupe)
| | 수 |
|---|---|
| ok (크롤 허용) | 119 |
| none(404) — robots.txt 없음 = 허용 | 44 |
| **AI_BLOCKED** (ClaudeBot/GPTBot 등 `Disallow: /`) | **51** |
| not-robots(html) — WAF/에러 페이지 반환, 판단 불가 | 24 |
| 기타 오류 | ~9 |

### 카탈로그 상태 (247)
| | 수 |
|---|---|
| ACTIVE (수집 중) | 34 |
| SOURCE_DISABLED (검증된 소스 있으나 미활성) | 27 |
| DEACTIVATED (robots 위반으로 8/31 비활성화) | 6 |
| SOURCE_UNVERIFIED | 3 |
| **NO_SOURCE** | **177** |

## 핵심 지표

- **홈OK + robots허용 = 161개**
- 그중 소스 없음/미검증 = **117개 → 발굴 대상 큐**
- **247 전부는 불가능 확정**: AI_BLOCKED 51 + WAF 24 + 발굴 실패율. 현실적 상한 **~90~130개**.

## 즉시 활성화 가능 (⭐ 4개) — 검증된 소스 + 셀렉터 완비 + robots(origin) 허용

| 대학 | 소스 타입 | 비고 |
|---|---|---|
| 서울시립대학교 | RSS | RSS CDATA 버그 수정됨(afc8cd7). **단 상세 URL `/korNotice/` path Disallow 재확인 필요** |
| 연세대학교(미래) 분교 | html | path robots 재확인 필요 |
| 한양대학교(ERICA) 분교 | html | path robots 재확인 필요 |
| 연세대학교 국제캠퍼스 | html | path robots 재확인 필요 |

→ **게이트 활성화(B2 패킷 → B3 서명 → B4 apply)만 하면 됨. `UNIPICK_GATE_SIGNING_KEY` 필요.**

## SOURCE_DISABLED 27개 분류

- ⭐ 4개: 위 즉시 활성화 대상
- custom_html 7개 (경동·가톨릭관동·경운·대신·상명천안·인제·화성의과학): 런타임이 custom_html 미지원 → 표준 html 재작성 필요
- html + 셀렉터 없음 + robots ok ~8개 (인하·부산교대·한국해양·서강·단국제2 등): 셀렉터 발굴 필요
- robots AI_BLOCKED ~8개 (서울대·전남대·제주대·충남대·한국교원대·한국항공대·홍익서울·세종·아주): 온보딩 불가

## 다음 단계

- **Phase 2**: 117개 발굴 대상에 게시판/피드 발굴 실행 (feed-section-discovery 개선 + path robots 체크 포함). 배치 단위.
- **Phase 3**: Phase 2 후보 + ⭐ 4개를 게이트로 활성화.
- **선결 조건**: `UNIPICK_GATE_SIGNING_KEY` 운영값 설정 (없으면 어떤 활성화도 불가).

상세 데이터: `phase1-audit-detail.json` (scratchpad, 247행).
