# SmartFarmOS 표준 조사 검증 메모

- 검증일: 2026-08-12
- 검증 대상 문서:
  - `docs/research/open-standards-edge-security.md`
  - `docs/research/korea-standards-and-data.md`
- 검증 목적: 공식 표준·정부 문서·원 저장소 기준으로 주요 판단의 최신성, 과장 여부, 충돌, 라이선스/활동성 리스크를 분리한다.
- 반영 상태: 이 메모가 발견한 MQTT, lease/fencing, KS 날짜, IEC 인용 문제는
  2026-08-12 현재 대상 문서에 수정 반영했다. 아래 `수정 반영됨` 항목은 당시
  발견과 해결 근거를 보존한 기록이다.
- 전제: SmartFarmOS의 현재 대회 경계는 Slices A-D 완료 후 Slice E 사용성 검증과 Slice F 제출 준비이며, 실제 MQTT, telemetry offline buffer, multi-gateway lease, 물리 인터록, 실장치 상호운용성은 아직 비주장 범위다.  
  근거: `SmartFarmOS/AGENTS.md`, `docs/plans/contest-mvp-architecture.md`

## 최종 결론

1. `OGC SensorThings`, `Modbus`, `IEC 62443`, `NIST SP 800-82/800-213`을 **원칙·출력 프로파일·어댑터 경계**로 참고하는 방향은 대체로 맞다.
2. `MQTT 5`와 `Sparkplug B/3.0`은 **지금 바로 채택**이 아니라 **변형 또는 대회 후 보류**가 더 정확하다. Sparkplug 3.0은 MQTT 3.1.1과 5.0 둘 다 허용하지만, MQTT 5를 써도 `Clean Start=true`, `Session Expiry Interval=0`을 요구해 broker session을 상태 저장소처럼 쓰지 않는다.  
   출처: https://sparkplug.eclipse.org/specification/version/3.0/, https://docs.oasis-open.org/mqtt/mqtt/v5.0/mqtt-v5.0.html
3. `telemetry store-and-forward`는 패턴 자체는 확인되지만, **TTL·디스크 한도·복구 순서** 없이는 주장하면 안 된다. 정책과 장애 시험 계획을 먼저 세우되 현재 대회가 아니라 대회 후 파일럿에서 진행한다.  
   출처: https://learn.microsoft.com/en-us/azure/iot-edge/offline-capabilities
4. `lease/fencing`은 필요성은 맞지만 **대회 전 구현 권고는 부적절해 대상
   문서에서 대회 후로 수정했다.** etcd 공식 문서도 lease 기반 lock만으로는 mutual exclusion을 보장하지 않는다고 명시한다.  
   출처: https://etcd.io/docs/v3.5/learning/why/
5. 국내 표준 문서의 핵심 방향은 맞지만, `KS X 3265~3267`의 최종 개정
   확인일은 공식 페이지 간 충돌이 있어 대상 문서에서 **단정하지 않도록
   수정했다.** 같은 공식 계열 사이트의 상세 페이지와 RRA 표준 문서는 여전히 `2022-01-11`을 표시한다.  
   출처: https://www.smartfarm-standard.kr/standard/guide/record/index.php?page_num=2, https://www.smartfarm-standard.kr/standard/guide/record/view.php?seq=11, https://www.smartfarm-standard.kr/standard/guide/record/view.php?seq=12, https://www.smartfarm-standard.kr/standard/guide/record/view.php?seq=13
6. `SPS-X KOAT-0009-7470`을 내부 모델 교체가 아니라 **교환 프로파일**로 다루자는 판단은 확인된다.  
   출처: https://www.standard.go.kr/KSCI/ct/ptl/prvntc/curstat/detail.do?currentPageNo=1&grpStdSn=18386&pageSize=10&recordCountPerPage=10&searchText=&searchType=1

## 1. 오픈 표준 · Edge · 보안 문서 검증

| 항목 | 판정 | 검증 메모 | 직접 출처 |
| --- | --- | --- | --- |
| OGC SensorThings를 내부 저장 모델이 아니라 외부 연계/내보내기 포맷으로 쓰자는 판단 | 확인됨 | OGC 공식 페이지는 SensorThings를 `Sensing`과 `Tasking`으로 설명하지만, 같은 공식 안내 안에서도 소개 문단은 Tasking을 future work라고 적고, standards 문단은 `Part 2: Tasking Core 1.0` 문서를 함께 건다. 현재 SmartFarmOS에는 `Part 1: Sensing 1.1` 출력 프로파일만 우선 적용하는 편이 안전하다. Tasking을 내부 command 모델로 끌어들이기엔 공식 설명 자체가 혼재되어 있다. | https://ogcapi.ogc.org/sensorthings/, https://docs.ogc.org/is/18-088/18-088.html, https://docs.ogc.org/is/17-079r1/17-079r1.html, https://www.ogc.org/standards/sensor-things-api-extension/ |
| MQTT 5를 지금 `채택`으로 분류했던 것 | 수정 반영됨 | MQTT 5 자체는 현행 OASIS 표준이 맞다. 다만 Sparkplug 3.0은 MQTT 3.1.1과 5.0 둘 다 허용하고, MQTT 5를 써도 `Clean Start=true`, `Session Expiry Interval=0`을 요구한다. 이는 MQTT broker session을 durable source of truth로 쓰지 말라는 방향과 맞지만, 반대로 SmartFarmOS 대회 MVP에 broker 중심 구조를 넣을 근거도 아니다. 대상 문서는 `대회 후 변형`으로 고쳤다. | https://mqtt.org/mqtt-specification/, https://docs.oasis-open.org/mqtt/mqtt/v5.0/mqtt-v5.0.html, https://sparkplug.eclipse.org/specification/version/3.0/ |
| Sparkplug B/3.0을 스키마 힌트와 운영 패턴 참고 수준으로 두자는 판단 | 확인됨 | Sparkplug 3.0 공식 소개는 v2.2를 formalize하면서 기존 장비를 깨는 새 기능을 넣지 않았다고 밝힌다. 즉 Sparkplug는 payload/topic 규약과 birth/death 운용 규칙의 가치가 크지만, SmartFarmOS 내부 command/ACK 계약을 대체할 수준의 근거는 아니다. | https://sparkplug.eclipse.org/specification/version/3.0/, https://sparkplug.eclipse.org/specification/ |
| Modbus를 장치 transport adapter 한정으로 쓰자는 판단 | 확인됨 | Modbus serial guide는 Modbus를 OSI layer 7의 application layer messaging protocol로 설명하고, serial line에서는 master/slave(client/server) 구조와 RS485 2-wire를 가장 흔한 물리 인터페이스로 둔다. 즉 SmartFarmOS에선 장치 transport/codec adapter 경계로 두는 것이 맞고, 브라우저나 중앙 API의 주계약으로 끌어오면 과도하다. | https://www.modbus.org/modbus-specifications, https://www.modbus.org/introduction-to-modbus |
| OPC UA를 기본 경로가 아니라 장비별 어댑터/후속 파일럿으로 두자는 판단 | 확인됨 | OPC Foundation Online Reference는 published specifications를 part와 companion module 단위로 탐색하게 제공한다. 즉 표준 표면이 넓고 companion model 중심 생태계다. 현재 SmartFarmOS MVP 범위에선 내부 표준으로 채택하기보다 특정 장비 연동이 생길 때 adapter로 붙이는 판단이 맞다. 이 결론의 “무겁다”는 평가는 공식 문서의 광범위한 spec surface에서 도출한 추론이다. | https://reference.opcfoundation.org/, https://opcfoundation.org/developer-tools/specifications-unified-architecture |
| telemetry store-and-forward를 대회 전 로드맵에 넣었던 것 | 수정 반영됨 | store-and-forward 패턴 자체는 확인된다. Microsoft의 IoT Edge offline docs는 parent device가 오프라인 동안 device-to-cloud messages를 저장하고 재연결 후 전달하며, TTL과 disk space를 별도로 조정하라고 안내한다. 다만 SmartFarmOS는 현재 completed ACK outbox만 구현했고 telemetry buffer는 명시적으로 pending이다. 대상 문서는 대회 후 구현으로 고쳤다. | https://learn.microsoft.com/en-us/azure/iot-edge/offline-capabilities, `SmartFarmOS/AGENTS.md`, `SmartFarmOS/docs/plans/contest-mvp-architecture.md` |
| lease/fencing을 대회 전 로드맵에 넣었던 것 | 수정 반영됨 | etcd 공식 문서는 lease 기반 lock APIs가 “mutual exclusion mechanism by themselves”가 아니며, physical TTL 때문에 서버는 lease를 회수했지만 클라이언트는 계속 소유한다고 믿는 상황이 가능하다고 설명한다. revision validation 또는 fencing token류가 함께 있어야 한다. 대상 문서는 post-contest pilot로 고쳤다. | https://etcd.io/docs/v3.5/learning/why/, https://etcd.io/docs/v3.6/dev-guide/api_concurrency_reference_v3/ |
| IEC 62443 zone/conduit 원칙을 적용하자는 판단 | 수정 반영됨 | 방향은 맞다. zone/conduit의 직접 근거인 `IEC 62443-3-2:2020`을 대상 문서 본문과 출처 목록에 추가하고, 2-1·3-3·4-1의 역할을 분리했다. | https://webstore.iec.ch/en/publication/30727, https://webstore.iec.ch/en/publication/62883, https://webstore.iec.ch/en/publication/7033, https://webstore.iec.ch/en/publication/33615 |
| NIST SP 800-82 / IoT guidance를 채택 원칙으로 둔 것 | 확인됨 | `SP 800-82 Rev.3`는 OT security를 다루는 현재 final 문서다. 2026-01-22 기준 Rev.4는 pre-draft call for comments 단계라 아직 설계 기준선으로 삼기엔 이르다. IoT device 요구사항 쪽은 `SP 800-213`이 device capabilities와 organizational expectations를 정리한다. 현재 문서의 방향은 맞지만 Rev.4를 이미 반영된 것처럼 쓰면 안 된다. | https://csrc.nist.gov/pubs/sp/800/82/r3/final, https://csrc.nist.gov/pubs/sp/800/82/r4/iprd, https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-213.pdf |

## 2. 국내 표준 · 데이터 문서 검증

| 항목 | 판정 | 검증 메모 | 직접 출처 |
| --- | --- | --- | --- |
| KS X 3265~3267의 존재와 표준명 | 확인됨 | 표준명 자체와 스마트 온실 sensor/actuator/RS485 Modbus 인터페이스 계열이라는 설명은 공식 페이지에서 확인된다. | https://www.smartfarm-standard.kr/standard/guide/record/index.php?page_num=2, https://www.smartfarm-standard.kr/standard/guide/record/view.php?seq=11, https://www.smartfarm-standard.kr/standard/guide/record/view.php?seq=12, https://www.smartfarm-standard.kr/standard/guide/record/view.php?seq=13 |
| KS X 3265~3267의 `2026-01-19 개정확인` 단정 | 수정 반영됨 | 같은 공식 계열 안에서 충돌이 있다. index 페이지는 `2026.01.19`를 보여주지만, 각 상세 페이지와 연결된 RRA 문서는 `2022-01-11`을 보여준다. 대상 문서는 날짜를 확정하지 않고 충돌 상태를 명시하도록 고쳤다. | https://www.smartfarm-standard.kr/standard/guide/record/index.php?page_num=2, https://www.smartfarm-standard.kr/standard/guide/record/view.php?seq=11, https://www.smartfarm-standard.kr/standard/guide/record/view.php?seq=12, https://www.smartfarm-standard.kr/standard/guide/record/view.php?seq=13, https://www.rra.go.kr/ko/reference/kcsList_view.do?nb_seq=2282&cpage=7&nb_type=6&kcs_select0=ALL&kcs_select1=ALL&kcs_select2=ALL&searchCon=&searchTxt=, https://www.rra.go.kr/ko/reference/kcsList_view.do?nb_seq=2283&cpage=7&nb_type=6&kcs_select0=ALL&kcs_select1=ALL&kcs_select2=ALL&searchCon=&searchTxt=, https://www.rra.go.kr/ko/reference/kcsList_view.do?nb_seq=2284&cpage=7&nb_type=6&kcs_select0=ALL&kcs_select1=ALL&kcs_select2=ALL&searchCon=&searchTxt= |
| KS X 3268, 3269를 data-only metadata 근거로 보자는 판단 | 확인됨 | RRA 표준 자료실은 `KS X 3268 스마트 온실 구동기 메타데이터`, `KS X 3269 스마트 온실 센서 메타데이터`를 국가표준으로 제공하고, 둘 다 디바이스 속성정보/상태정보/메타데이터의 엘리먼트와 구조를 기술한다고 설명한다. command runtime이 아니라 metadata/profile 근거로 읽는 것이 타당하다. | https://www.rra.go.kr/ko/reference/kcsList_view.do?cpage=4&nb_seq=2285&nb_type=6&searchCon=nb_total&searchTxt=&sortOrder=, https://www.rra.go.kr/ko/reference/kcsList_view.do?cpage=4&nb_seq=2286&nb_type=6&searchCon=nb_total&searchTxt=&sortOrder= |
| KS X 3267을 현장 adapter boundary로 보고 브라우저/API 계약으로 올리지 말자는 판단 | 확인됨 | `SPS-X KOAT-0004-7466` 시험방법 문서는 KS X 3267을 센서/구동기 노드와 온실 통합 제어기 간 RS485 Modbus 인터페이스 표준이라고 명시한다. 즉 SmartFarmOS에는 transport/codec adapter와 적합성 fixture의 근거로 쓰는 것이 맞고, PWA/API의 직접 데이터 모델로 채택할 성격은 아니다. | https://www.standard.go.kr/KSCI/ct/ptl/prvntc/curstat/detail.do?currentPageNo=1&grpStdSn=18376&pageSize=10&recordCountPerPage=10&searchText=&searchType=1 |
| SPS-X KOAT-0009-7470을 교환 프로파일로 보자는 판단 | 확인됨 | e-나라표준인증은 이 표준의 최종확인일을 `2025-04-30`로 표시하고, 시설원예 스마트팜의 경영체·시설·영농·환경·제어 정보에 대한 앨리먼트명/타입/단위 규격을 서술한다고 적는다. 이는 내부 도메인 전체 교체보다 import/export mapping과 round-trip validation에 적합하다. | https://www.standard.go.kr/KSCI/ct/ptl/prvntc/curstat/detail.do?currentPageNo=1&grpStdSn=18386&pageSize=10&recordCountPerPage=10&searchText=&searchType=1 |
| 정부 계획이 물리·통신 규격 차이를 문제로 보고 실증 확산을 늘린다는 주장 | 확인됨 | 2026년 스마트농업 육성 시행계획은 “기자재 간 물리적·통신 규격이 달라 농업 현장의 유지보수 어려움 증대”를 적고, 표준적용 기자재 농가 실증지원 목표를 `('25) 159호 누적 -> ('26) 359호 누적`으로 제시한다. | https://www.mafra.go.kr/bbs/home/791/594105/download.do |
| 스마트팜코리아 연계 데이터를 단체표준에 맞게 정비한다는 주장 | 확인됨 | 제1차 스마트농업 육성 기본계획은 시설원예 분야 단체표준으로 `SPS-X KOAT-0009-7470`을 적고, 플랫폼 내 메타데이터·데이터 항목 재정의와 미준수 데이터 변환 지원을 추진한다고 밝힌다. | https://www.mafra.go.kr/bbs/home/792/584835/download.do |
| 공공 데이터 마트를 fixture/analysis 후보로 보는 판단 | 확인됨 | 공공데이터포털 설명은 농가/작기 식별정보와 환경·생육·제어 데이터를 JSON/XML로 제공한다고 밝힌다. 다만 이 페이지는 데이터 품질, 결측률, 샘플링 간격, 재배포 조건까지 증명하지 않는다. 따라서 학습/제어 주장 근거가 아니라 import DTO, fixture, 통계 검토용 후보로 제한해야 한다. | https://www.data.go.kr/data/15121334/openapi.do |

## 3. 충돌 해결

### 3.1 KS X 3265~3267 날짜 충돌

- `smartfarm-standard` index: `2026.01.19` 표시
- 같은 사이트 상세 페이지: `최종 개정 확인일 2022-01-11`
- 연결된 RRA 표준 문서: `제개정일 2022-01-11`

해결 원칙:

1. 현재 확보한 공식 근거만으로는 `2026-01-19`를 확정 사실로 쓰지 않는다.
2. 문서에는 “공식 페이지 간 날짜 충돌이 있어 재확인 필요”라고 적는다.
3. 대회 제출물에서는 **표준 존재와 방향성만 주장**하고, 최신 재확인 연월일까지 강하게 말하지 않는다.

### 3.2 OGC SensorThings Tasking의 성숙도 표현

- 공식 소개 문단은 Tasking을 future work라고 적는다.
- 같은 공식 문서 목록은 `Part 2: Tasking Core 1.0`을 링크한다.

해결 원칙:

1. 현재 SmartFarmOS 문맥에서는 `Part 1: Sensing 1.1` 출력 프로파일만 채택 근거로 둔다.
2. Tasking은 “존재는 확인되지만 현 문서만으로는 내부 command 모델 채택 근거가 충분하지 않다”고 정리한다.

### 3.3 MQTT 5와 Sparkplug의 관계

- MQTT 5는 최신 OASIS 표준이다.
- Sparkplug 3.0은 MQTT 3.1.1과 5.0을 모두 허용한다.
- 그러나 Sparkplug 3.0은 MQTT 5 사용 시에도 `Clean Start=true`, `Session Expiry Interval=0`을 요구한다.

해결 원칙:

1. “MQTT 5니까 durable broker state를 쉽게 얻는다”는 식의 추론은 금지한다.
2. SmartFarmOS에서는 MQTT를 edge adapter ingress/egress로만 다루고, command truth는 기존 HTTP/TypeScript 계약과 Edge journal/outbox에 둔다.

### 3.4 lease만으로 충분하다는 뉘앙스

- etcd 공식 문서는 lease-based lock APIs만으로는 mutual exclusion을 보장하지 않는다고 명시한다.

해결 원칙:

1. 문서에서 `lease`와 `fencing`을 분리해 적는다.
2. post-contest pilot에서 revision validation 또는 fencing token 설계를 함께 검토한다.

## 4. 오픈소스 후보 활동성 · 라이선스 · 기본 판단

아래 정보는 `gh api`로 2026-08-12에 확인했다.

| 후보 | 라이선스 | HEAD SHA 고정 링크 | 최근 릴리스 | 판정 |
| --- | --- | --- | --- | --- |
| farmOS | GPL-2.0 | https://github.com/farmOS/farmOS/commit/3fe0ce7e23de807be9b8bc97a211ce934327db39 | 4.0.4 (2026-07-16) https://github.com/farmOS/farmOS/releases/tag/4.0.4 | 운영 데이터 모델과 현장 기록 UX는 참고 가치가 크다. 다만 copyleft라 코드 차용은 신중해야 하고, 실시간 제어 kernel로 들여오기는 부적합하다. |
| ThingsBoard | Apache-2.0 | https://github.com/thingsboard/thingsboard/commit/684f92bbfd0cf48015b6e42f5592bc0c2fc18038 | v4.3.1.3 (2026-06-30) https://github.com/thingsboard/thingsboard/releases/tag/v4.3.1.3 | 활발하지만 플랫폼 표면이 매우 크다. 대회 전 채택 대상이 아니라 대시보드/규칙엔진 참고용이다. |
| Mainflux | Apache-2.0 | https://github.com/MainfluxLabs/mainflux/commit/c18b8f41a4878fb9ab5818709fcacbab0dcc4684 | v0.41.1 (2026-07-24) https://github.com/MainfluxLabs/mainflux/releases/tag/v0.41.1 | 메시징/identity/backend 분리는 참고할 수 있으나, SmartFarmOS MVP를 이 위로 옮길 이유는 약하다. |
| ChirpStack | MIT | https://github.com/chirpstack/chirpstack/commit/8c30625090aa9f5e14783cf380d9a3e6d42907e8 | v4.19.1 (2026-08-04) https://github.com/chirpstack/chirpstack/releases/tag/v4.19.1 | LoRaWAN pilot이 열릴 때만 의미가 크다. 현재 대회 범위에는 과하다. |
| EdgeX Foundry (`edgex-go`) | Apache-2.0 | https://github.com/edgexfoundry/edgex-go/commit/2bee238e8510a15974a23743e1f7ddd35801407b | v4.0.2 (2026-05-29) https://github.com/edgexfoundry/edgex-go/releases/tag/v4.0.2 | 디바이스 서비스/프로토콜 어댑터 분리는 유익하지만, 플랫폼 전체 채택은 대회 일정과 맞지 않는다. |
| Eclipse Tahu | EPL-2.0 | https://github.com/eclipse-tahu/tahu/commit/5736e404889d4b95910613040a99ba79589ffb13 | GitHub Releases 없음 | Sparkplug 공식 구현 참고용이다. 다만 GitHub API 기준 default branch HEAD commit은 2023-11-06으로 오래됐고 release 메타데이터도 비어 있다. 참고는 가능하지만 핵심 의존성으로 삼기엔 활동성 판단이 애매하다. |
| FIWARE Orion-LD | AGPL-3.0 | https://github.com/FIWARE/context.Orion-LD/commit/5f8b1fd730f50eed138abcddb37f426127462bc2 | 1.12.0 (2026-01-28) https://github.com/FIWARE/context.Orion-LD/releases/tag/1.12.0 | NGSI-LD/context broker 실험에는 적합하지만 AGPL-3.0과 플랫폼 복잡도를 고려하면 MVP 내장 대상은 아니다. export/interop lab 수준이 적절하다. |

## 5. 대회 전 권고

### 확인됨

- `SensorThings Part 1 export profile`
- `KS/SPS 표준을 내부 계약이 아니라 mapping profile로 다루는 방향`
- `Modbus를 edge transport adapter로 한정`
- `IEC 62443 + NIST를 설계 원칙으로만 적용`

### 수정 반영됨

- `MQTT 5는 채택` → `변형 또는 대회 후 보류`
- `Sparkplug는 바로 채택 가능한 내부 규약`처럼 읽히는 표현 → `interoperability profile 참고`
- `lease/fencing 대회 전 구현` → `post-contest pilot ADR/test plan`
- `KS X 3265~3267 최종 개정 확인일 2026-01-19` 단정 → `공식 페이지 간 충돌`
- `zone/conduit` 설명에 `IEC 62443-3-2:2020` 누락

### 미확인

- KS 원문 전문의 필수/선택 조항과 레지스터 세부
- 실제 표준 기자재 상호운용성
- 데이터 마트 API의 실제 응답 품질, rate limit, 라이선스/재배포 조건
- Sparkplug 구현체 간 실운영 호환성

## 6. SmartFarmOS 최종 권고

1. **2026-08-27 대회 전**
   - 문서 표현만 고친다.
   - `MQTT`, `telemetry buffer`, `active-active lease`, `실장비 KS 적합성`은 구현 약속으로 올리지 않는다.
   - telemetry retention, future lease/fencing ADR, KS/SPS mapping은 대회 후
     실제 장비·운영 요구가 정해질 때 작성한다.

2. **대회 후 pilot**
   - telemetry store-and-forward
   - fenced single-owner execution
   - 선택 장비군용 Modbus/KS adapter
   - SensorThings 또는 NGSI-LD export adapter
   - 독립 적합성/실증 시험

3. **제출 문구**
   - “국내 표준과 연결 가능한 edge adapter 구조”
   - “표준 데이터 교환 프로파일 확장 가능”
   - “MQTT, multi-gateway lease, 실장비 적합성은 post-contest pilot gate”
