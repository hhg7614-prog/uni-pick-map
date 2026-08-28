"use strict";

// 소비처 주의: run-scheduled-news-update.js 성공 분기(SUCCESS/NO_CHANGES)는
// breakdown 배열 3종 + 스칼라 카운트 4종(updatedCount/noNewItemsCount/failedCount/totalTargets)
// + messageKo 요약을 모두 payload 에 세팅한다. catch 분기(WARNING/FAILED)는
// breakdown 배열 + messageKo 요약만 세팅하고 스칼라 카운트 4종은 세팅하지 않는다
// (그 분기의 processed/success/failed 는 하드코딩값이라 카운트와 모순되기 때문).

/**
 * @param {Array<{universityName?:string, newCount?:number, duplicateCount?:number,
 *   error?:string, errors?:string[]}>} universityResults
 * @returns {{updated:Array<{universityName:string,newCount:number}>,
 *   noNewItems:Array<{universityName:string,reason:string}>,
 *   failed:Array<{universityName:string,reason:string}>,
 *   updatedCount:number, noNewItemsCount:number, failedCount:number, totalTargets:number}}
 */
function classifyUniversityResults(universityResults = []) {
  const list = Array.isArray(universityResults) ? universityResults : [];
  const updated = [];
  const noNewItems = [];
  const failed = [];
  for (const r of list) {
    const name = r && r.universityName ? String(r.universityName) : "(이름 없음)";
    const errors = Array.isArray(r && r.errors) ? r.errors.filter(Boolean) : [];
    const hasError = Boolean(r && r.error) || errors.length > 0;
    const newCount = Number(r && r.newCount) || 0;
    if (hasError) {
      const reason = r && r.error ? String(r.error) : errors.join("; ");
      failed.push({ universityName: name, reason });
    } else if (newCount > 0) {
      updated.push({ universityName: name, newCount });
    } else {
      const dup = Number(r && r.duplicateCount) || 0;
      noNewItems.push({ universityName: name, reason: `신규 게시물 없음 (중복 ${dup}건)` });
    }
  }
  return {
    updated, noNewItems, failed,
    updatedCount: updated.length,
    noNewItemsCount: noNewItems.length,
    failedCount: failed.length,
    totalTargets: list.length,
  };
}

/**
 * @param {ReturnType<typeof classifyUniversityResults>} breakdown
 * @returns {string[]}
 */
function buildUniversitySummaryLines(breakdown) {
  const b = breakdown || classifyUniversityResults([]);
  const sumNew = b.updated.reduce((n, u) => n + (Number(u.newCount) || 0), 0);
  const lines = [
    `업데이트 완료: ${b.updatedCount}개교 (신규 ${sumNew}건)`,
    `변경 없음: ${b.noNewItemsCount}개교`,
    `수집 실패: ${b.failedCount}개교`,
  ];
  for (const f of b.failed) lines.push(`- ${f.universityName}: ${f.reason}`);
  return lines;
}

/**
 * messageKo 꼬리 줄(저장 누적·배포 커밋·다음 실행 시각).
 * 성공 분기는 storeAfter/commitHash 둘 다, catch 분기는 둘 다 없이 호출된다.
 * @param {{storeAfter?:number, commitHash?:string|null}} payload
 * @param {Date} now - 다음 실행 시각 판정용(오전 실행이면 다음은 16:30, 아니면 09:30)
 * @returns {string[]}
 */
function buildTailLines(payload = {}, now = new Date()) {
  const stored = Number(payload && payload.storeAfter);
  const hash = payload && payload.commitHash ? String(payload.commitHash).slice(0, 7) : null;
  const lines = [];
  if (Number.isFinite(stored)) {
    lines.push(hash ? `전체 ${stored}건 저장 · 커밋 ${hash} 배포` : `전체 ${stored}건 저장 · 배포 안 함`);
  } else if (hash) {
    lines.push(`커밋 ${hash} 배포`);
  }
  lines.push(`다음 실행: ${now.getHours() < 12 ? "16:30" : "09:30"}`);
  return lines;
}

module.exports = { classifyUniversityResults, buildUniversitySummaryLines, buildTailLines };
