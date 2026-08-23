# SmartFarmOS 시설원예 경제성·운영 KPI·제품 포지셔닝 조사

- 기준일: 2026-08-12
- 목적: SmartFarmOS 대회 제출물과 대회 후 파일럿 계획에 바로 쓸 수 있는 정직한 경제성·운영 KPI·제품 포지셔닝 근거를 정리한다.
- 현재 제품 경계: SmartFarmOS는 현재 `PWA + 중앙 API + HTTP Edge + SQLite + 시뮬레이터`로 검증된 대회용 MVP이며, 실장비 안전·생산 인증·오프라인 텔레메트리 버퍼·MQTT·다중 Edge lease·실물 ROI는 아직 범위 밖이다. [L1][L2]

## 판정 규칙

- `[사실]`: 정부·대학·WUR·FAO·에너지기관·공식 회사 문서가 직접 말한 내용
- `[업체 주장]`: 공식 회사 문서의 마케팅/제품 주장
- `[추론]`: 위 자료와 현재 SmartFarmOS 범위를 결합한 해석
- `[미확인]`: 공개 자료만으로 확인하지 못한 항목

## Executive Summary

1. `[사실]` 공개 자료에서 온실 운영비는 `에너지`, `노동`, `물/관수`, `질병·고장·환경이탈에 따른 손실`이 반복적으로 핵심 비용 항목으로 등장한다. 특히 UConn 자료는 전형적 연간 에너지 사용 비중을 `난방 75% / 전기 15% / 차량 10%`으로 제시한다. [S8]
2. `[사실]` KPI는 `면적`, `시간`, `생산량`, `자원`, `신뢰성`을 같이 정규화해야 비교가 된다. 공개 자료에서도 `kg/m2`, `kg/m2/year`, `heads/day`, `days-to-harvest`, `water-use efficiency`, `kWh`, `5-minute trend data` 같은 단위가 반복된다. [S1][S6][S7][S11][S15]
3. `[사실]` 알람·모니터링·백업의 경제적 가치는 “AI가 수익을 올린다”보다 “고장·과습·관수 실패·온도 이탈을 빨리 발견해 손실을 줄인다”는 쪽이 공개 근거와 더 잘 맞는다. Cornell은 온실 제어 상실이 생산과 이익에 부정적이라고 했고, Cornell/UConn 자료는 센서·알람·백업·습도 제어를 기본 운영 항목으로 둔다. [S10][S19][S20]
4. `[추론]` SmartFarmOS의 대회 전 정직한 가치제안은 “오픈소스 공개를 목표로
   하는 중소형 시설원예용 운영·감사 콘솔”이다. 현재 라이선스는 확정 전이다.
   기후컴퓨터 자체를 대체한다고 주장하기보다 `구역 비교`, `알람 확인`, `관수
   실행 결과`, `감사 가능한 command lifecycle`을 한 화면과 한 기록으로 묶는
   제품으로 설명하는 편이 맞다. [L1][L2][S21][S23][S24][S25][S26][S27][S28]
5. `[추론]` 현실적인 첫 고객은 대형 엔터프라이즈 Priva/Ridder 교체 수요가 아니라, `중소형 온실 운영자`, `통합업체의 파일럿 프로젝트`, `대학/연구/실증 온실`, `공공 실증단지`처럼 “기존 장비 위에 운영 가시성과 감사 증거를 덧씌우려는” 집단이다. [S16][S17][S18][S21][S22][S23][S24][S29][S30][S31]
6. `[사실]` 공개 회사 자료는 기능·성과 사례는 말하지만, 대개 공개 리스트 가격을 제시하지 않고 `Contact`, `Request calculation`, `demo`, `Get in touch`로 전환한다. 따라서 SmartFarmOS도 공개 자료만으로 일반화된 ROI 퍼센트나 시장가격 비교표를 만들면 근거가 약하다. [S21][S23][S24][S25][S26][S27][S28]
7. `[추론]` 대회 전에는 새 기능보다 “측정 가능한 pilot KPI”를 제시하는 편이 강하다. 현재 이미 구현·검증된 `alarm ack`, `command ACK`, `manual stop`, `replay recovery`, `farm-wide audit`를 KPI 언어로 바꾸면 된다. [L1][L2]
8. `[미확인]` SmartFarmOS가 실제 농가에서 절감하는 에너지·노동·수확손실 규모는 아직 측정되지 않았다. 공개자료만으로 수치를 만들면 안 된다. 파일럿 이후에만 계산해야 한다. [L2][S12][S16]

## 1. 공개자료가 말하는 온실 운영비 구조

### 1.1 에너지

- `[사실]` UConn은 전형적 연간 온실 에너지 사용 비중을 `난방 75%`, `전기 15%`, `차량 10%`으로 제시한다. 따라서 절감 여지가 가장 큰 영역은 난방이다. [S8]
- `[사실]` 같은 UConn 자료는 `IR inhibitor 내층`으로 약 `15%` 절감, `thermal screen`으로 `20%~50%` 절감, 기계식 대신 전자식 제어기로 `30' x 100'` 온실에서 연 `750 gallons` 연료 절감 가능성을 예시한다. 이 수치는 현재 가격이 아니라 “작은 제어·설비 개선도 비용에 직접 연결된다”는 근거로만 써야 한다. [S8]
- `[사실]` UConn의 난방 시스템 업그레이드 자료는 효율 75% 미만 보일러 교체 검토, 응축식 장비 93~95%+, 외기/예보 기반 수온 조절, 제어 정확도 향상이 연료 사용량에 직접 연결된다고 설명한다. [S9]
- `[사실]` DOE는 보조광이 있는 온실을 별도 분석 범주로 다루며, LED와 제어 최적화가 에너지 절감과 생산성 모두에 영향을 준다고 본다. [S14]
- `[사실]` DOE의 UVM 사례는 `8,000 ft2` 연구 온실에서 LED 교체와 제어시스템 도입으로 연 `22,000 kWh`를 절감했고, historical trend를 `5분 간격`으로 저장해 성장조건과 에너지 사용을 함께 최적화한다고 밝힌다. [S15]
- `[추론]` SmartFarmOS의 에너지 서사는 “에너지를 최적화한다”가 아니라 “구역/시간별 데이터, 알람, 제어 결과, 추세 기록을 남겨 에너지 낭비가 언제 생겼는지 추적할 수 있게 한다”가 현재 범위에 맞다. [L1][L2][S8][S9][S15]

### 1.2 물·관수·습도

- `[사실]` FAO는 온실 채소 생산의 핵심 이점 중 하나로 `water-use efficiency` 최적화를 든다. 같은 문서의 약어 목록은 `WP`, `WUE`, `IE`, `IS`, `VPD`를 별도 운영 개념으로 둔다. [S1]
- `[사실]` FAO는 고온다습 환경이 병 발생을 키우므로 상대습도 관리와 환기·가열이 중요하다고 정리한다. [S1]
- `[사실]` UConn은 과습 제어를 위해 `heat + vent` 사이클을 돌리는 비용을 `1000 sq ft` 기준 예시로 제시하고, `drip irrigation`이 증발과 엽면 습윤을 줄여 질병 압력을 낮춘다고 설명한다. [S10]
- `[사실]` UConn은 물 시스템에서 `minimum pressure`, `staged pumps`, `leak elimination`을 체크리스트로 제시한다. 즉, 물은 단순 사용량만이 아니라 압력·누수·펌프 동작도 운영비 항목이다. [S8]
- `[사실]` WUR는 온실 물 사용을 `efficiency and circularity` 관점에서 다루며, 재사용·배출 감소·용수 효율을 경제성과 분리하지 않는다. [S4]
- `[추론]` SmartFarmOS의 관수 가치는 “정밀 agronomy”보다 먼저 `목표 대상`, `명령 발행`, `장치 ACK`, `최종 off`, `실패/수동중단 원인`, `알람 회복 여부`를 한 기록으로 남기는 데 있다. 이 기록이 있어야 나중에 `L/kg`, `관수 이벤트 성공률`, `저수위 재발률` 같은 KPI를 계산할 수 있다. [L1][L2][S1][S8][S10]

### 1.3 노동

- `[사실]` UF/IFAS의 소규모 온실 토마토 예산은 노동·보험·세금을 “significant costs”로 직접 부르며, 온실 노동이 변동비의 `18.6%`를 차지한다고 설명한다. [S12]
- `[사실]` 같은 예산은 `수확·운반·포장·마케팅`이 총비용의 `39%`를 차지한다고 설명한다. 즉, 생산 자체뿐 아니라 운영 흐름과 후속 작업도 비용 구조에 들어간다. [S12]
- `[사실]` WUR는 자율재배를 “tight labour market” 대응책으로 위치시킨다. 공개 연구 방향 자체가 노동 부족을 전제로 한다. [S5]
- `[사실]` Cornell의 고터널 운영 팁은 `Enhance labor efficiency`와 `install sensors and alarms`를 분리된 운영 과제로 제시한다. 노동 효율과 모니터링은 같은 경제 문제의 다른 면이다. [S19]
- `[추론]` SmartFarmOS는 대회 전 노동절감 금액을 주장할 단계는 아니다. 대신 `알람 확인 시간`, `수동 재확인 횟수`, `명령 결과 확인까지 걸린 시간`, `중복 실행 방지`를 측정하면 노동 절감 가설을 파일럿에서 검증할 수 있다. [L2][S12][S19]

### 1.4 손실·다운타임·질병

- `[사실]` Cornell의 고장 진단 논문은 온실 제어 상실이 생산과 이익에 부정적이며, 특히 plant-related fault는 전체 생산에 재앙적일 수 있다고 설명한다. [S20]
- `[사실]` Cornell의 고터널 운영 가이드는 `air temperature alarm`, `emergency heater`, 각종 모니터와 `backup systems or plans`를 기본 운영 요소로 둔다. [S19]
- `[사실]` UConn은 밤사이 고습이 Botrytis·powdery mildew 같은 질병을 촉진한다고 설명하고, 연속 공기순환과 적절한 환기·가열을 권한다. [S10]
- `[사실]` FAO는 greenhouse crop intensification이 pests and diseases에 유리한 조건을 만들 수 있으며, 병 발생은 생산성과 상품성을 직접 위협한다고 본다. [S1]
- `[추론]` SmartFarmOS의 알람·다운타임 경제성은 “얼마 벌어준다”보다 “얼마나 빨리 감지하고, 누가 확인했으며, 어떤 조치가 성공/실패했는지 남긴다”로 표현해야 한다. 현재 코드 경계와 공개 근거가 그 수준에 맞다. [L1][L2][S1][S10][S19][S20]

## 2. KPI 정규화: 무엇을 어떤 단위로 비교해야 하는가

### 2.1 공개자료에서 반복되는 단위

- `[사실]` Cornell CEA lettuce handbook은 `1245 heads/day`, `660 m2`, `24 days`, `plants/m2`, `EC`, `lighting`처럼 면적·시간·생산량을 함께 쓴다. [S11]
- `[사실]` WUR 토마토 연구는 `46.2 -> 56.2 kg/m2` 같은 면적당 수량을 쓴다. [S6]
- `[사실]` WUR autonomous dwarf tomato 연구는 `45 kg/m2/year` 같은 연간 면적 생산성을 쓴다. [S7]
- `[사실]` FAO는 토마토 수확량을 `tonnes/ha`로 제시한다. 이는 `kg/m2`로 환산 가능하다. (`300 t/ha = 30 kg/m2`) [S1]
- `[사실]` DOE/UVM 사례는 `kWh/year`, `5-minute interval trend data`를 쓴다. [S15]

### 2.2 SmartFarmOS에 적합한 KPI 축

| KPI 축 | 권장 단위 | 왜 필요한가 | 근거 |
| --- | --- | --- | --- |
| 생산성 | `kg/m2/cycle`, `kg/m2/year`, `heads/day`, `days-to-harvest` | 작물·구역·기간 비교의 기본 단위 | [S1][S6][S7][S11] |
| 물 | `L/kg`, `m3/m2/cycle`, `irrigation success rate`, `low-water alarm recurrence` | 물 사용량만이 아니라 관수 성공과 재발을 같이 봐야 함 | [S1][S4][S8][S10] |
| 에너지 | `kWh/m2/day`, `kWh/kg`, `fuel/unit area`, `night temp setpoint deviation minutes` | 난방/조명/환기 비용을 생산과 연결하기 위해 필요 | [S8][S9][S14][S15] |
| 노동 | `labor-hours/week`, `minutes/alarm`, `minutes/irrigation event`, `manual interventions/day` | 절감 가설을 금액 대신 시간으로 먼저 검증 | [S12][S19] |
| 신뢰성 | `telemetry freshness %`, `alarm ack median`, `command ACK success %`, `replay recovery success %`, `manual stop propagation time` | SmartFarmOS의 현재 차별점은 운영 신뢰성과 감사성 | [L1][L2][S19][S20][S22] |
| 손실 | `affected m2`, `crop-loss incidents`, `disease-pressure hours`, `downtime minutes`, `missed irrigation events` | ROI를 말하기 전 먼저 “무엇을 얼마나 잃었는가”를 측정해야 함 | [S1][S10][S19][S20] |

### 2.3 대회 전에는 쓰지 말아야 할 KPI

- `[미확인]` `수익률 %`, `투자회수기간`, `에너지 절감 %`, `노동 절감 %`, `수량 증가 %`를 SmartFarmOS 일반 수치처럼 말하는 것
- 이유:
  - `[사실]` UF/IFAS 예산조차 가정이 바뀌면 수익성이 크게 변하고, 동일한 온실이라도 가격·수량이 수익성에 가장 큰 영향을 준다고 말한다. [S12]
  - `[사실]` WUR KWIN도 최신 input cost와 price를 별도 핸드북으로 관리한다. 비용 구조가 고정값이 아님을 뜻한다. [S2]
  - `[사실]` 회사 공식 페이지 다수는 가격표를 공개하지 않는다. [S21][S23][S24][S25][S26][S27][S28]

## 3. 알람·다운타임·관수 증거의 경제적 가치

### 3.1 공개 근거에서 말할 수 있는 것

- `[사실]` 제어 상실은 생산량과 이익에 악영향을 준다. [S20]
- `[사실]` 대학·공공 운영 문서는 알람, 백업 히터, 센서, 추세 데이터,
  환기/가열 제어를 기본 운영 구성요소로 둔다. [S8][S10][S15][S19][S20]
- `[업체 주장]` Priva와 Ridder도 알람·원격 운영·기후 제어를 제품군의 운영
  기능으로 제시한다. [S22][S23]
- `[사실]` 습도·환기·관수 방식은 질병 압력과 직접 연결된다. [S1][S10]
- `[사실]` 작은 설비 이상도 비용으로 이어질 수 있다. 예를 들어 UConn은 닫히지 않는 팬 루버 틈이 시간당 열손실과 연료비 증가를 만든다고 예시한다. [S8]

### 3.2 SmartFarmOS가 대회 전 정직하게 주장할 수 있는 가치

- `[추론]` “실시간 최적화”보다 `event evidence`가 더 강한 주장이다.
  - 누가 어떤 알람을 언제 확인했는가
  - 어떤 관수 전략이 어느 구역에 적용됐는가
  - 장치가 최종 `off`까지 성공했는가
  - 실패/중단 시 어떤 causal result가 남았는가
  - Edge 재시작 뒤 중복 실행 없이 ACK가 replay됐는가
- `[추론]` 이는 직접적인 현금 ROI보다 먼저 `avoidable loss accounting`을 가능하게 한다.
  - `missed irrigation events`
  - `alarm unacknowledged minutes`
  - `manual stop needed events`
  - `telemetry stale duration`
  - `affected growing area`

### 3.3 대회 후 파일럿에서만 계산해야 할 것

- `[추론]` 아래 식은 파일럿 이후에만 계산한다.

```text
파일럿 경제 효과 =
  (회피한 손실액)
+ (절감된 야간/주말 출동 시간 가치)
+ (감소한 중복 관수/명령 비용)
+ (에너지·물 절감액, 측정 가능할 때만)
- (추가 하드웨어/설치/교육/운영 비용)
```

- `[미확인]` 현재는 각 항목의 실제 농장 데이터가 없다. 따라서 수치를 넣지 않는다.

## 4. SmartFarmOS 제품 포지셔닝

### 4.1 경쟁 제품이 공식 자료에서 어떻게 스스로를 설명하는가

- `[업체 주장]` Priva는 greenhouse technology, climate control, energy and water management, digital services, notification center, API services를 함께 묶는다. [S21][S22]
- `[업체 주장]` Ridder는 climate, irrigation, energy, app, process automation을 한 제품군으로 묶고 `Request calculation`과 `Get in touch` 중심으로 판매한다. [S23][S24][S25]
- `[업체 주장]` Source.ag는 yield prediction, strategy improvement, irrigation control, API를 상위 데이터/AI 레이어로 판매한다. [S26][S27]
- `[업체 주장]` Koidra는 DataPilot/KoPilot을 나눠 운영 데이터와 자율 제어를 분리해 설명한다. [S28]
- `[사실]` farmOS는 오픈소스 농장 관리·계획·기록 플랫폼으로 자신을 설명하며, greenhouse를 structure asset으로 다루고 다른 소프트웨어가 API와 모듈을 통해 특화 기능을 붙일 수 있게 한다. [S29][S30][S31]

### 4.2 SmartFarmOS에 맞는 현실적 포지션

- `[추론]` SmartFarmOS는 현재 `closed-loop climate computer`가 아니라 `open-source operational overlay`로 포지셔닝하는 편이 맞다.
- `[추론]` 권장 문구:
  - `오픈소스 공개를 목표로 한 중소형 시설원예용 운영·감사 콘솔`
  - `구역별 상태 비교, 알람 확인, 관수 실행 결과, 감사 가능한 제어 이력을 한 흐름으로 묶는 소프트웨어`
  - `기존 센서/제어기 위에 붙는 파일럿용 운영 가시성 계층`
- `[추론]` 피해야 할 문구:
  - `Priva 대체`
  - `자율재배 OS`
  - `에너지/수량 ROI 보장`
  - `표준 호환 완료`
  - `실장비 안전 검증 완료`

### 4.3 현실적인 초기 고객과 구매 논리

1. `[추론]` **중소형 온실 운영자**
   - 기존 장비가 있거나 일부만 자동화됐지만, 알람·관수·감사기록이 분리된 곳
   - 구매 논리: “비싼 전체 교체”보다 “현재 운영 혼선과 야간 대응 문제를 줄이는 overlay”

2. `[추론]` **통합업체/설비업체의 실증 프로젝트**
   - 장비 판매 전후에 운영 대시보드와 증거 화면이 필요한 경우
   - 구매 논리: 장비 제어 자체보다 `pilot observability`와 `handover evidence`

3. `[추론]` **대학·연구·실증 온실**
   - 5분/1분 단위 추세, 구역 비교, 실험별 command trail이 중요한 곳
   - 구매 논리: 벤더 종속이 적고, 데이터/로그 보존을 직접 통제 가능

4. `[추론]` **공공 스마트팜 실증단지/교육장**
   - 수익 극대화보다 교육·재현·운영 프로토콜 증거가 중요한 경우
   - 구매 논리: 오픈소스, 시뮬레이터, 감사가능성, 설명 가능성

### 4.4 현실성이 낮은 초기 타깃

- `[추론]` 대형 다사이트 상업 온실의 핵심 climate computer 교체
- 이유:
  - `[사실]` 상용 벤더들은 제어기, 에너지, 관수, 지원, API, 알람을 패키지로 판매한다. [S21][S22][S23][S24][S25][S26][S27][S28]
  - `[미확인]` SmartFarmOS는 아직 현장 설치·유지보수·SLA·실장비 호환 목록·공개 가격 전략이 없다.

## 5. 공개 가격 부재와 ROI 주장 한계

### 5.1 공개 가격 부재

- `[사실]` 2026-08-12 확인 기준, 아래 공식 페이지들은 기능 설명과 문의 CTA는 제공하지만 공개 리스트 가격을 전면에 두지 않았다.
  - Priva digital services: `Contact` [S21]
  - Priva notification center onboarding/Edge gateway [S22]
  - Ridder Hortimax Go: `Request calculation`, `Get in touch` [S23]
  - Ridder Hortimax Pro: brochure / case study 중심 [S24]
  - Source solutions / source API: 제품 설명 중심 [S26][S27]
  - Koidra CEA / contact page: 문의 중심 [S28]
- `[추론]` SmartFarmOS도 경쟁사 가격표를 모사한 ROI 표를 만들기보다, 공개적으로는 `pilot measurement plan`을 제시하는 편이 방어 가능하다.

### 5.2 ROI를 일반화할 수 없는 이유

- `[사실]` UF/IFAS 예산은 동일한 온실에서도 가격과 수량이 수익성에 가장 큰 영향을 주고, 예시 예산에서 returns가 음수일 수 있음을 보여준다. [S12]
- `[사실]` Cornell lettuce handbook은 생산성 계산에 `heads/day`, `growing area`, `days in pond`, `re-spacing density`, `lighting`, `EC`를 함께 둔다. 즉, 작물·시스템 구성에 따라 KPI 구조가 달라진다. [S11]
- `[사실]` WUR KWIN은 매년 reference data를 별도 발간할 만큼 비용과 수익성이 계속 바뀐다. [S2]
- `[추론]` 따라서 SmartFarmOS의 ROI는 최소한 아래가 있어야 계산 가능하다.
  - 기준선 손실/노동/에너지 데이터
  - 작물/재배방식/면적
  - 기존 장비와의 통합 비용
  - 파일럿 운영 기간
  - 개입 전후 비교

## 6. 대회 전: 새 기능 대신 발표·보고서에 쓸 정직한 가치제안

### 6.1 권장 가치제안

`SmartFarmOS는 중소형 시설원예 운영자가 구역별 상태 비교, 알람 확인, 관수
명령 결과, 감사 가능한 제어 이력을 하나의 콘솔에서 확인하도록 돕는 파일럿
지향 소프트웨어이며, 권리·라이선스 확인 뒤 오픈소스 공개를 목표로 한다.`

### 6.2 권장 보조 문장

- `[추론]` “기존 장비를 통째로 교체하기보다, 운영 혼선이 생기는 지점을 먼저 보이게 하는 레이어”
- `[추론]` “실패·재시작·수동중단까지 기록하는 command evidence”
- `[추론]` “대회 시점에는 실장비 자동최적화가 아니라 운영 투명성과 파일럿 측정 가능성에 초점”

### 6.3 피해야 할 문장

- `[미확인]` “에너지 비용을 X% 줄인다”
- `[미확인]` “수량을 Y% 늘린다”
- `[미확인]` “Priva/Ridder와 동급”
- `[미확인]` “모든 온실에 바로 적용 가능”

## 7. 대회 전 제안: 측정 가능한 Pilot KPI

아래 KPI는 현재 SmartFarmOS 범위 안에서 설명 가능하거나, 최소한 대회 직후 작은 파일럿에서 바로 수집 가능하다.

| KPI | 단위 | 대회 전 설명 가능 여부 | 이유 |
| --- | --- | --- | --- |
| telemetry freshness coverage | `%` | 가능 | 현재도 freshness/offline 보존과 scope 검증이 핵심 경계다. [L1][L2] |
| alarm acknowledgment median / p95 | `minutes` | 가능 | 현재 alarm ack/audit이 구현돼 있다. [L1][L2] |
| command ACK success rate | `%` | 가능 | 현재 per-target ACK/result 집계가 있다. [L1][L2] |
| final `off` completion rate | `%` | 가능 | timed command는 final `off` 뒤에만 success다. [L1][L2] |
| manual stop propagation time | `seconds` | 가능 | stop lane과 causal ACK가 이미 있다. [L1][L2] |
| duplicate execution prevented | `count` | 가능 | replay/no-rerun 경계가 현재 강점이다. [L1][L2] |
| low-water alarm recurrence after strategy | `count per area per week` | 가능 | 현재 저수위 알람/전략 흐름과 맞는다. [L2] |
| operator evidence completeness | `% of commands with actor/time/result/audit` | 가능 | 감사 trail이 현재 제품 서사의 핵심이다. [L2] |
| stale telemetry to alert latency | `minutes` | 파일럿 권장 | 운영 리스크를 수치화 가능 |
| remote check-ins avoided | `count/week` | 파일럿 권장 | 노동 절감 가설을 금액 대신 사건 수로 본다 |

## 8. 대회 후 별도 제안: Pilot Scorecard

대회 후 실농장 또는 실증 온실 파일럿은 아래처럼 `운영`, `자원`, `결과`, `경제성`을 분리해 본다.

### 8.1 운영 신뢰성

- `alarm ack median / p95`
- `alarm-to-action time`
- `command ACK success %`
- `manual stop success %`
- `replay recovery success %`
- `downtime minutes`
- `telemetry freshness %`

### 8.2 자원 사용

- `kWh/m2/day` 또는 `fuel/m2/day`
- `L/kg` 또는 `m3/m2/cycle`
- `manual interventions/day`
- `labor-minutes/alarm`
- `labor-minutes/irrigation event`

### 8.3 생산 결과

- `kg/m2/cycle` 또는 `kg/m2/year`
- `marketable yield %`
- `days-to-harvest`
- `affected area m2 per incident`
- `crop-loss incidents/month`

### 8.4 경제성

- `avoided emergency call-outs`
- `avoided repeated irrigation events`
- `energy delta vs baseline`
- `water delta vs baseline`
- `labor-hours saved vs baseline`
- `loss events avoided vs baseline`

## 9. 결론

1. `[사실]` 공개자료 기준으로 온실 경제성의 핵심은 여전히 `에너지`, `물/관수`, `노동`, `질병·고장 손실`이다. [S1][S8][S9][S10][S12]
2. `[추론]` SmartFarmOS의 현재 강점은 생산 최적화 알고리즘이 아니라 `운영 신뢰성과 감사 가능성`이다. [L1][L2]
3. `[추론]` 따라서 대회 전 메시지는 “더 똑똑한 제어”보다 “측정 가능한 운영 근거”로 가야 한다.
4. `[미확인]` 공개자료만으로 일반화된 ROI 숫자나 시장가격 비교는 만들 수 없다.
5. `[추론]` 첫 구매 논리는 `오픈소스 + overlay + audit trail + pilot scorecard` 조합이 가장 현실적이다.

## Appendix A. 로컬 맥락 자료

- `[L1]` [프로젝트 컨텍스트](../../.codex/project.md)
- `[L2]` [제출 결과보고서](../submission/result-report.md)

## Appendix B. 직접 URL 목록

| ID | 분류 | 기관/회사 | 직접 URL |
| --- | --- | --- | --- |
| S1 | 사실 | FAO | https://www.fao.org/docrep/018/i3284e/i3284e.pdf |
| S2 | 사실 | WUR | https://www.wur.nl/en/research/products-services/kwin-greenhouse-horticulture-2026 |
| S3 | 사실 | WUR | https://www.wur.nl/en/research/plant/future-proof-greenhouse-horticulture |
| S4 | 사실 | WUR | https://research.wur.nl/en/publications/water-use-in-greenhouse-horticulture-efficiency-and-circularity/ |
| S5 | 사실 | WUR | https://www.wur.nl/en/research/plant/autonomous-cultivation-greenhouse-horticulture |
| S6 | 사실 | WUR | https://research.wur.nl/en/publications/tomato-yield-in-a-closed-greenhouse-and-comparison-with-simulated/ |
| S7 | 사실 | WUR | https://research.wur.nl/en/publications/autonomous-greenhouse-cultivation-of-dwarf-tomato-performance-eva/ |
| S8 | 사실 | UConn Extension | https://ipm.cahnr.uconn.edu/greenhouse-energy-conservation-checklist/ |
| S9 | 사실 | UConn Extension | https://ipm.cahnr.uconn.edu/up-grading-the-greenhouse-heating-system/ |
| S10 | 사실 | UConn Extension | https://ipm.cahnr.uconn.edu/reduce-greenhouse-humidity/ |
| S11 | 사실 | Cornell CEA | https://cea.cals.cornell.edu/files/2019/06/Cornell-CEA-Lettuce-Handbook-.pdf |
| S12 | 사실 | UF/IFAS | https://ufdcimages.uflib.ufl.edu/IR/00/00/09/83/00001/CV27000.pdf |
| S13 | 사실 | Rutgers NJAES | https://njaes.rutgers.edu/pubs/publication.php?pid=FS1000 |
| S14 | 사실 | U.S. DOE | https://www.energy.gov/cmei/ssl/better-lighting-agriculture |
| S15 | 사실 | U.S. DOE / Integrated Lighting Campaign | https://integratedlightingcampaign.energy.gov/2022-exemplary-participant-university-vermont |
| S16 | 사실 | USDA NASS | https://www.nass.usda.gov/Publications/Highlights/2026/HorticulturalSpecialties2024.pdf |
| S17 | 사실 | USDA NASS | https://www.nass.usda.gov/Publications/Highlights/2026/2024-floriculture-highlights.pdf |
| S18 | 사실 | USDA NASS | https://www.nass.usda.gov/Surveys/Guide_to_NASS_Surveys/Census_of_Horticultural_Specialties/index.php |
| S19 | 사실 | Cornell Cooperative Extension | https://rvpadmin.cce.cornell.edu/uploads/doc_1028.pdf |
| S20 | 사실 | Cornell / Computers and Electronics in Agriculture | https://www.cs.cornell.edu/selman/papers/pdf/03.comp-elec-agri.neural.pdf |
| S21 | 업체 주장 | Priva | https://www.priva.com/horticulture/solutions/digital-services |
| S22 | 업체 주장 | Priva Support | https://support.priva.com/hc/en-us/articles/4402991271826-How-can-I-start-using-the-Notification-Center |
| S23 | 업체 주장 | Ridder | https://ridder.com/hortimax-go |
| S24 | 업체 주장 | Ridder | https://ridder.com/hortimax-pro |
| S25 | 업체 주장 | Ridder | https://ridder.com/process-automation/climate-computers |
| S26 | 업체 주장 | Source.ag | https://www.source.ag/solutions |
| S27 | 업체 주장 | Source.ag | https://www.source.ag/source-api |
| S28 | 업체 주장 | Koidra | https://www.koidra.ai/cea/ |
| S29 | 사실 | farmOS | https://farmos.org/ |
| S30 | 사실 | farmOS | https://farmos.org/guide/assets/ |
| S31 | 사실 | farmOS | https://farmos.org/blog/2019/farmos-1.0/ |
