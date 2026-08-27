---
name: ship
description: Planner → Coder → Tester → Reviewer 순서로 전체 작업을 실행하는 4단계 개발 워크플로우
disable-model-invocation: true
argument-hint: "[작업 내용]"
---

사용자 요청:

$ARGUMENTS

이 작업을 다음 4단계로 순서대로 처리하세요.

반드시 앞 단계가 완료된 뒤 다음 단계로 진행하세요.

## STEP 1 - Planner

planner 서브에이전트를 실행하세요.

사용자의 전체 요청을 전달하고

.pipeline/spec.md

를 작성하게 하세요.

완료 후 spec.md를 읽으세요.

중대한 질문이 남아 구현할 수 없는 경우 작업을 중단하고 사용자에게 질문하세요.

## STEP 2 - Coder

coder 서브에이전트를 실행하세요.

반드시

.pipeline/spec.md

를 기준으로 구현하도록 지시하세요.

구현 완료 후

.pipeline/changes.md

가 생성되었는지 확인하세요.

## STEP 3 - Tester

tester 서브에이전트를 실행하세요.

다음을 기준으로 검증하게 하세요.

.pipeline/spec.md
.pipeline/changes.md
실제 변경된 파일

검증 결과는

.pipeline/test-results.md

에 저장하게 하세요.

Tester는 코드를 수정하면 안 됩니다.

## STEP 4 - Reviewer

reviewer 서브에이전트를 실행하세요.

다음 자료를 모두 검토하게 하세요.

.pipeline/spec.md
.pipeline/changes.md
.pipeline/test-results.md
실제 변경 파일

결과를

.pipeline/review.md

에 저장하게 하세요.

## 완료 후

사용자에게 다음 내용만 간단히 보고하세요.

- 변경한 내용
- 테스트 결과
- 최종 판정
- 사용자가 직접 확인해야 할 내용

최종 판정은 반드시 다음 중 하나여야 합니다.

승인
보완 필요
차단

중요:

사용자의 별도 요청이 없다면
git commit, push, 배포는 하지 마세요.
