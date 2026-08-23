# SmartFarmOS 오픈 표준 · Edge 신뢰성 · 보안 조사

- 기준일: 2026-08-12
- 대상: SmartFarmOS TS 모노레포
- 결론 방향: 전부 채택이 아니라, `채택 / 변형 / 보류 / 거부`로 나눠 경계 안에 맞춘다.

## 1. 현재 SmartFarmOS 상태와 조사 목적

현재 SmartFarmOS는 React/TypeScript PWA, Node/TypeScript API, Node/TypeScript Edge Gateway로 이루어진 작은 모노레포다. `services/edge`는 중앙 API에 대한 검증된 HTTP 클라이언트, 장치 실행 경계, 완료된 명령 ACK의 내구성 있는 outbox, 명령 결과 재전송을 갖고 있지만, 텔레메트리 버퍼링, MQTT 어댑터, 다중 게이트웨이 lease, 장치 상태 재조정은 아직 빈칸이다. `packages/contracts`는 농장, 장치, 텔레메트리, 알람, 전략 적용, 명령, ACK의 런타임 스키마와 타입을 담당한다.

이 문서는 SmartFarmOS에 도움이 되는 표준과 오픈소스를 빠르게 거르고, 대회 경계인 2026-08-27 전까지 무엇을 넣고 무엇을 미루고 무엇을 버릴지 판단하는 용도다.

## 2. 결론 요약

### 채택

- **HTTP 기반 중앙 제어 계약과 명시적 ACK**: 이미 있는 명령/ACK 모델을 유지하고, 모든 외부 프로토콜을 내부 HTTP 계약으로 정규화한다.
- **검증된 durable ACK outbox 유지**: 현재 완료 ACK의 내구 저장과 재전송을
  유지한다. 텔레메트리 store-and-forward는 대회 후 별도 정책과 시험이 필요하다.
- **검증된 명령 멱등성 유지, fencing은 향후 원칙**: 재시도와 중복 실행을
  분리하되 lease만으로 mutual exclusion을 주장하지 않는다.
- **타임싱크와 단조 증가 시계 전제**: 명령 타임아웃, 이벤트 순서, ACK 해석에 필요하다.

### 변형

- **MQTT 5**: 대회 후 실제 장비 요구가 있을 때 브로커를 진실 저장소로 두지
  않는 Edge 입력 어댑터로 검토한다.
- **Sparkplug B**: 스키마 힌트는 참고하되, 네이티브 Sparkplug 종속은 피한다.
- **OGC SensorThings / NGSI-LD**: 외부 연계 출력 포맷으로는 유용하지만, 내부 저장 모델로는 과하다.
- **device shadow / twin**: 전체 twin 플랫폼을 붙이지 말고 장치 상태의 최소 그림자만 유지한다.
- **OTA / secure boot / 원격 attestation**: 대회 범위에서는 원칙만 반영하고 실장치는 파일럿 수준에서만 다룬다.

### 보류

- **oneM2M 전체 스택**: 상호운용성은 좋지만 통합 비용이 높다.
- **EdgeX Foundry / ThingsBoard / Mainflux / ChirpStack 전체 채택**: SmartFarmOS를 이들 플랫폼 위로 옮기지 않는다.
- **FIWARE 전체 플랫폼**: 데이터 모델과 NGSI-LD 패턴만 참고한다.

### 거부

- **장치 제어를 PWA가 직접 수행하는 구조**
- **MQTT/OPC UA/Modbus/LoRaWAN 브로커와 API를 한 계층에 혼합하는 구조**
- **중앙 DB를 Edge가 직접 쓰는 구조**

## 3. 표준별 판단

### 3.1 OGC SensorThings API

SensorThings Part 1 Sensing은 관측, 기능, 위치, 관찰 이벤트를 표준화하는 데
좋고 농업 텔레메트리/센서 관점과 잘 맞는다. 다만 SmartFarmOS 내부 모델을
SensorThings로 완전히 치환할 필요는 없다. 내부는 현재 계약을 유지하고,
Part 1 읽기/export profile부터 대회 후 변형 검토한다. OGC 소개와 Tasking Core
문서의 성숙도 표현이 혼재하므로 Tasking을 내부 command 근거로 채택하지 않는다.

- 근거: OGC SensorThings Part 1 1.1. Tasking Core와 STAplus는 범위 확인용 참고.
- 판단: **변형**

### 3.2 MQTT 5 / Sparkplug B

MQTT는 Edge-장치 간 비동기 전달에 유용하지만, 브로커가 곧 시스템의 진실이 되면 복구와 멱등성 관리가 어려워진다. Sparkplug B는 birth/death, metric state, payload 규약이 강점이지만, SmartFarmOS가 곧바로 채택하면 TS 모노레포의 단순성을 잃는다. 따라서 MQTT 5는 어댑터로, Sparkplug는 용어와 운영 패턴 참고 수준으로 둔다.

- 판단: MQTT 5는 **대회 후 변형**, Sparkplug B는 **참고**

### 3.3 OPC UA

산업 장비와의 상호운용성에는 강하지만, 농장 OS의 기본 경로로 두기엔 무겁다. 장비별 게이트웨이 플러그인이나 특정 PLC 연동이 필요한 경우에만 채택하는 편이 낫다.

- 판단: **보류**

### 3.4 Modbus

Modbus는 단순하고 보급이 넓지만 보안과 의미론이 약하다. 기존 센서/릴레이/펌프 연동에서 게이트웨이 어댑터로는 좋다.

- 판단: **채택(어댑터 한정)**

### 3.5 oneM2M

장치, CSE, interworking에 대한 정교한 프레임은 유익하지만, SmartFarmOS의 현재 범위에서는 구현과 운영 복잡도가 높다.

- 판단: **보류**

### 3.6 FIWARE / NGSI-LD

시맨틱한 데이터 모델과 데이터 스페이스 연동은 강점이 있다. 하지만 내부 계약은 더 단순해야 한다. 외부 데이터 허브나 분석 연계에서 NGSI-LD로 변환하는 정도가 적합하다.

- 판단: **변형**

### 3.7 farmOS

농장 자산, 운영 기록, 현장 중심 데이터 모델을 보는 데 가장 직접적인 비교 대상이다. 다만 farmOS는 애플리케이션 성격이 강하고 SmartFarmOS는 실시간 제어/Edge 신뢰성을 더 중시한다.

- 판단: **참조 채택**

## 4. 오픈소스 플랫폼 비교

### EdgeX Foundry

장점: 디바이스 서비스, 코어 서비스, 외부 프로토콜 어댑터가 명확하다.  
단점: SmartFarmOS에 비해 훨씬 크고, 운영 표면이 넓다.  
활동성: 커뮤니티와 릴리스가 계속 있다.  
통합 비용: 높음.

- 판단: **참조만**

### ThingsBoard

장점: 대시보드, 규칙, 장치 관리가 풍부하다.  
단점: SmartFarmOS의 사용자 경험과 계약이 플랫폼 종속으로 기울 수 있다.  
활동성: 상용/오픈소스 모두 활발하다.  
통합 비용: 중간 이상.

- 판단: **참조만**

### Mainflux

장점: IoT 백엔드/메시징 중심 구조가 단순하다.  
단점: SmartFarmOS가 이미 API 중심 구조를 갖고 있어 전면 교체 이점이 적다.  
활동성: 프로젝트는 유지되지만 주력은 플랫폼 자체다.  
통합 비용: 중간.

- 판단: **참조만**

### ChirpStack

장점: LoRaWAN 스택으로 분명하다.  
단점: SmartFarmOS가 지금 당장 LoRaWAN 전용 플랫폼으로 갈 이유는 없다.  
활동성: 활발하다.  
통합 비용: 특정 무선망이 필요할 때만 의미가 있다.

- 판단: **조건부 참조**

## 5. Edge 신뢰성 패턴

### 5.1 Durable outbox

Edge는 명령 완료 ACK와 상태 변경을 즉시 중앙에 의존하지 말고 로컬 내구 저장소에 먼저 기록해야 한다. 이는 네트워크 분리와 재시도를 견디게 한다.

### 5.2 Store-and-forward

텔레메트리는 유실보다 지연이 낫다. 일시 저장 후 전송이 맞다. 단, 큐가 무한히 커지지 않도록 보존 정책이 필요하다.

### 5.3 Command idempotency

명령은 재전송될 수 있으므로 `commandId`와 실행 결과를 분리해 해석해야 한다. 성공/실패/타임아웃/재시도 중복을 같은 이벤트로 보면 안 된다.

### 5.4 Lease / fencing

다중 게이트웨이 환경에서는 동일 장치에 대한 주도권을 한 번에 하나만 가지게 해야 한다. lease 갱신 실패 시 이전 게이트웨이의 후속 실행을 fencing으로 차단해야 한다.

### 5.5 Time sync

명령 타임아웃, ACK 순서, 센서 시계 오차를 다루려면 NTP 계층의 시간 동기와 단조 시간 기준이 필요하다.

## 6. 보안 기준

### 6.1 IEC 62443

IEC 62443은 OT 보안의 분할, 역할, 구성요소 보안 요구를 설명하는 데 적합하다.
zone/conduit의 직접 근거는 IEC 62443-3-2:2020이며, 2-1은 asset owner 보안
프로그램, 3-3은 시스템 보안 요구, 4-1은 secure development lifecycle의
근거로 역할을 구분한다. SmartFarmOS에는 이 사고방식을 적용해 Edge와 PWA,
중앙 API를 분리한다.

- 판단: **채택(원칙)**

### 6.2 NIST SP 800-82 / IoT guidance

ICS/OT 환경의 네트워크 분리, 자산 식별, 원격 액세스 제한, 패치/복구, 로그, 자격증명 관리 원칙은 SmartFarmOS에 직접적이다. IoT용 제품 보안 지침도 장치 신원, 업데이트, 취약점 처리, 안전한 기본 설정을 강조한다.

- 판단: **채택(원칙)**

### 6.3 OTA / secure boot

실장치 파일럿이 생기면 필수지만, 대회 전 범위에서는 설계 원칙과 인터페이스만 남기고 실제 구현은 보류한다.

- 판단: **보류**

## 7. 후보별 활동성·라이선스·통합 비용 메모

- OGC, OPC Foundation, Eclipse Sparkplug, Modbus Association, oneM2M, FIWARE, farmOS, EdgeX Foundry, ThingsBoard, Mainflux, ChirpStack는 모두 공식 문서/원 저장소를 확인했다.
- 2026-08-12의 라이선스·HEAD SHA·최근 릴리스 교차확인은
  [독립 검증 메모](standards-validation.md)에 기록했다. 실제 코드 차용 전에는
  해당 커밋의 라이선스와 호환성을 다시 확인한다.
- 통합 비용은 SmartFarmOS의 현재 크기와 경쟁 일정 기준으로 평가했다.

## 8. 대회 전 로드맵

대회 전에는 새 transport·저장소·플랫폼을 구현하지 않는다.

1. 이미 검증된 장치별 명령 멱등성, execution journal, terminal ACK outbox,
   stop fence를 제출 증거로 고정한다.
2. 텔레메트리 버퍼, lease/fencing, MQTT, 표준 출력은 미구현이라고 명시한다.
3. 내부 핵심 계약은 HTTP/TypeScript 타입으로 유지하고 외부 표준은 향후
   adapter라는 경계만 문서화한다.
4. 실장비 안전, 표준 호환, 물리 exactly-once를 주장하지 않는다.

## 9. 대회 후 로드맵

1. 생산 신원·자격증명과 물리 안전을 먼저 검증한다.
2. 특정 장비군이 정해지면 Modbus, OPC UA, LoRaWAN 중 필요한 transport만
   Edge adapter로 추가한다.
3. 텔레메트리 durable buffer, 장치 상태 재조정, lease/fencing을 단절·복구·
   다중 Edge 시험과 함께 구현한다.
4. 외부 읽기·교환 요구가 생기면 SensorThings 또는 NGSI-LD 변환기를 코어와
   분리해 추가한다.
5. OTA, secure boot, 원격 진단, 취약점 공지 절차를 운영 문서로 굳힌다.
6. farmOS/FIWARE/EdgeX 계열은 실제 상호운용 요구가 생길 때만 별도 서비스로
   연결하며 코어 의존성으로 채택하지 않는다.

## 10. 검증 시나리오

### 현재 회귀로 유지

1. Edge가 네트워크 단절 중에도 명령 완료 ACK를 로컬 outbox에 저장한다.
2. 네트워크 복구 후 ACK가 중복 없이 중앙에 전달된다.
3. 같은 `commandId`를 두 번 보내도 장치 동작은 한 번만 실행된다.

### 대회 후 capability별 acceptance

4. lease가 만료된 오래된 Edge는 후속 명령을 fencing으로 차단당한다.
5. 텔레메트리가 MQTT 입력으로 들어와도 내부 계약 형식으로만 정규화된다.
6. SensorThings 또는 NGSI-LD 변환 출력이 내부 모델과 분리되어 유지된다.

## 11. 참고 출처

1. OGC SensorThings API: https://www.ogc.org/standards/sensorthings/
2. OGC SensorThings Part 1 1.1: https://docs.ogc.org/is/18-088/18-088.html
3. OGC SensorThings Tasking Core: https://docs.ogc.org/is/17-079r1/17-079r1.html
4. STAplus extension: https://www.ogc.org/standards/sensor-things-api-extension/
5. MQTT: https://mqtt.org/
6. Sparkplug specification: https://sparkplug.eclipse.org/specification/
7. Sparkplug v2.2 PDF: https://sparkplug.eclipse.org/specification/version/2.2/documents/sparkplug-specification-2.2.pdf
8. Sparkplug v3.0: https://sparkplug.eclipse.org/specification/version/3.0/
9. OPC UA reference: https://reference.opcfoundation.org/
10. OPC UA landing page: https://opcfoundation.org/about/opc-technologies/opc-ua/
11. OPC UA specs: https://opcfoundation.org/developer-tools/specifications-unified-architecture
12. OPC UA companion specs: https://opcfoundation.org/about/opc-technologies/opc-ua/ua-companion-specifications/
13. Modbus specifications: https://www.modbus.org/modbus-specifications
14. Modbus introduction: https://www.modbus.org/introduction-to-modbus
15. oneM2M specs index: https://specifications.onem2m.org/
16. oneM2M published specs: https://www.onem2m.org/technical
17. oneM2M TS-0013: https://specifications.onem2m.org/ts/ts-0013
18. FIWARE catalogue: https://fiware.org/catalogue/
19. FIWARE Smart Data Models: https://fiware.org/smart-data-models/
20. FIWARE developers tour guide: https://fiware.org/developers/tour-guide/
21. farmOS guide: https://farmos.org/guide/
22. farmOS API docs: https://farmos.org/development/api/
23. EdgeX Foundry GitHub org: https://github.com/edgexfoundry
24. EdgeX getting started docs: https://edgexfoundry.github.io/edgex-docs/2.0/getting-started/Ch-GettingStartedDevelopers/
25. ThingsBoard site: https://thingsboard.io/
26. ThingsBoard GitHub repo: https://github.com/thingsboard/thingsboard
27. Mainflux repo: https://github.com/MainfluxLabs/mainflux
28. ChirpStack repo: https://github.com/chirpstack/chirpstack
29. NIST IoT program: https://www.nist.gov/itl/applied-cybersecurity/nist-cybersecurity-iot-program
30. NIST SP 800-213: https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-213.pdf
31. NIST SP 800-82 Rev.3 final: https://csrc.nist.gov/pubs/sp/800/82/r3/final
32. NIST OT security project: https://csrc.nist.gov/projects/operational-technology-security
33. IEC cyber security: https://www.iec.ch/cyber-security
34. IEC 62443-2-1:2024: https://webstore.iec.ch/en/publication/62883
35. IEC 62443-4-1:2018: https://webstore.iec.ch/en/publication/33615
36. IEC 62443-3-3:2013: https://webstore.iec.ch/en/publication/7033
37. IEC 62443-3-2:2020: https://webstore.iec.ch/en/publication/30727
