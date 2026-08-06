# UNI PICK 뉴스 에이전트 운영 안내서

> 초보자도 쉽게 따라할 수 있도록 작성된 안내서입니다.

---

## 관련 파일 위치

```
server/agent/
├── config.js          ← 설정 읽기
├── targets.js         ← 대상 대학 판정
├── collector.js       ← 수집 + 링크 검증
├── dedup.js           ← 중복 방지
├── store.js           ← 저장소 + preview 저장
├── lock.js            ← 실행 잠금
├── runner.js          ← 단발 실행기 (1회 파이프라인)
├── scheduler.js       ← 오전 09:30 / 오후 17:30 스케줄러
├── status.js          ← 상태 확인
├── stop.js            ← 안전 중지
├── once.js            ← 1회 수동 실행 진입점
└── data/
    ├── agent-news-store.json   ← 에이전트 전용 저장소
    ├── agent-status.json       ← 마지막 실행 상태
    ├── agent.lock              ← 실행 잠금 파일 (실행 중에만 생성됨)
    ├── agent.stop              ← 중지 요청 파일 (stop 명령 시 생성됨)
    └── reports/                ← 실행별 보고서 (최대 30개)
```

---

## 현재 설정

- NEWS_AGENT_ENABLED=false  (자동 실행 꺼짐)
- NEWS_AGENT_CRON=30 9,17 * * *  (오전 09:30 / 오후 17:30)
- NEWS_AGENT_TIMEZONE=Asia/Seoul  (한국 시간 기준)
- NEWS_AGENT_RUN_ON_STARTUP=false
- NEWS_AGENT_PREVENT_OVERLAP=true
- NEWS_AI_ENABLED=false

---

## 명령어

### 지금 바로 1회 수집
```
npm run news:agent:once
```

### 마지막 실행 결과 확인
```
npm run news:agent:status
```

### 자동 스케줄러 시작 (NEWS_AGENT_ENABLED=true 필요)
```
npm run news:agent
```

### 스케줄러 안전 중지
```
npm run news:agent:stop
```

---

## 데이터 반영 구조

에이전트 수집
  → server/agent/data/agent-news-store.json (전체 저장소)
  → data/university-news-preview.json (최신 30건 자동 생성)
  → https://uni-pick-map.onrender.com (사이트 학교 소식 패널에 표시)

---

## 주의사항

- 에이전트 오류가 나도 지도와 검색 기능은 영향 없음
- 이전 수집이 끝나지 않으면 다음 실행은 건너뜀
- 중복 게시물은 다시 저장하지 않음
- 홈페이지 목록 URL과 동일한 링크는 자동 제외
