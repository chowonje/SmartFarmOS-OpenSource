# SmartFarmOS 공개 제어이론·시설원예 운용 연구

- 조사 기준일: 2026-08-12
- 조사 범위: 공개 논문, 정부·표준 문서, 대학/연구기관 확장자료, 공개 제품 매뉴얼
- 프로젝트 맥락: [SmartFarmOS 아키텍처](../architecture.md), [기능 격차](../feature-parity.md), [Priva 벤치마크](../benchmarks/priva-one.md)
- 주의: 이 문서는 공개 원리만 다룬다. 상용사 비공개 알고리즘, 독점 프로토콜, 특정 회사의 숨은 제어 로직은 추정하지 않는다.

## 1. 한 줄 결론

SmartFarmOS는 대회 전에는 현재 구현된 `관측 -> 운영자 확인 -> TTL/감사/정지
우선이 있는 안전한 실행` 경계를 고정한다. 규칙·모델 기반 권고와 기후·관수의
자동 폐루프 제어, MPC, 디지털 트윈 기반 자율 최적화는 공개 근거는 충분하지만
현재 코드베이스의 미구현 공백(MQTT 오프라인 텔레메트리, 장치 상태 재조정,
다중 Edge 소유권, 생산 인증, 물리 안전)을 넘어서므로 대회 후 그림자로 먼저
검증한다.

## 2. 현재 SmartFarmOS 경계에서 출발해야 하는 이유

[현재 아키텍처](../architecture.md)는 이미 `PWA -> 중앙 API -> Edge -> 장치/시뮬레이터`와 명령 만료, ACK 저널, software stop, crop cycle, growing area, irrigation strategy, audit event를 갖고 있다. 반면 [남은 기능 격차](../feature-parity.md)는 물리 인터록, 실장비 상태 재조정, MQTT 보안/버퍼링, 생산 인증, 상호운용성 쪽에 몰려 있다.

이 구조는 상용 greenhouse controller를 새로 만드는 것보다 대회 후 다음 두
단계를 먼저 검증하라는 뜻이다. 현재 대회 전에는 기존 범위와 제출 증거를
고정한다.

1. 센서와 전략 근거를 신뢰할 수 있게 만든다.
2. 그 근거를 설명 가능한 권고와 승인형 실행으로 연결한다.

## 3. 공개 자료에서 반복 확인된 운영 원리

### 3.1 기후 제어는 RH보다 작물-위치 기준 VPD와 환기/에너지 균형이 더 중요하다

[NCERA greenhouse guidelines](https://www.controlledenvironments.org/wp-content/uploads/sites/6/2017/05/Greenhouse-Guidelines.pdf)는 센서 배치와 교정, CO2, 수분, 영양을 함께 다루며 대부분 작물에서 RH 50~80%, VPD 0.8~1.0 kPa를 실험 보고의 대표 범위로 제시한다. 같은 문서는 RH보다 VPD가 온도 독립성이 높고 작물 증산과 결로 위험을 더 직접 반영한다고 설명한다. 이는 대회 후 실제 센서·품질 모델과 versioned 계약을 갖춘 뒤 `VPD 계산값 + 신선도 + 결로 위험`을 검토할 근거다. 현재 대회 UI에 추가하라는 권고는 아니다.

[Oklahoma State의 CO2 보충 문서](https://extension.okstate.edu/fact-sheets/print-publications/hla/greenhouse-carbon-dioxide-supplementation-hla-6723-a.pdf)는 CO2 보충이 잎 경계층까지 도달하도록 분배와 공기 흐름이 중요하다고 설명하고, 작업자 안전 때문에 8시간 5,000 ppm, 10분 ceiling 30,000 ppm, 20,000 ppm 초과 구역 재진입 금지를 함께 적는다. [OSHA CO2 hazard bulletin](https://www.osha.gov/publications/hib19960605)도 CO2가 공기보다 무거워 저지대에 축적될 수 있고, 감지·환기·경고 표지가 필요하다고 경고한다.

또한 [UAF Cooperative Extension](https://www.uaf.edu/ces/publications/database/gardening/controlling-greenhouse-environment.php)는 풍속 증가가 난방 요구량을 크게 키우며, 피복재·이중막·열 차단재·방풍의 영향이 크다고 설명한다. 즉 SmartFarmOS의 에너지 해석은 "실내 setpoint만 맞추는 제어"가 아니라 외기 풍속·복사·스크린 상태를 포함한 손실 구조를 봐야 한다.

### 3.2 관수·양액은 "한 번 많이"보다 "작게 자주, 배지별 다르게, 배액까지 같이 보기"가 기본이다

[FAO greenhouse vegetable crops 지침](https://openknowledge.fao.org/server/api/core/bitstreams/3b27458c-b392-4a7b-87bd-d2c2f6577a68/content)과 [FAO 소개 페이지](https://www.fao.org/agriculture/crops/publications/detail/en/item/276049/icode/?no_cache=1)는 지중해권 greenhouse에서 관수 계획을 일사·ET와 센서로 보정하는 방식을 권장한다. 특히 substrate 재배는 루트존 용적이 작고 염류 축적에 민감해 소량·다회 급액과 배액 관리가 핵심이며, 공개 문헌상 open substrate 시스템은 염 축적 방지를 위해 대체로 20~40% leaching fraction을 사용한다.

[WUR 연구 포털의 Incrocci 등 논문 요약](https://research.wur.nl/en/publications/substrate-water-status-and-evapotranspiration-irrigation-scheduli/)은 타이머 기반 관수보다 substrate water status 또는 ET 기반 스케줄링이 물 사용을 21~40%, 양분 배출을 39~74% 줄였고 품질 저하는 없었다고 보고한다. 이 결과는 SmartFarmOS가 대회 후 "완전 자동 급액"으로 바로 가기보다 먼저 `타이머 대비 더 나은 권고 엔진`을 만드는 근거가 된다.

[MDPI의 Irrigation of Greenhouse Crops 리뷰](https://www.mdpi.com/2311-7524/5/1/7)는 greenhouse가 노지보다 물 요구량을 20~40% 줄일 수 있지만, 실제 현장에서는 관수 과잉이 흔하고, EC·pH·배액량 측정이 관수 적정성 판단에 유용하다고 정리한다. [같은 저자군의 irrigation/fertigation 리뷰](https://www.mdpi.com/2311-7524/7/12/548)는 작물·기후·수질에 따라 root-zone EC와 pH 관리가 달라지며, 폐쇄형/개방형 시스템에 따라 배액·재순환 정책이 달라져야 한다고 정리한다.

[Purdue Extension의 substrate 문서](https://www.extension.purdue.edu/extmedia/HO/HO-255-W.pdf)는 대부분의 greenhouse crops가 substrate pH 5.4~6.6을 선호한다고 설명한다. [국내 KSBEC 2024 논문](https://www.ksbec.org/articles/pdf/5aMA/phpf-2024-033-04-9.pdf)은 배지 종류가 다르면 같은 총 급액량과 같은 전략에서도 배액률이 달라지고, 배지별로 소량다회 또는 다량소회 전략을 달리 적용해야 목표 배액률에 수렴한다고 보고한다. 이 논문은 예시 실험에서 배액 EC 3.0~3.5 dS/m, pH 5.2~5.5, 목표 배액률 40%를 사용했는데, 이 수치는 보편 처방이 아니라 "배지/작물/생육 단계 의존적"이라는 점이 더 중요하다.

### 3.3 센서 품질은 값 하나보다 교정, 설치 위치, 시간 의미, stale 상태가 더 중요하다

[NCERA guidelines](https://www.controlledenvironments.org/wp-content/uploads/sites/6/2017/05/Greenhouse-Guidelines.pdf)는 센서 배치, 교정 시점, 다점 교정, canopy 근처 설치, 교정 이력 기록을 명시적으로 요구한다. 특히 CO2 NDIR 센서는 정기 교정과 수분 간섭 고려가 필요하고, 모든 센서는 실험 전후 교정을 권장한다.

[SensorThings API 1.1](https://docs.ogc.org/is/18-088/18-088.html)는 observation을 `phenomenonTime`, `resultTime`, `ObservedProperty`, `Sensor`로 분리한다. SmartFarmOS 입장에서는 이것이 "센서가 현상을 측정한 시각"과 "시스템이 수신/저장한 시각"을 나눠야 stale 판정을 제대로 할 수 있다는 뜻이다.

[Eclipse Sparkplug 2.2](https://sparkplug.eclipse.org/specification/version/2.2/documents/sparkplug-specification-2.2.pdf)는 birth/death certificate와 STALE quality를 정의한다. 이 개념은 MQTT가 아직 미구현인 SmartFarmOS에도 유효하다. 연결이 끊기거나 장치가 offline이면 "마지막 값 유지"가 아니라 `stale` 상태를 명시해야 한다.

[Sensor data quality systematic review](https://link.springer.com/article/10.1186/s40537-020-0285-1)는 물리 센서 오류의 대표 유형을 missing, outlier, bias, drift로 정리하고, 센서 품질 처리는 애플리케이션 이후가 아니라 수집 계층과 edge 계층에서도 해야 한다고 보여준다. [국내 온실형 스마트팜 센서 이상 탐지 연구 요약](https://www.kci.go.kr/kciportal/ci/sereArticleSearch/ciSereArtiView.kci?sereArticleSearchBean.artiId=ART002781591)도 환경 데이터와 구동기 상태를 같이 사용해 센서 이상을 판별하려는 방향을 제시한다.

### 3.4 안전은 "알람을 많이 보내는 것"이 아니라 "정지 우선, 수동 우선, bounded override"다

[Argus TITAN 2 system description](https://arguscontrols.com/uploads/documents/Titan-2-System-Description-Revised-June-2014.pdf)는 critical control function의 failsafe 설계, manual override fallback, integrated alarms, irrigation decision과 delivery capacity 분리를 제품 핵심으로 둔다. SmartFarmOS의 현재 `software stop`, `expiry`, `idempotency`, `ACK journal`, `audit` 방향은 공개 산업 관행과 맞는다.

[NIST SP 800-82 Rev. 3 공식 안내](https://www.nist.gov/publications/guide-operational-technology-ot-security)는 OT 보안이 성능·신뢰성·안전 요구를 함께 다뤄야 한다고 명시한다. 따라서 SmartFarmOS에서 cloud/PWA 레벨 알고리즘이 직접 액추에이터를 닫힌 루프로 몰아가는 것은 아직 이르다. 먼저 local boundary와 안전한 fallback이 있어야 한다.

작업자 안전 면에서는 CO2 외에도 "위험 센서값이 높을 때 자동 동작을 허용하지 않는 규칙"이 필요하다. 예를 들어 CO2 고농도, 통신 두절, stale humidity, 과도한 root-zone EC, 배액 급감, pump current 이상은 모두 "자동 증분 제어"보다 `경고 + 수동 검토`가 우선이다.

### 3.5 KPI는 평균값보다 `면적/작물/수확량 대비 자원`으로 봐야 한다

[Resource Innovation Institute의 2023 CEA benchmarking report](https://resourceinnovation.org/wp-content/uploads/2023/08/RII-Benchmarking_2023.pdf)는 energy productivity, water productivity, energy efficiency를 구분하고, 일부 지표는 바닥면적보다 canopy area 기준 정규화가 더 낫다고 설명한다. [NYSERDA greenhouse energy guidebook](https://www.nyserda.ny.gov/-/media/Project/Nyserda/Files/Publications/Fact-Sheets/AG-bpgreenhouse-bk.pdf)도 greenhouse energy use를 `kWh per unit of product` 같은 생산성 지표로 해석해야 하며, heating이 가장 큰 에너지 항목이고, irrigation/ventilation/lighting 각각의 에너지 개선이 독립 KPI로 보일 수 있어야 한다고 정리한다.

이 두 문서는 SmartFarmOS KPI를 최소한 다음처럼 나누라는 뜻이다.

- 물 KPI: `L/m2/day`, `L/kg harvest`, `drain fraction`, `irrigation uniformity`, `alarm-suppressed irrigation count`
- 양액 KPI: `dripper EC`, `drain EC`, `delta EC`, `pH excursions/day`
- 기후 KPI: `minutes out of target band`, `minutes stale`, `condensation-risk minutes`, `CO2 safe-range compliance`
- 에너지 KPI: `kWh/m2/day`, `kWh/kg harvest`, `fan/heater/pump runtime`, `screen-open loss proxy`

## 4. 제어 방식별 SmartFarmOS 채택 판단

| 방식 | 공개 근거 | SmartFarmOS 판단 | 근거 강도 | 한계 |
| --- | --- | --- | --- | --- |
| Hysteresis / step control | 온실 제어기는 여전히 단계식 제어와 우선순위 제어를 폭넓게 사용한다. [Argus](https://arguscontrols.com/uploads/documents/Titan-2-System-Description-Revised-June-2014.pdf), [NYSERDA](https://www.nyserda.ny.gov/-/media/Project/Nyserda/Files/Publications/Fact-Sheets/AG-bpgreenhouse-bk.pdf) | `adapt` - 대회 후 실제 센서와 safety 경계가 갖춰진 좁은 로컬 루프에 적합 | B | 정밀 최적화는 못 한다 |
| PID | 공개 리뷰와 연구가 많고, 온도·습도·환기 구동부에 적합하다. 예: [greenhouse PID review](https://dspace.kci.go.kr/handle/kci/2085744), [adaptive PID](https://www.mdpi.com/1424-8220/12/5/5328) | `adapt` - Edge 내부의 좁은 로컬 루프에만 검토. 중앙 API/PWA에서는 직접 구현하지 않음 | B | 튜닝 실패 시 진동·과보정 위험 |
| Feed-forward | 외기 온도·일사·풍속 같은 측정 가능한 교란을 미리 반영하는 방식이 반복 등장한다. 예: [feedback-feedforward greenhouse control abstract](https://www.sciencedirect.com/science/article/abs/pii/S0168169903000188), [feedforward compensator study](https://www.mdpi.com/2073-4395/10/9/1327) | `adapt` - 권고 엔진에서 "외기 급변 시 선제 감산/증산" 설명 변수로 유용 | B | 모델/교정 없이는 오히려 오차 확대 |
| MPC | 물리 제약을 직접 다룰 수 있어 고급 climate control에 유리하다. [constrained predictive control](https://www.sciencedirect.com/science/article/abs/pii/S0168169905001365), [TU Delft MPC/RL](https://research.tudelft.nl/en/publications/reinforcement-learning-based-model-predictive-control-for-greenho/) | `defer` - 대회 전 실시간 제어 금지. 대회 후 shadow mode와 simulator에서만 시작 | A | 모델 오차와 예보 불확실성에 민감 |
| Digital twin | 최신 구조 연구가 sensing, simulation, decision support, actuation 계층을 분리한다. [WUR digital twin RA](https://research.wur.nl/en/publications/digital-twin-based-reference-architecture-for-smart-greenhouses/) | `defer` - 대회 후 추천·검증 계층으로만 도입 | A | 데이터 품질/상태 동기화가 선행돼야 함 |

## 5. SmartFarmOS에 단계적으로 적용할 운용 모델

### 5.1 관측

대회 전 `문서화만`, 대회 후 P0 `adopt`

1. 센서값 저장 시 `phenomenonTime`, `ingestedAt`, `freshUntil`, `quality`를 분리한다. 기준은 [SensorThings](https://docs.ogc.org/is/18-088/18-088.html)와 [Sparkplug stale semantics](https://sparkplug.eclipse.org/specification/version/2.2/documents/sparkplug-specification-2.2.pdf)를 따른다.
2. 각 측정치에 대해 최소 품질 규칙을 둔다.
   - 범위 오류
   - 변화율 오류
   - stuck sensor
   - 교차 검증 오류(예: 실내 RH 급상승인데 drain/pump/light 상태가 전혀 설명 못 함)
   - stale
3. 파생 지표를 읽기 전용으로 계산한다.
   - VPD
   - 일 누적 일사/광량
   - 구역별 관수량·배액량·배액률
   - dripper EC 대비 drain EC 차이
   - out-of-band minutes

### 5.2 권고

대회 전 `구현 보류`, 대회 후 P1 `adapt`

권고 엔진은 자동 실행기가 아니라 "설명 가능한 제안기"로 둔다. 첫 규칙 세트는 아래 정도가 적당하다.

- `VPD 낮음 + RH 높음 + 외기 허용`: 결로 위험 경고, 환기/가온 조합 제안
- `VPD 높음 + substrate moisture 낮음 + 일사 상승`: 다음 관수 구간을 앞당기거나 1회량 증분 제안
- `drain EC 상승 + drain fraction 하락`: 소량다회 또는 midday flush 제안
- `CO2 높음 + 인체 접근 가능 시간`: enrichment 금지, 환기 우선
- `sensor stale 또는 anomaly`: 모든 자동 증분 제안 억제, manual inspection 권고

이 단계의 핵심은 "왜 이런 권고가 나왔는지"를 같이 보여주는 것이다. 예: `최근 90분 VPD 1.35 kPa`, `일 누적 일사 3.8 MJ/m2`, `배액률 12%`, `drain EC가 dripper EC보다 +0.8 dS/m`.

### 5.3 승인

대회 전 `현재 승인 흐름 유지`, 대회 후 `adapt`

[현재 architecture의 irrigation strategy application](../architecture.md)과 같은 승인 절차를 일반화한다.

- 대상 구역
- 근거 시계열
- 추천 변경값
- 적용 만료시각
- 예상 리스크
- 정지 방법
- 감사 actor

승인 없는 자동 실행은 금지하고, 최소한 `reviewed recommendation -> user confirmation -> bounded command` 순서를 유지한다.

### 5.4 안전한 실행

대회 전 `현재 명령·ACK·stop 경계 유지`, 실장비 안전 검증 후 `adapt`

- 실행은 반드시 기존 중앙 API/Edge 명령 수명주기를 재사용한다.
- `software stop`은 어떤 추천 실행보다 우선한다.
- stale sensor, ambiguous execution, exact farm/device mismatch, expired recommendation은 실행 금지 사유로 남긴다.
- irrigation recommendation은 "다음 1회량/횟수/간격"을 바꾸는 bounded change만 허용한다.
- 기후 recommendation은 setpoint 직접 변경보다 `operator-reviewed temporary band`로 시작한다.

## 6. 대회 후 기능용 시뮬레이터 테스트 시나리오

아래는 향후 기능을 현재 `tools/device-simulator/`와 기존 command/audit path에
추가할 때의 시나리오다. 이번 대회 전 구현 목록이 아니다.

### 6.1 센서 신선도/결측

- 상황: humidity telemetry가 12분 끊김
- 기대: VPD 계산은 `stale`, irrigation/climate 권고는 생성 억제, UI는 마지막 값 숫자보다 stale 상태를 우선 표시
- 판정: 자동 실행 0건, stale alarm 1건, audit에 suppression 기록

### 6.2 VPD 기반 환기 권고

- 상황: 온도 상승, RH 상승, VPD 0.35 kPa, 외기 허용
- 기대: "결로 위험/낮은 VPD" 경고와 환기 또는 열-환기 조합 제안
- 판정: operator approval 전까지 장치 명령 0건

### 6.3 배액률 하락 + drain EC 상승

- 상황: 일 누적 일사 증가, drain fraction 30% -> 12%, drain EC 급상승
- 기대: 다음 관수 창에서 소량다회 또는 중간 flush 제안
- 판정: 제안은 나오되 기존 timed_pump preset을 자동 발사하지 않음

### 6.4 CO2 안전 차단

- 상황: CO2 20,000 ppm 이상 구간 발생
- 기대: enrichment 관련 recommendation 차단, high-priority safety alert, 작업자 재진입 금지 문구
- 판정: ventilation recommendation만 허용, enrichment command 0건

### 6.5 센서 이상치와 stuck sensor

- 상황: substrate moisture가 4시간 같은 값, 동시에 drain/pump 로그와 불일치
- 기대: anomaly flag, sensor confidence 하향, irrigation recommendation 억제
- 판정: 운영자에게 센서 점검 체크리스트 표시

### 6.6 정지 우선

- 상황: approved irrigation recommendation 실행 중 V1 `off` 수동 정지
- 기대: 현재 구현된 `manual_stop` causal ACK와 동일하게 추천 실행도 중단, older queued activation fence 유지
- 판정: direct command audit + strategy audit 모두 인과관계 유지

## 7. 대회 전/후 채택 판단

| 항목 | 대회 전 | 대회 후 | 근거 강도 | 이유 |
| --- | --- | --- | --- | --- |
| VPD 계산·표시·alarm | `defer` | `adapt` | A | 공개 근거는 강하지만 계약·품질 모델 변경이 필요 |
| drain fraction / EC / pH 모니터링 | `defer` | `adapt` | A | 실제 센서·단위·교정 근거가 먼저 필요 |
| 일사 적산 기반 관수 권고 | `defer` | `adapt` | A | 실제 일사·관수 데이터와 사용자 평가가 먼저 필요 |
| substrate moisture/tension 기반 권고 | `defer` | `adapt` | A | 센서·배지·작물별 검증이 먼저 필요 |
| 자동 급액 폐루프 | `reject` | `defer` | B | 물리 안전·device reconciliation 미완성 |
| 기후 PID/MPC 직접 제어 | `reject` | `defer` | A | 현 구조에서는 과한 범위 |
| digital twin shadow simulator | `defer` | `adopt` | A | 데이터 품질·상태동기 먼저 |
| anomaly detection ML | `defer` | `adapt` | B | 데이터 축적 전에는 규칙 기반이 더 현실적 |
| Sparkplug stale/DBIRTH/DDEATH 의미 반영 | `문서화` | `adapt` | A | MQTT 도입 전에도 모델링 참고 가치가 있음 |
| 한국 KS 인터페이스 정렬 | `문서화` | `adapt` | A | 실제 원문·장비·적합성 시험이 먼저 필요 |

## 8. 대회 후 SmartFarmOS 계약과 데이터 모델 후보

첫 실장비·데이터 품질 파일럿 후보:

- telemetry quality: `good | suspect | stale | missing | overridden`
- observation timestamps: `phenomenonTime`, `resultTime`, `ingestedAt`
- climate derived metrics: `vpdKpa`, `dailyRadiationMjM2`
- irrigation derived metrics: `appliedMl`, `drainMl`, `drainFraction`, `dripperEc`, `drainEc`, `drainPh`
- recommendation entity:
  - `kind`
  - `scope`
  - `evidence`
  - `proposedChange`
  - `expiresAt`
  - `requiresApproval`
  - `safetyBlocks`

대회 후 후보:

- sensor calibration metadata
- zone crop coefficients
- screen/vent/heater state history
- weather forecast snapshots
- recommendation outcome feedback for later tuning

## 9. 미확인 사항

다음은 이번 조사에서 일부 근거가 있으나 SmartFarmOS 결정에 바로 쓰기엔 아직 부족한 항목이다.

- 한국 작목별 표준 VPD/EC/pH 운영 범위의 국가 단일표
- KS 원문 전문을 읽은 register map 수준의 세부 필드
- 실제 국내 greenhouse controller가 권고/승인/정지 우선 UX를 어떻게 구현하는지에 대한 공개 사용성 자료
- SmartFarm Korea Datamart에서 competition-compatible 공개 샘플을 얼마나 바로 재현 실험에 쓸 수 있는지

## 10. 출처 원장

| 구분 | 출처 | 등급 | 이번 문서에서의 사용 |
| --- | --- | --- | --- |
| 실험 환경 가이드 | [NCERA greenhouse guidelines](https://www.controlledenvironments.org/wp-content/uploads/sites/6/2017/05/Greenhouse-Guidelines.pdf) | A | VPD, RH, 센서 교정, canopy 배치, CO2/EC/pH 기본 원리 |
| CO2 실무 | [Oklahoma State CO2 supplementation](https://extension.okstate.edu/fact-sheets/print-publications/hla/greenhouse-carbon-dioxide-supplementation-hla-6723-a.pdf) | B | CO2 분배, 경보, 작업자 안전 수치 |
| 작업자 안전 | [OSHA CO2 asphyxiation hazard](https://www.osha.gov/publications/hib19960605) | A | 고농도 CO2, 저지대 축적, 환기/경고 |
| 온실 환경/열손실 | [UAF Controlling the Greenhouse Environment](https://www.uaf.edu/ces/publications/database/gardening/controlling-greenhouse-environment.php) | B | 열손실, 풍속, 피복, 난방 요구 |
| 배지 화학 | [Purdue substrate guide](https://www.extension.purdue.edu/extmedia/HO/HO-255-W.pdf) | B | substrate pH 기본 범위, EC/pH 측정 관점 |
| 국제 greenhouse 관행 | [FAO Good Agricultural Practices for greenhouse vegetable crops](https://openknowledge.fao.org/server/api/core/bitstreams/3b27458c-b392-4a7b-87bd-d2c2f6577a68/content) | A | 관수 계획, substrate irrigation, drain fraction, ET, EC/pH |
| FAO 소개 페이지 | [FAO greenhouse vegetable crops page](https://www.fao.org/agriculture/crops/publications/detail/en/item/276049/icode/?no_cache=1) | B | 문헌 범위와 적용 배경 확인 |
| 국내 배액 연구 | [KSBEC 2024 배액율 유지 급액전략](https://www.ksbec.org/articles/pdf/5aMA/phpf-2024-033-04-9.pdf) | A | 배지별 급액전략 차이, drain/EC/pH 모니터링 |
| 센서/ET 관수 효과 | [WUR/Incrocci 2014 irrigation scheduling abstract](https://research.wur.nl/en/publications/substrate-water-status-and-evapotranspiration-irrigation-scheduli/) | A | 타이머 대비 물/양분 절감 효과 |
| 관수 리뷰 | [MDPI Irrigation of Greenhouse Crops](https://www.mdpi.com/2311-7524/5/1/7) | A | greenhouse irrigation 일반 원리, sensor/EC/pH/drainage |
| fertigation 리뷰 | [MDPI Irrigation and Fertigation review](https://www.mdpi.com/2311-7524/7/12/548) | A | root-zone EC/pH, open/closed 시스템 구분 |
| 디지털 트윈 | [WUR digital twin reference architecture](https://research.wur.nl/en/publications/digital-twin-based-reference-architecture-for-smart-greenhouses/) | A | sensing-simulation-decision-actuation 분리 |
| IoT 관측 모델 | [OGC SensorThings API 1.1](https://docs.ogc.org/is/18-088/18-088.html) | A | phenomenonTime/resultTime, 센서/관측 메타모델 |
| stale semantics | [Eclipse Sparkplug 2.2](https://sparkplug.eclipse.org/specification/version/2.2/documents/sparkplug-specification-2.2.pdf) | A | birth/death, stale quality, primary host 개념 |
| 국내 센서/구동기 범위 | [MAFRA 스마트팜 ICT 기자재 국가표준 보도자료](https://www.mafra.go.kr/bbs/mafra/68/247925/download.do) | A | 시설원예 13개 센서, 9개 구동기 범위 |
| 국내 인터페이스 표준 | [KS B 7958 안내](https://smartfarm-standard.kr/standard/guide/record/view.php?seq=30) | A | node-통합제어기 TCP/Modbus 인터페이스 범위 |
| 국내 양액기 표준 | [KS X 3288 안내](https://smartfarm-standard.kr/standard/guide/record/view.php?seq=17) | A | 통합제어기-양액기 RS485/Modbus 인터페이스 범위 |
| 국내 시설원예 기술집 | [농사로 시설원예 길잡이](https://nongsaro.go.kr/portal/ps/psb/psbx/cropEbookLst.ps?menuId=PS65290&sStdPrdlstCode=AE04AE41&stdPrdlstCode=AE&totalSearchYn=Y) | A | 환기, 탄산가스 시비, 관수, 관비, 배수, 수경재배 항목 범위 |
| 에너지/물 벤치마킹 | [RII CEA benchmark report](https://resourceinnovation.org/wp-content/uploads/2023/08/RII-Benchmarking_2023.pdf) | B | energy productivity, water productivity, canopy-area normalization |
| 에너지 실무 | [NYSERDA greenhouse energy guidebook](https://www.nyserda.ny.gov/-/media/Project/Nyserda/Files/Publications/Fact-Sheets/AG-bpgreenhouse-bk.pdf) | B | kWh/unit, heating 중심 구조, control/irrigation 에너지 KPI |
| 고급 제어 | [TU Delft RL-based MPC abstract](https://research.tudelft.nl/en/publications/reinforcement-learning-based-model-predictive-control-for-greenho/) | A | MPC의 장점과 모델 불확실성 한계 |
| 예측 제어 선행연구 | [Constrained predictive control of a greenhouse](https://www.sciencedirect.com/science/article/abs/pii/S0168169905001365) | A | greenhouse MPC 계열 선행연구 존재 확인 |
| feed-forward 선행연구 | [A nonlinear feedback technique for greenhouse environmental control](https://www.sciencedirect.com/science/article/abs/pii/S0168169903000188) | A | feedback-feedforward 접근의 공개 선행연구 |
| 센서 데이터 품질 | [Sensor data quality systematic review](https://link.springer.com/article/10.1186/s40537-020-0285-1) | A | missing/outlier/bias/drift 분류와 edge 품질 처리 필요성 |
| 국내 센서 이상 탐지 | [KCI 온실형 스마트팜 센서 이상 탐지 요약](https://www.kci.go.kr/kciportal/ci/sereArticleSearch/ciSereArtiView.kci?sereArticleSearchBean.artiId=ART002781591) | B | 환경 데이터와 구동기 상태를 함께 쓰는 anomaly 방향 |
| 상용 공개 설계 | [Argus TITAN 2 System Description](https://arguscontrols.com/uploads/documents/Titan-2-System-Description-Revised-June-2014.pdf) | B | failsafe, manual override fallback, irrigation decision vs capacity, alarms |
| OT 안전·보안 | [NIST Guide to Operational Technology Security](https://www.nist.gov/publications/guide-operational-technology-ot-security) | A | OT는 성능·신뢰성·안전을 함께 다뤄야 한다는 원칙 |
| 한국 공개 데이터 맥락 | [FAO STI portal - SmartFarm Korea](https://sti-portal.fao.org/innovations/smartfarm-korea) | B | post-contest 데이터 연계 후보 |
