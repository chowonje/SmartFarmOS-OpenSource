# Slice F 제출 체크리스트

이 체크리스트는 공식 제출 포털 양식을 대체하지 않는다. 현재 표시는
저장소의 실제 상태이며, 증거 없이 완료로 바꾸지 않는다.

공개 소스 전환과 대회 제출 완료는 다른 게이트다. 자격 증명, 출처·권리,
프로젝트 라이선스, Git 재현성, privacy는 공개 소스 전환 전에도 닫혀야 한다.
사용성 세션, AI 고지, 보고서, 영상은 대회 제출 완료 게이트다. 기능 검증
PASS는 두 범주 어느 쪽도 자동으로 승인하지 않는다.

## 현재 판정

| 게이트 | 현재 상태 | 통과 증거 |
| --- | --- | --- |
| 기능·회귀 검증 | PASS | 2026-08-24 `SMARTFARM_REQUIRE_BROWSER=1 npm run verify`, workspace 테스트 304개 + 제출/도구 테스트 80개(총 384), Chrome 브라우저 스모크 |
| 실제 농업 사용자 검증 | BLOCK | 3–5명 익명 세션과 `smartfarm.usability-summary.v1` PASS |
| 자격증명 회전 | BLOCK | [credential-rotation.md](../credential-rotation.md) 모든 owner item 완료 |
| 코드 작성자·중복수혜 | PASS | 2026-08-24 소유자 확인: 기존·현재 코드 단독 작성, 동일 성과 중복수혜 없음 |
| 기존 성과·저작권 출처 | BLOCK | 단독 작성은 확인됨; 교육기관·기간·계약 제한·제3자 자산·신규 범위 기록 필요 |
| 오픈소스 라이선스 | PASS | 소유자 선택 Apache-2.0, 루트 `LICENSE`와 package metadata |
| AI 사용 고지 | BLOCK | 소유자가 실제 사용 범위를 검토한 최종본 |
| 개발/결과보고서 | BLOCK | 공식 DOCX/PDF 초안의 placeholder 제거·본문 5쪽·동일 내용 확인·수치/라이선스 확정 |
| 3분 이내 시연영상 | BLOCK | 검토된 영상의 길이·SHA-256 로컬 증거 |
| Git 재현성·공개 | BLOCK | 최종 commit push, Public 대표 저장소, fresh clone 검증, 보고서의 commit/ref 기록 필요 |
| 공개 파일 선별 | BLOCK | `.codex/` 5개는 로컬 보존·Git 추적 해제 완료. 최초 커밋에는 남아 있어 해당 커밋을 노출하지 않는 공개 이력 확정 필요 |
| 중복수혜 확인서 | PASS | 중복수혜 없음으로 소유자 확인; 사실이 바뀌지 않는 한 ZIP에 포함하지 않음 |
| ZIP·포털 완료 | BLOCK | 원본+동일 PDF+(해당 시 중복수혜 확인서) ZIP, `제출 완료` 상태와 완료 이메일 |
| 개인정보·비밀정보 사전점검 | BLOCK | 2026-08-24 공개 후보 271개 전체 점검: 고신뢰 API 키·개인키와 Git 이력 시그니처 0, PNG 3개 메타데이터 없음. 일반 휴리스틱의 `credential_assignment` 12건은 코드/테스트 오탐으로 검토했지만 raw 보고서는 BLOCK, WARN 1176건, `opf` 미설치 |

기계적으로 끝난 항목만 따로 보려면 [non-human-readiness.md](./non-human-readiness.md)를 본다.

## 실행 순서

1. 새 세션은 `npm run demo:usability -- S01`처럼 시작한다.
2. 세션별 Markdown 관찰표는 로컬에만 두고,
   `npm run usability:record -- S01`로 비식별 결과만 저장한다.
3. `npm run usability:summarize`로 안전 가드레일과 완료율을 집계한다.
4. 로컬 privacy preflight를 다시 실행하고 BLOCK을 0으로 만든다.
5. `npm run submission:license-audit`로 현재 155개 외부 패키지의 라이선스
   선언 누락이 없는지 확인한다. 프로젝트 소스는 Apache-2.0으로 확정했으며,
   외부 자료·의존성 호환성과 AI 고지는 별도로 검토한다.
6. 필요하면 `npm run submission:video-draft`로 실제 PWA의 무음·자동 자막
   후보를 먼저 만든다. 이 후보는 검토 완료 증거가 아니므로
   [demo-rehearsal.md](./demo-rehearsal.md)로 180초 이내 영상을 두 번 이상
   리허설하고, 편집·나레이션을 포함한 최종 파일을 사람이 검수한 뒤 아래
   명령으로 증빙을 만든다.

   ```bash
   npm run submission:video-proof -- artifacts/submission/smartfarm-demo.mp4 --reviewed
   ```

7. 최종 커밋을 대표 공개 저장소에 push한 뒤 별도 fresh clone에서
   `npm ci`, `SMARTFARM_REQUIRE_BROWSER=1 npm run verify`,
   `npm run submission:license-audit`를 실행한다.
8. `.codex/`는 공개 제외로 결정했다. 로컬 파일은 보존하면서 Git 추적을
   해제하고, 최초 커밋에 남은 `.codex/`를 포함하지 않는 공개 이력을 확정한다.
9. 공식 결과보고서 원본과 동일 PDF만 ZIP에 넣는다. 소유자 확인상 중복수혜가
   없으므로 사실이 바뀌지 않는 한 중복수혜 확인서는 넣지 않는다.
10. 포털에서 업로드 후 `출품작 제출 완료하기`를 누르고, 화면의 `제출 완료`
   상태와 안내 이메일을 모두 확인한다.

## 소유자에게 필요한 최소 확인

- 참가 접수번호·팀명·참가부문·인원·과제유형을 공식 접수 정보와 동일하게
  확인하고, 포털의 ZIP 파일명·용량 제한을 확인한다.
- [provenance.md](../provenance.md)의 교육기관·기간·기여자·재사용 제한·
  중복 지원·신규 개발 범위는 실제 기록으로 직접 채운다. 이름이나 계약
  세부정보를 채팅에 공유할 필요는 없다.
- 자격증명은 값이 아니라 provider, 회전 여부·날짜, 검증 책임자와 결과만
  기록한다.
- 프로젝트 소스 라이선스는 Apache-2.0으로 확정했다. 외부 의존성·자료는
  각자의 라이선스와 이용 조건을 유지한다.
- 78초 후보 전체를 보고 최종 영상인지 확인하고, 실제 3–5명 익명 사용성
  세션을 진행한다. 자동 테스트나 내부 리허설을 참가자 증거로 바꾸지 않는다.
- 코딩 보조 AI만 사용한 경우 붙임 2 포함 여부를 사무국에 서면 확인한다.
- 기존·현재 코드의 단독 작성과 중복수혜 없음은 2026-08-24 소유자 확인으로
  기록했다. 교육기관·기간·계약 제한과 제3자 자산은 별도로 확인한다.

## 절대 금지

- 실제 비밀키, 서비스 계정, 농장명, 참가자 이름·연락처를 보고서나
  영상에 노출하지 않는다.
- 시뮬레이터 결과를 실제 장치 실증으로 표현하지 않는다.
- 시뮬레이터 장치 로컬 시간제 종료를 물리 인터록, 실장비 자동 정지,
  MQTT, 생산 인증으로 주장하지 않는다.
- `WARN`/`BLOCK`을 문서에서 숨기거나 수동으로 PASS로 바꾸지 않는다.
