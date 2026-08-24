# SmartFarmOS 개발/결과보고서 초안

최종화 게이트: `PENDING_FINALIZATION`

2026-08-06 공식 출품작 제출 가이드와 공식 DOCX 양식을 확인했다. 이
Markdown 문서는 공식 양식에 넣을 내용의 기준 초안이며, 실제 제출본은
본문 5쪽 이내의 DOCX 원본과 동일 PDF로 만든다. 접수 정보, 공개 저장소,
YouTube 영상과 접수 정보는 소유자 확인 전까지 추정하지 않는다. 프로젝트
소스 라이선스는 Apache-2.0으로 확정했으며 권리·출처의 남은 항목은 구분한다.

## 1. 프로젝트 요약

SmartFarmOS는 중소형 온실 운영자가 작물별 재배 구역의 현재 상태와 이력을
비교하고, 임계치 이상을 확인하며, 검토된 관수 전략의 Edge 명령 결과와
감사 기록을 한 흐름에서 확인하는 운영 콘솔이다. 프로젝트 소스에는
Apache-2.0을 적용했으며, 계약·제3자 자산·자격증명·privacy 확인 후 공개한다.

대회 출품분은 로컬 API, SQLite, HTTP Edge Gateway, 2개의 결정적 simulator,
설치 가능 PWA로 구성된다. 실장비 제어기나 Priva의 비공개 프로토콜을
복제한 제품으로 소개하지 않는다.

## 2. 해결하는 문제

- 구역별 센서 값이 흐트러져 있어 어느 구역이 우선인지 판단하기 어려움
- 알람 확인, 제어 요청, 장치 응답, 처리 주체가 한 기록으로 연결되지 않음
- 네트워크 장애 시 접수된 제어를 중복 실행하거나 완료로 오인할 위험
- 기존 교육 프로젝트의 모니터링/제어 아이디어를 구축·검증 가능한
  신규 제품 경계로 분리할 필요

## 3. 구조

```text
Device Simulator
  -> Edge Gateway (exact credential scope / expiry / idempotency / execution journal / ACK outbox)
  -> Central API (auth / contracts / commands / alarms / audit)
  -> SQLite (restart persistence)
  -> Installable PWA (desktop / mobile / same-session offline shell + cached read-only state)
```

브라우저는 장치·DB 자격증명을 갖지 않고 중앙 API만 호출한다. 공유
계약은 알 수 없는 필드를 거부하고, 모든 제어는 farm/device scope, 만료,
멱등성, ACK 결과를 갖는다.

## 4. 주요 시나리오

1. 활성 작물 주기의 2개 베드에서 온도·습도·조도·수위의 현재값과 최근
   24개 이력을 비교한다.
2. 2번 베드 저수위가 기준을 벗어나면 하나의 알람을 열고, accepted
   telemetry에서만 update/clear를 평가한다.
3. 사용자가 알람을 확인하면 멱등적 acknowledgement와 actor/time audit을 남긴다.
4. 승인된 저수위 회복 V2 전략은 대상별 수위/알람 근거, 5초 장치 로컬
   종료, 물리 인터록 미검증을 재확인한 후에만 적용된다.
5. 시뮬레이터가 최종 `off` 뒤 반환한 대상별 command ACK를 집계해
   succeeded/partial/failed를 보여주고, 제출 후
   확인을 초기화해 우발적 반복을 막는다.
6. Edge는 최종 ACK를 중앙 전송 전에 별도 SQLite에 저장한다. 업로드 실패나
   Edge 재시작 뒤에는 장치를 다시 실행하지 않고 저장된 ACK 원문을 먼저
   전송한다. 결과 없이 `executing`만 남은 경우에는 자동 재실행을 차단한다.
7. 시간제 관수 중 기존 V1 `off`를 보내면 독립 Edge stop lane이 시뮬레이터를
   즉시 `off`로 전환한다. 원래 관수는 정상 완료가 아니라
   `failed/manual_stop`과 연결된 정지 명령 ID로 남고, 정지 전 대기하던 가동
   명령은 재시작 후에도 stop fence가 거절한다. 이는 소프트웨어 데모 경로이며
   물리 비상정지나 인터록이 아니다.
8. 전략 밖에서 사용자가 직접 요청한 펌프 명령은 terminal ACK와 같은 중앙
   트랜잭션에서 `cycleId: null` AuditEvent V2를 하나 남긴다. PWA는 이를
   선택 재배주기에 잘못 귀속하지 않고 `농장 공통 제어`로 보여준다.
9. Edge 인증 결과는 정확한 `(farmId, deviceId)` 허용 쌍을 가져야 한다.
   다른 같은-농장 장치의 telemetry/pull/stop/ACK 요청은 저장소 접근 전에
   거절하며, 로컬 데모는 장치마다 별도 내부 키를 사용한다.

## 5. 검증 결과

- `npm run verify`: build, typecheck, workspace test, simulator/API/Edge/SQLite/PWA smoke,
  실제 Chrome 흐름 통과
- SQLite schema 1→8, 2→8, 3→8, 실제 alarm-only 4→8, 5→8, 6→8,
  7→8 보존 migration 검증
- 별도 Edge SQLite v1의 exact replay/conflict, ACK 전송 실패→재시작 복구,
  불명확 실행 no-replay, 손상/미래 버전 실패 폐쇄 검증
- same-farm 다른 장치의 telemetry, normal/stop pull, ACK를 exact Edge scope로
  `403` 거절하고 명령·감사 상태가 변하지 않음을 검증
- 실제 브라우저에서 알람 발생→확인→clear→감사, 오구역 경고→확인→
  관수 적용→poll 실패→복구→ACK/audit, 실행 중 software stop→causal history,
  수동 ACK→`농장 공통 제어` 감사,
  mobile/same-session offline 보존 통과
- 현재 workspace 테스트 304개와 제출/도구 게이트 스크립트 테스트 89개,
  총 393개 기계 테스트를 2026-08-24 `SMARTFARM_REQUIRE_BROWSER=1 npm run verify`에서 다시 확인
- package-lock v3의 외부 패키지 155개 모두에서 선언 라이선스를 확인함.
  이는 선언 누락 검사이며 프로젝트 라이선스 선택·호환성 승인은 아님
- 2026-08-24 별도 `npm audit --audit-level=moderate`에서 알려진 vulnerability 0개를 확인함.
  이 시점 검사는 네트워크 독립적인 `npm run verify`나 CI 계약에는 포함되지 않음
- 새 임시 DB의 실제 PWA 장면을 검증해 H.264/AAC 1280×720 무음 후보를
  생성하는 로컬 도구를 확인했으며, 실제 실행에서는 78초 후보가 생성됨.
  이는 최종 인간 검토나 제출 영상 증빙을 대신하지 않음
- 2026-08-24 공개 브랜치의 tracked 파일 273개 중 텍스트 파일 270개를 점검했다.
  고신뢰 API 키·개인키 시그니처와 공개 이력의 실제 비밀값은 발견하지 못했고,
  스캔에서 제외된 PNG 3개에도 텍스트·EXIF 메타데이터 청크가 없었다. 일반 휴리스틱은
  gateway credential 타입·발급·전달 코드와 테스트 12건을 candidate BLOCK으로
  보고해 모두 오탐으로 검토했지만, `opf` 미설치와 1,100건 이상의 광범위한
  수치·연락처 패턴 WARN 때문에 raw privacy 보고서는 BLOCK 상태다
- 실제 농업 종사자/도메인 대리 사용자 결과: **아직 없음**

## 6. 기존 성과와 신규 개발분

기존 `MyApp`, `api`, `resberrypi`는 외부 서비스와 로컬 환경을 포함한 교육
프로젝트 입력으로 보존했고 새 저장소에 복사하지 않았다. 이전 UX/기능은
참조했지만 공유 계약, TypeScript API·Edge, SQLite migration, module kernel, 2구역
simulator, PWA, 결정적 검증은 새 경계에서 작성했다.

프로젝트 소유자는 2026-08-24 기존·현재 코드를 단독 작성했고 동일 성과의
중복수혜가 없다고 확인했다. 이후 확인된 모두의 AI 실험실 무상 클라우드
자원의 현물성 공공지원 해당 여부는 운영사 답변으로 분류한 뒤 확인서 제출
여부를 정한다. 교육기관, 기간, 계약상 재사용 제한, 제3자 자산, 신규 커밋
범위는 [provenance.md](../provenance.md)의 남은 증거를 확인한 후 최종
보고서에 적는다.

## 7. 한계와 다음 게이트

현재 제품은 simulator-backed contest MVP다. 다음 항목은 실제 농장용 완료
증거가 아니라 대회 이후 파일럿 게이트다.

- OIDC/OAuth2 생산 인증과 조직/사이트 RBAC
- MQTT TLS, topic ACL, telemetry offline queue, multi-gateway lease,
  실행 도중 장치 상태 조회·복구
- 물리 인터록, 비상정지, 실장비 로컬 타이머·자동 종료, 실장비 수동 우선권
- 실장비/현장 시험, 백업·복구, 다중 인스턴스 DB, realtime delivery

## 8. 최종화 조건

- [ ] 실제 사용성 집계 수치를 5절에 반영했다.
- [ ] 단독 작성·Apache-2.0 선택을 확인했고, 무상 클라우드 자원의
  중복수혜 확인 대상 여부를 운영사 답변으로 분류했다.
- [ ] 자격증명·계약 제한·제3자 자산·AI 사용 검토를 완료했다.
- [x] 공식 서식의 구조로 DOCX/PDF 비업로드 초안을 만들었다.
- [ ] DOCX/PDF의 모든 placeholder를 소유자가 확인한 사실로 교체했다.
- [ ] 본문 5쪽 이내, 원본·PDF 동일 내용, 안내/회색 가이드 삭제를 확인했다.
- [ ] `PENDING_FINALIZATION`을 제거하고 최종 영상·소스 커밋과 수치가 일치한다.
