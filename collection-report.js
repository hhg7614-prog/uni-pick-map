(() => {
  const button = document.querySelector("#open-collection-report");
  const dialog = document.querySelector("#collection-report-dialog");
  const content = document.querySelector("#collection-report-content");
  const close = document.querySelector("#close-collection-report");
  if (!button || !dialog || !content) return;

  const create = (tag, text, className) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = text;
    return element;
  };
  const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const date = (value) => value ? new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false }) : "-";
  const statusText = (report) => report.statusLabel || report.status || "확인 필요";

  function metric(label, value) {
    const box = create("div", undefined, "report-metric");
    box.append(create("dt", label), create("dd", value));
    return box;
  }

  function renderError() {
    content.replaceChildren(create("h2", "수집 보고서"), create("p", "수집보고서를 불러오지 못했습니다.", "report-empty"));
  }

  function render(report) {
    if (!report || !report.reportAvailable) return renderError();
    const summary = report.summary || {};
    const deployment = report.deployment || {};
    const schools = Array.isArray(report.targetUniversities) ? report.targetUniversities : [];
    const fragment = document.createDocumentFragment();
    fragment.append(create("p", "UNI PICK NEWS AGENT", "eyebrow"), create("h2", "수집 보고서"));
    fragment.append(create("p", `상태: ${statusText(report)}`, "report-status"));

    const metrics = create("dl", undefined, "report-metrics report-metrics-expanded");
    metrics.append(
      metric("최근 실행", date(report.startedAt)),
      metric("실행 완료", date(report.completedAt)),
      metric("총 실행 시간", report.durationSeconds === null ? "-" : `${number(report.durationSeconds)}초`),
      metric("대상 대학", `${number(report.targetUniversityCount)}개`),
      metric("확인 / 검증 통과", `${number(summary.foundTotal)} / ${number(summary.acceptedTotal)}`),
      metric("신규 / 중복", `${number(summary.newTotal)} / ${number(summary.duplicateTotal)}`),
      metric("제외 / 오류", `${number(summary.excludedTotal)} / ${number(summary.errorTotal)}`),
      metric("현재 공개 소식", `${number(summary.previewCount)}건`),
      metric("GitHub 반영", deployment.pushed ? "완료" : "반영 없음"),
      metric("다음 실행", `${report.nextScheduledRuns?.morning || "09:30"} / ${report.nextScheduledRuns?.afternoon || "17:30"}`)
    );
    fragment.append(metrics);

    fragment.append(create("h3", "대학별 수집 결과"));
    const tableWrap = create("div", undefined, "report-table-wrap");
    const table = create("table", undefined, "report-table");
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    ["대학", "발견", "통과", "신규", "중복", "제외", "오류", "상태"].forEach((label) => headRow.append(create("th", label)));
    head.append(headRow);
    const body = document.createElement("tbody");
    schools.forEach((school) => {
      const row = document.createElement("tr");
      [school.universityName, school.found, school.accepted, school.newCount, school.duplicateCount, school.excludedCount, school.errorCount, school.status === "failed" ? "오류" : "정상"].forEach((value) => row.append(create("td", value)));
      body.append(row);
    });
    table.append(head, body);
    tableWrap.append(table);
    fragment.append(tableWrap);

    fragment.append(create("h3", "배포 상태"));
    const deploymentText = deployment.pushed
      ? `GitHub push 완료 · Render ${deployment.renderStatus === "push_completed_waiting_for_render" ? "자동 반영 대기" : "반영 완료"}`
      : "신규 뉴스가 없어 GitHub 반영을 건너뛰었습니다.";
    fragment.append(create("p", `${deploymentText}\nCommit: ${deployment.commitHash ? String(deployment.commitHash).slice(0, 7) : "-"}`, "report-status report-deployment"));
    content.replaceChildren(fragment);
  }

  async function load() {
    content.replaceChildren(create("h2", "수집 보고서"), create("p", "수집보고서를 불러오는 중입니다.", "report-empty"));
    try {
      const response = await fetch(`data/university-news-collection-report.json?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("report unavailable");
      render(await response.json());
    } catch {
      renderError();
    }
  }

  document.addEventListener("click", (event) => {
    if (!event.target.closest("#open-collection-report")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    dialog.showModal();
    load();
  }, true);
  close?.addEventListener("click", () => dialog.close());
})();
