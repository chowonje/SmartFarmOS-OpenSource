# Non-Human Readiness

기준 증거: 2026-08-24에 실행한 `SMARTFARM_REQUIRE_BROWSER=1 npm run verify`,
`npm run submission:license-audit`, `npm audit --audit-level=moderate` 및
privacy preflight. 최신 `npm run submission:rehearse`는 2026-08-10에 실행했다.

이 문서는 사람 검토가 필요한 게이트를 완료로 바꾸지 않는다. 자동화나
로컬 파일 증거만으로 확인 가능한 항목만 분리한다.

## 현재 완료된 항목

| 항목 | 상태 | 증거 |
| --- | --- | --- |
| 전체 저장소 검증 | PASS | `npm run verify` 통과 |
| 제품 테스트 | PASS | workspace 테스트 304개 통과 |
| 제출/도구 게이트 테스트 | PASS | Node TAP 테스트 89개 통과 |
| 브라우저/PWA 스모크 | PASS | `smoke:pwa`, `smoke:pwa:browser` 통과 |
| 날씨 vertical slice | PASS | 농장 범위 계약/API/PWA fixture 흐름과 live adapter mock 경계 통과 |
| 클라우드 파일럿 패키징 | PASS | 인증·비밀값·볼륨·공개 포트 정적 검증 7개 통과; 실제 Docker 기동은 미검증 |
| 시뮬레이터/API/Edge/SQLite 스모크 | PASS | `smoke:simulator`, `smoke:api`, `smoke:edge`, `smoke:persistence` 통과 |
| 외부 의존성 라이선스 선언 검사 | PASS | 155 external package entries, 누락 0 |
| 프로젝트 라이선스 파일 | PASS | 소유자 선택 Apache-2.0, 루트 `LICENSE`와 package metadata |
| 의존성 보안 권고 시점 검사 | PASS | 2026-08-24 별도 `npm audit --audit-level=moderate`에서 0 vulnerabilities; `npm run verify`와 CI에는 포함되지 않음 |
| 제출 필수 문서 존재 | PASS | `official-requirements`, `release-checklist`, `result-report`, `demo-rehearsal`, `presentation-outline`, `ai-use-disclosure` 존재 |
| identifiable Git commit | PASS | canonical origin에 식별 가능한 초기 baseline 커밋 존재 |
| canonical Git origin | PASS | `submission:rehearse`에서 `git.origin` PASS |
| 무음 후보 영상 생성물 | PASS | `artifacts/submission/smartfarm-demo-candidate.mp4` 존재 |

## 아직 남은 비인간 항목

| 항목 | 상태 | 남은 일 |
| --- | --- | --- |
| privacy preflight 정리 | BLOCK | 2026-08-24 공개 후보 271개에서 고신뢰 API 키·개인키와 현재 Git 이력 시그니처 0. 휴리스틱 `credential_assignment` 12건은 코드/테스트 오탐으로 검토했지만 raw BLOCK, WARN 1176건, `opf` 미설치 상태 |
| clean worktree | BLOCK | 현재 기능·공개 저장소 준비 변경분이 아직 커밋되지 않음 |

## 사람 확인이 필요한 별도 게이트

아래 항목은 이 문서에서 진행 완료로 올리지 않는다.

- 실제 3–5명 사용성 세션
- prior-work provenance 확정
- 자격증명 회전 owner 확인
- AI 사용 고지 최종 승인
- 결과보고서 최종화
- 최종 영상 검수와 `video-proof`
- 공식 포털 양식 확인

## 메모

- 최신 리허설 보고서는 `artifacts/submission/rehearsal/report.md`에 있다.
- 최신 전체 공개 후보 privacy 수치는 `artifacts/privacy-preflight-publication-20260824/report.md` 기준이다.
- 총 기계 테스트 수는 `304 + 89 = 393`이다.
