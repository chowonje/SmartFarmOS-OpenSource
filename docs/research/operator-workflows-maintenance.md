# SmartFarmOS 온실 운영자 워크플로·유지보수 공개자료 조사

- 조사 기준일: 2026-08-12
- 범위: Priva, Hoogendoorn, Ridder, Argus의 공개 매뉴얼·지원 문서와 정부·대학의 공개 운영 자료
- 프로젝트 맥락: [아키텍처](../architecture.md), [현장 사용성 프로토콜](../usability/field-test-protocol.md), [연구 규칙](./README.md)
- 제외: 비공개 알고리즘, 독점 프로토콜, 상용 UI 복제, 공개되지 않은 현장 운영 절차 추정

## 1. 한 줄 결론

공개 자료 기준으로 상용 온실 운영자의 실제 일상은 `초기 설정/작기·구역 정의 -> 실시간 모니터링 -> 알람 분류와 확인 -> 필요 시 수동 우선 제어 -> 관수 근거 확인 -> 센서 교정/점검 -> 정전·네트워크 복구 -> 인수인계/지원`의 반복 루프에 가깝다. SmartFarmOS는 현재 이 중 `작기/구역 선택`, `알람 확인`, `ACK 기반 제어 결과`, `소프트웨어 정지`, `관수 전 수위 근거`는 데모 가능하지만, `교정/유지보수 로그`, `알람 전달·에스컬레이션`, `정전 후 운영자 복구 안내`, `인수인계 지원`은 아직 제품 경계 밖이다. 따라서 대회 전에는 새 런타임 기능을 늘리지 말고, [현장 사용성 프로토콜](../usability/field-test-protocol.md)의 3–5명 세션과 시연/문구를 이 간극이 드러나도록 보강하는 편이 맞다.

## 2. 증거 상태

- `확인 사실`: 아래에 인용한 내용은 공식 매뉴얼, 공식 지원 문서, 대학·정부 자료에서 직접 확인한 공개 정보다.
- `추론`: 여러 자료를 종합해 SmartFarmOS에 적용한 해석이다.
- `미확인/claim`: 벤더가 공개적으로 주장하지만 독립 검증이 없는 내용이다. 그대로 복제하거나 성능 사실처럼 쓰지 않는다.

## 3. 워크플로별 조사 결과

### 3.1 Commissioning / 초기 세팅

- `확인 사실`: Ridder CX500 공개 매뉴얼은 딜러 워크플로를 `고객 요구 파악 -> 구성 정의 -> 주변장치 연결 -> Synopta Lite 설치 -> 설정 업로드 -> 라이선스 활성화 -> commissioning` 순서로 설명한다. 또 `time zone`, `date`, `language`, `units of measurement`는 처음부터 정확히 맞춰야 하며, 나중에 바꾸면 `historical data`와 `backup`이 쓸 수 없게 된다고 적는다. ([Ridder CX500 Dealer Manual](https://portal.ridder.com/media/files/rgs/Dealer%20Manual%20CX500%20EN.pdf))
- `확인 사실`: 같은 매뉴얼은 `Document history`를 시스템 변경 로그로, `Controller`를 설정 저장/업로드와 백업/복원 지점으로 둔다. ([Ridder CX500 Dealer Manual](https://portal.ridder.com/media/files/rgs/Dealer%20Manual%20CX500%20EN.pdf))
- `확인 사실`: Priva Connected는 Operator, Notification Center, Access Control, API Services를 한 패키지로 묶고, 시작 시 온라인 교육(Priva Academy) 접근을 제공한다고 밝힌다. ([Priva Connected](https://www.priva.com/horticulture/solutions/digital-services/priva-connected))
- `추론`: 공개 상용 문서에서 commissioning은 단순 설치가 아니라 `권한`, `시간/단위`, `백업`, `네트워크`, `교육`까지 포함한 운영 시작 절차다. SmartFarmOS 데모는 현재 fresh session DB와 seeded farm으로 시작하지만, 이 초기 세팅이 어디까지 준비된 상태인지 제품 안에서 설명하지는 않는다.

### 3.2 구역 / 작기 / 레시피 설정

- `확인 사실`: Priva One은 `climate and irrigation per crop rather than per compartment`를 핵심 기능으로 설명한다. 즉 제어 기준이 설비 구획 자체보다 `crop` 중심이라는 뜻이다. ([Priva One](https://www.priva.com/horticulture/solutions/climate-and-process-computers/priva-one))
- `확인 사실`: Ridder CX500은 grower 요구에 맞는 `tailor-made solution`과 `modular configuration`을 강조하며, 구성 변경 후 새 site file과 라이선스 갱신으로 확장할 수 있다고 설명한다. ([Ridder CX500 Dealer Manual](https://portal.ridder.com/media/files/rgs/Dealer%20Manual%20CX500%20EN.pdf))
- `미확인/claim`: Hoogendoorn은 IIVO를 경험 수준과 관계없이 사용하기 쉬운
  차세대 process computer라고 홍보한다. 이는 제품 claim으로는 의미가 있지만,
  실제 현장 오류율 감소를 독립 증명한 자료는 이번 범위에서 찾지 못했다.
  ([IIVO 공식 페이지](https://hoogendoorn.com/en/our-solutions/iivo/))
- `추론`: 공개 자료들은 공통적으로 `설비별 제어`보다 `작기/작물/구역 맥락`을 먼저 잡는다. SmartFarmOS는 이미 `GrowingArea`와 `CropCycle`을 [아키텍처](../architecture.md)와 구현 경계에 넣었기 때문에, 대회 데모 메시지도 "대시보드"보다 "작기-구역 범위 운영"에 맞추는 편이 낫다.

### 3.3 Daily monitoring / 일일 모니터링

- `확인 사실`: Priva Connected/Operator는 climate, water, lighting, energy의 설정과 측정값을 실시간으로 보고 전략을 조정할 수 있다고 설명한다. ([Priva Connected](https://www.priva.com/horticulture/solutions/digital-services/priva-connected))
- `확인 사실`: Hoogendoorn iSii compact 공개 매뉴얼은 그래프와 주간 보고, ongoing irrigation pause, EC/pH setpoint 변경, active alarm page를 포함한다. 다만 공개 매뉴얼 텍스트상 `Only active alarms are being shown. There is no alarm history.`라고 적는다. ([Hoogendoorn iSii compact type 2 manual](https://www.hoogendoorn.nl/wp-content/uploads/2017/08/iSii-compact-type-2-version-11752-rev-3-EN.pdf))
- `확인 사실`: Cornell의 CEA lettuce handbook은 온실 제어 시스템이 temperature, RH, light, CO2, pH, DO, EC를 모니터링하고, 모니터링 파라미터 범위를 명시해야 한다고 적는다. ([Cornell CEA Lettuce Handbook](https://cea.cals.cornell.edu/files/2019/06/Cornell-CEA-Lettuce-Handbook-.pdf))
- `확인 사실`: Penn State Extension은 greenhouse production 계획에 backup generator를 포함할 수 있다고 권고한다. 이는 모니터링이 설비 가동성 전제 위에서만 의미가 있다는 점을 보여준다. ([Penn State Greenhouse Production](https://extension.psu.edu/greenhouse-production/))
- `추론`: 상용/학술 자료의 일일 모니터링은 단순 최신값 보기보다 `이력`, `그래프`, `알람`, `setpoint`, `운영 맥락`을 같이 본다. SmartFarmOS는 이미 최신/이력/알람/감사까지는 데모 범위에 들어오므로, 대회 메시지는 이 부분을 "현장 운영자용 최소 루프"로 정리하는 편이 좋다.

### 3.4 Alarm triage / acknowledge / escalation

- `확인 사실`: Priva Notification Center는 모든 알람의 overview를 제공하고, 한 줄에 activation/deactivation event를 묶어 보여 주며, 종종 Operator로 direct link를 제공한다고 설명한다. 또한 email, push, SMS 규칙을 설정할 수 있다고 밝힌다. ([Priva Notification Center](https://support.priva.com/hc/en-us/articles/4402991209234-What-is-the-Notification-Center))
- `확인 사실`: Ridder HortiJet Pro 공개 매뉴얼 스니펫은 alarm messages 아래에 `Confirm`과 `Acknowledge` 버튼이 따로 있다고 설명한다. ([Ridder HortiJet Pro manual](https://portal.ridder.com/media/files/rgs/Installation%20and%20User%20Manual%20HortiJet%20Pro%20EN.pdf))
- `확인 사실`: Hoogendoorn fault-finding training은 `Connection lost with control station`, `network alarm`, `communication error`, `check actuations!` 같은 알람/점검 문구를 직접 다룬다. ([Hoogendoorn Fault Finding Module](https://www.hoogendoorn.nl/wp-content/uploads/2015/09/Hoogendoorn-Partner-Training-Module-2-Fault-finding-EN-v3.pdf))
- `확인 사실`: Hoogendoorn과 iSii compact 매뉴얼은 critical process는 컴퓨터 바깥 보호장치나 사용자의 개인 시각 점검으로도 확인해야 한다고 경고한다. ([Hoogendoorn Fault Finding Module](https://www.hoogendoorn.nl/wp-content/uploads/2015/09/Hoogendoorn-Partner-Training-Module-2-Fault-finding-EN-v3.pdf), [Hoogendoorn iSii compact type 2 manual](https://www.hoogendoorn.nl/wp-content/uploads/2017/08/iSii-compact-type-2-version-11752-rev-3-EN.pdf))
- `추론`: 공개 상용 자료에서 알람 처리는 `알람 보기 -> 원인 점검 -> 확인/승인 -> 필요한 사람에게 전달 -> 현장 상태 재확인`의 흐름이다. SmartFarmOS는 [아키텍처](../architecture.md)상 `acknowledges once with an idempotency key`와 cycle-scoped audit을 이미 제공하므로 `ack` 자체는 데모 가능하다. 그러나 외부 알림 규칙, 온콜 스케줄, 기술지원 escalation은 아직 없다.

### 3.5 Manual override / 수동 우선 제어

- `확인 사실`: Priva 지원 문서는 temporary override가 정상 제어보다 우선하며, crop treatment 예시에서 vents/fans를 특정 phase 동안 강제로 열거나 닫을 수 있다고 설명한다. 동시에 override는 위험할 수 있으므로 상태를 그래프와 status로 확인해야 한다고 경고한다. ([Priva temporary overrides](https://support.priva.com/hc/en-us/articles/360013219331-How-do-I-work-with-temperature-influences-and-temporary-overrides))
- `확인 사실`: Ridder HortiJet-Go 공개 매뉴얼 스니펫은 `Manual valve group start`와 `Manual valve start`를 제공한다고 설명한다. ([Ridder HortiJet-Go manual](https://portal.ridder.com/media/files/rgs/Installation%20and%20User%20Manual%20HortiJet-Go%21%20EN.pdf))
- `확인 사실`: Argus Titan 2 공개 문서는 physical design이 failsafe를 허용하지 않을 때 user-configurable alarm과 `fallback to manual override control`을 둔다고 적는다. 또 많은 relay board에 testing/emergency operation용 manual override가 포함된다고 밝힌다. ([Argus Titan 2 System Description](https://arguscontrols.com/uploads/documents/Titan-2-System-Description-Revised-June-2014.pdf))
- `확인 사실`: Argus 2020 brochure도 system-based issue 시 manual overrides가 troubleshooting, repairs, emergency operation을 돕는다고 설명한다. ([Argus Advanced Environmental Control](https://arguscontrols.com/uploads/documents/Advanced-Environmental-Control-Automation-AUS-Nov2020-MK0166-R00_Final_Digital.pdf))
- `추론`: 상용 문서에서 manual override는 예외적이지만 정상적인 운영 워크플로 일부다. SmartFarmOS는 [아키텍처](../architecture.md)의 `즉시 정지 (소프트웨어)`와 V1 `off` stop lane으로 일부를 보여 주지만, 물리 인터록·하드웨어 E-stop 대체재가 아니라는 경계는 계속 강하게 보여 줘야 한다.

### 3.6 Irrigation evidence / 관수 근거

- `확인 사실`: Priva는 irrigation valve alarm 15에 대해 기본 시간 길이가 1시간이며, 여러 밸브가 동시에 시작되면 더 길게 조정해야 할 수 있다고 적는다. 즉 관수 알람 해석은 단순 threshold가 아니라 실행 시간과 queue 문맥을 본다. ([Priva Alarm 15](https://support.priva.com/hc/en-us/articles/360012519899-I-get-an-Alarm-15-valve-cannot-find-water-system-or-takes-to-long-to-finish-cycle-What-should-I-do))
- `확인 사실`: Hoogendoorn iSii compact은 ongoing irrigation cycle을 pause할 수 있고, EC/pH/flow alarm이 나면 irrigation cycle이 멈추며 원인 해소 후 resume된다고 적는다. ([Hoogendoorn iSii compact type 2 manual](https://www.hoogendoorn.nl/wp-content/uploads/2017/08/iSii-compact-type-2-version-11752-rev-3-EN.pdf))
- `확인 사실`: Hoogendoorn quick-start module은 `The pump is stopped during a running irrigation because of an EC alarm` 같은 운영 훈련 과제를 직접 넣는다. ([Hoogendoorn Quick-Start Operation Module](https://www.hoogendoorn.nl/wp-content/uploads/2015/09/Hoogendoorn-Quick-Start-Training-Module-1-Operation-iSii-EN-v1.pdf))
- `확인 사실`: Cornell handbook은 pH 5.8과 EC 범위를 공개적으로 제시하고, 센서 교정과 모니터링을 운영 루틴 일부로 둔다. ([Cornell CEA Lettuce Handbook](https://cea.cals.cornell.edu/files/2019/06/Cornell-CEA-Lettuce-Handbook-.pdf))
- `확인 사실`: UMass 자료는 pH/EC 장비를 매일 사용 전 교정해야 한다고 권고한다. ([UMass Soil Testing](https://www.umass.edu/agriculture-food-environment/greenhouse-floriculture/fact-sheets/soil-testing), [UMass Greenhouse BMP Manual](https://www.umass.edu/agriculture-food-environment/book/export/html/9854))
- `추론`: 실제 관수 근거는 `현재 수위`만이 아니라 `실행 시간`, `EC/pH/flow`, `이전 cycle`, `resume 여부`, `교정 상태`까지 묶여 있다. SmartFarmOS는 현재 [현장 사용성 프로토콜](../usability/field-test-protocol.md)대로 `최근 수위`와 `저수위 알람` 근거를 보여 주는 데까지는 정직하지만, 그 이상을 암시하면 과장이다.

### 3.7 Sensor calibration / 유지보수

- `확인 사실`: Argus sensor troubleshooting guide는 센서가 환경에 노출될 수밖에 없기 때문에 `routine maintenance, calibration, and replacement`가 ongoing cost라고 적는다. 또 troubleshooting step 2를 `Sensor Maintenance and Recalibration`으로 두고, pH/CO2/Wet Bulb sensors 등 periodic cleaning과 recalibration을 먼저 하라고 안내한다. ([Argus Sensor Troubleshooting](https://arguscontrols.com/uploads/documents/Sensor-Troubleshooting-Rev.-May-2008.pdf))
- `확인 사실`: Ridder VitaLite-E and C 공개 매뉴얼 스니펫은 자동 pH sensor calibration 절차를 따로 제공한다. ([Ridder VitaLite-E and C manual](https://portal.ridder.com/media/files/rgs/Installation%20and%20User%20Manual%20Vitalite-E%20en%20C%20EN.pdf))
- `확인 사실`: UMass는 pH/EC 계측기를 매일 fresh standard로 교정하라고 권고한다. ([UMass Soil Testing](https://www.umass.edu/agriculture-food-environment/greenhouse-floriculture/fact-sheets/soil-testing))
- `추론`: 상용/대학 자료 모두 calibration은 백오피스가 아니라 운영자의 주기 작업이다. SmartFarmOS는 아직 센서 교정 상태나 교정 일자 자체를 다루지 않으므로, 대회 전에는 "다루지 않는다"는 문구를 명확히 해야 한다.

### 3.8 Maintenance / 점검 / 변경 기록

- `확인 사실`: Ridder CX500은 document history, backup/restore, firmware upload, network settings를 내부 시스템 사이트에 둔다. ([Ridder CX500 Dealer Manual](https://portal.ridder.com/media/files/rgs/Dealer%20Manual%20CX500%20EN.pdf))
- `확인 사실`: Argus greenhouse control specification은 end-user expectations로 `safe, integrated, and efficient operation`, Internet-based factory service/troubleshooting/support, lockable manual overrides를 요구한다. ([Argus Greenhouse Control Specification](https://arguscontrols.com/uploads/documents/Developing-a-Greenhouse-Control-Specification-August-2-2017.pdf))
- `확인 사실`: Argus brochure는 remote support와 24/7 emergency support를 공개적으로 언급한다. ([Argus Advanced Environmental Control](https://arguscontrols.com/uploads/documents/Advanced-Environmental-Control-Automation-AUS-Nov2020-MK0166-R00_Final_Digital.pdf))
- `추론`: 운영자 관점의 maintenance는 센서 청소만이 아니라 `누가 무엇을 바꿨는지`, `백업이 되는지`, `지원 요청 경로가 있는지`까지 포함한다. SmartFarmOS는 감사/audit은 있으나 maintenance checklist나 support contact flow는 아직 제품 밖이다.

### 3.9 Network outage / recovery

- `확인 사실`: Priva 지원 문서는 backup generator가 일부만 올라오는 환경에서 DHCP server보다 gateway가 먼저 켜지면 잘못된 alternate IP를 잡을 수 있고, 이 경우 gateway power-cycle과 static IP 구성이 필요하다고 설명한다. ([Priva gateway after power failure](https://support.priva.com/hc/en-us/articles/360017686899-Why-does-my-gateway-lose-connection-to-my-office-network-and-the-Priva-Cloud-after-a-power-failure))
- `확인 사실`: UGA Extension은 storm preparation에서 ventilation, cooling, irrigation을 유지하기 위한 backup generator를 준비하라고 권고하고, 사후에는 구조물과 작물 피해를 즉시 기록하고 recovery 비용 기록을 남기라고 적는다. ([UGA hurricane/storm greenhouse damage](https://fieldreport.caes.uga.edu/publications/C1353/hurricane-and-storm-damage-to-greenhouses-and-greenhouse-crops/))
- `확인 사실`: UConn Extension은 farm emergency plan에 power outage 대응 프로토콜을 포함하고, plan을 분기별로 그리고 신규 직원 onboarding 때 다시 검토하라고 권고한다. ([UConn extreme weather operations](https://extension.uconn.edu/publication/extreme-weather-farm-operations/))
- `추론`: 운영자에게 outage recovery는 "다시 연결되면 된다"가 아니라 `전원`, `IP`, `현장 점검`, `기록`, `누구에게 알릴지`가 있는 절차다. SmartFarmOS [아키텍처](../architecture.md)는 `recovery_required`와 ACK outbox non-replay 경계를 정직하게 설명하지만, 운영자용 복구 안내 UX는 아직 없다.

### 3.10 Handover / support / 기록 인수인계

- `확인 사실`: Priva Connected는 Access Control과 Priva Academy를 운영 패키지 일부로 둔다. ([Priva Connected](https://www.priva.com/horticulture/solutions/digital-services/priva-connected))
- `확인 사실`: Argus는 remote support와 24/7 emergency support를 공개 전면에 둔다. ([Argus Advanced Environmental Control](https://arguscontrols.com/uploads/documents/Advanced-Environmental-Control-Automation-AUS-Nov2020-MK0166-R00_Final_Digital.pdf))
- `확인 사실`: UConn은 emergency plan과 연락처, 문서 사본, 리뷰 주기, 신규 직원 onboarding을 handover discipline으로 본다. ([UConn extreme weather operations](https://extension.uconn.edu/publication/extreme-weather-farm-operations/))
- `확인 사실`: MSU IPM 자료는 greenhouse map, sampling record, pest pressure, treatment efficacy 같은 scouting 기록을 남기라고 권고한다. ([MSU Integrated Pest Management in Greenhouse Crops](https://www.canr.msu.edu/resources/integrated_pest_management_in_greenhouse_crops_e3296))
- `추론`: handover는 support 조직이 큰 회사만의 문제가 아니라, 누가 어떤 구역을 보고 어떤 판단으로 어떤 조치를 했는지 남기는 운영 기본이다. SmartFarmOS는 command/audit evidence는 있으나 교대 인수인계 문맥은 아직 약하다.

## 4. SmartFarmOS 현재 저장소와의 대조

### 4.1 현재 확인되는 강점

- `확인 사실`: [아키텍처](../architecture.md)는 `GrowingArea`, `CropCycle`, alarm instance, audit, command history, irrigation strategy application, ACK aggregation, direct-command audit, software stop를 분리해 둔다.
- `확인 사실`: [현장 사용성 프로토콜](../usability/field-test-protocol.md)은 `주의 구역 발견 -> 원인/시점 설명 -> 알람 확인 -> 올바른 구역에 전략 적용 -> 장치 결과와 처리 주체/시각 확인`을 핵심 검증 흐름으로 둔다.
- `추론`: 이는 상용 문서의 operator loop 중 `daily monitoring`, `alarm acknowledgement`, `manual override boundary`, `irrigation evidence 일부`, `command result audit`까지는 대회 범위에서 비교적 정직하게 커버한다.

### 4.2 현재 비어 있거나 약한 부분

- `확인 사실`: 저장소와 [프로젝트 컨텍스트](../../.codex/project.md)는 telemetry buffering, device-state reconciliation, multi-gateway lease, physical interlock, production authentication을 아직 후속 과제로 남긴다.
- `추론`: 공개 자료 기준으로 이 공백은 `정전 후 복구`, `교정/정비`, `지원 escalation`, `handover`, `현장 commissioning`과 직접 연결된다.
- `추론`: 현재 [현장 사용성 프로토콜](../usability/field-test-protocol.md)은 핵심 제어 흐름 검증에는 적합하지만, `작기/구역 초기 설정`, `센서 교정`, `네트워크 단절 후 확인`, `교대 인수인계`는 과업으로 다루지 않는다.

### 4.3 대조표

| 운영 워크플로 | 공개 자료의 공통 요구 | SmartFarmOS 현재 상태 | 대회 전 판단 |
| --- | --- | --- | --- |
| Commissioning | 시간/단위/권한/백업/교육을 시작 시 고정 | fresh demo DB와 seeded data는 있으나 운영자용 commissioning 설명은 약함 | 런타임 추가 없이 시연 문구/대본으로만 보완 |
| 구역/작기 설정 | crop/zone 중심 범위 설정 | `GrowingArea`/`CropCycle` 있음 | 유지 |
| 일일 모니터링 | 실시간 값 + 이력 + 알람 + 보고 | 최신/이력/비교/알람 가능 | 유지 |
| 알람 triage/ack | overview, 원인 점검, 확인, 전달 | acknowledge/audit 있음, external escalation 없음 | 인정하고 범위 고정 |
| 수동 우선 제어 | override priority + 위험 경고 | software stop/직접 제어 있음 | 물리 안전 대체 아님을 더 명확히 |
| 관수 근거 | 수위만이 아니라 EC/pH/flow/시간 문맥 | water-level/low-water evidence까지만 제공 | 범위 밖 문구 강화 |
| 센서 교정 | 주기 교정/청소/기록 | 없음 | 대회 후 |
| maintenance/support | 변경 이력, 백업, 원격 지원 | 일부 audit만 있음 | 대회 후 |
| outage/recovery | 발전기, static IP, recovery plan | `recovery_required` 경계만 있음 | 시연/문구로 비주장 고정 |
| handover | 기록, 연락처, onboarding, support path | 세션 프로토콜은 있으나 제품 UX는 없음 | 대회 후 |

## 5. 대회 전 제안: 새 런타임 기능이 아니라 3–5명 세션·시연·문구만

### 5.1 사용성 세션 보강

1. 현재 5개 핵심 과업은 유지하고, 디브리핑 질문만 추가한다.
   - "새 작기를 시작할 때 지금 화면에서 먼저 확인하거나 입력하고 싶은 정보는 무엇인가요?"
   - "센서값이 이상하면 이 화면 바깥에서 무엇을 먼저 확인하시겠나요?"
   - "정전/통신 끊김 뒤 다시 들어왔을 때 꼭 보여야 하는 문구는 무엇인가요?"
   - "교대자에게 무엇을 남기고 싶나요?"
   이 추가 질문은 새 기능 요구가 아니라 운영 문맥 격차를 확인하는 용도다.
2. 참가자 기록표에 용어 혼동을 별도 항목으로 넣는다.
   - 예: `확인`, `승인`, `적용`, `완료`, `정지`, `감사 기록`, `농장 전체 직접 제어`
3. 3–5명 중 최소 1명에게는 "알람 확인 후 누가 언제 처리했는지"를 말로 다시 설명하게 해서 handover 표현을 검증한다.

### 5.2 시연 흐름 보강

1. 데모 시작 15초 안에 `시뮬레이터`, `seeded 작기/구역`, `실장비/교정/정전복구 미포함`을 명시한다.
2. 알람 확인 뒤에는 반드시 "현장에서는 센서/배관/펌프를 추가 점검해야 한다"는 말을 붙인다. Hoogendoorn과 Argus 공개 문서 모두 critical process의 시각 점검과 외부 보호장치를 요구한다. ([Hoogendoorn Fault Finding Module](https://www.hoogendoorn.nl/wp-content/uploads/2015/09/Hoogendoorn-Partner-Training-Module-2-Fault-finding-EN-v3.pdf), [Argus Titan 2 System Description](https://arguscontrols.com/uploads/documents/Titan-2-System-Description-Revised-June-2014.pdf))
3. 전략 적용 시에는 "최근 수위/저수위 알람 근거를 보고 사람이 승인한다"는 메시지로 한정하고, EC/pH/flow 기반 폐루프처럼 들리는 표현은 피한다.
4. `즉시 정지 (소프트웨어)` 시연 후에는 "물리 비상정지 대체재가 아니다"를 한 번 더 반복한다.

### 5.3 문구 개선

1. `ACK 기반 완료 상태`를 말로 풀어 쓰기:
   - 예: "장치가 최종 상태를 보고했고 그 결과가 서버 감사 기록에 반영됨"
2. `농장 전체 직접 제어`는 cycle 소유를 암시하지 않게 유지:
   - 현재 direct-command audit V2 설계와 일치해야 한다.
3. `전략 적용` 주변 문구는 `자동 관수`보다 `검토된 프리셋 실행`에 가깝게 유지한다.
4. outage/recovery 관련 질문이 나오면 "현재 데모는 복구 계획이 아니라 복구 필요 상태를 숨기지 않는 데 초점을 둔다"는 문구를 준비한다.

## 6. 대회 후 제품 backlog

아래는 `대회 후` 후보이며, 이번 제출 범위로 올리면 안 된다.

1. commissioning checklist, time/unit/network/backup 상태 표면화
2. 센서 교정 일자, 교정 담당자, suspect/stale 상태 기록
3. 알람 전달 규칙, on-call, handover note, support contact
4. outage recovery runbook와 operator-facing `recovery_required` 설명 UX
5. irrigation evidence에 EC/pH/flow/calibration 문맥 추가
6. maintenance log, firmware/config change history, restore proof
7. 실장비용 physical interlock 및 software stop 구분 UX

## 7. 최종 판단

- `확인 사실`: 공개 상용 문서는 운영자의 실제 일상이 `제어 한 번`이 아니라 `설정, 점검, 기록, 복구, 인수인계`의 루프임을 보여 준다. ([Priva Connected](https://www.priva.com/horticulture/solutions/digital-services/priva-connected), [Ridder CX500 Dealer Manual](https://portal.ridder.com/media/files/rgs/Dealer%20Manual%20CX500%20EN.pdf), [Hoogendoorn Fault Finding Module](https://www.hoogendoorn.nl/wp-content/uploads/2015/09/Hoogendoorn-Partner-Training-Module-2-Fault-finding-EN-v3.pdf), [Argus Greenhouse Control Specification](https://arguscontrols.com/uploads/documents/Developing-a-Greenhouse-Control-Specification-August-2-2017.pdf))
- `추론`: SmartFarmOS는 대회 전에는 이 전체 루프를 구현하려고 범위를 넓히기보다, 이미 있는 `구역/작기 + 알람 + ACK + 감사 + software stop boundary`를 3–5명 세션과 시연 문구로 더 정직하게 전달해야 한다.
- `추론`: 대회 후 backlog는 충분히 유효하지만, 지금은 제품 확장보다 사용자 검증과 비주장 정리가 우선이다.

## 8. 직접 URL 로그

아래 URL들은 이번 문서 작성에 직접 확인하거나 교차확인용으로 사용한 공개 자료다.

1. https://www.priva.com/horticulture/solutions/climate-and-process-computers/priva-one
2. https://www.priva.com/horticulture/solutions/digital-services/priva-connected
3. https://support.priva.com/hc/en-us/articles/4402991209234-What-is-the-Notification-Center
4. https://support.priva.com/hc/en-us/articles/360013219331-How-do-I-work-with-temperature-influences-and-temporary-overrides
5. https://support.priva.com/hc/en-us/articles/360017686899-Why-does-my-gateway-lose-connection-to-my-office-network-and-the-Priva-Cloud-after-a-power-failure
6. https://support.priva.com/hc/en-us/articles/360012519899-I-get-an-Alarm-15-valve-cannot-find-water-system-or-takes-to-long-to-finish-cycle-What-should-I-do
7. https://portal.ridder.com/media/files/rgs/Dealer%20Manual%20CX500%20EN.pdf
8. https://portal.ridder.com/media/files/rgs/Installation%20and%20User%20Manual%20HortiJet%20Pro%20EN.pdf
9. https://portal.ridder.com/media/files/rgs/Installation%20and%20User%20Manual%20HortiJet-Go%21%20EN.pdf
10. https://portal.ridder.com/media/files/rgs/Installation%20and%20User%20Manual%20Vitalite-E%20en%20C%20EN.pdf
11. https://www.hoogendoorn.nl/wp-content/uploads/2017/08/iSii-compact-type-2-version-11752-rev-3-EN.pdf
12. https://www.hoogendoorn.nl/wp-content/uploads/2015/09/Hoogendoorn-Partner-Training-Module-2-Fault-finding-EN-v3.pdf
13. https://www.hoogendoorn.nl/wp-content/uploads/2015/09/Hoogendoorn-Quick-Start-Training-Module-1-Operation-iSii-EN-v1.pdf
14. https://www.hoogendoorn.nl/wp-content/uploads/2018/07/Module-2-Hoogendoorn-iSii-Quick-Start-Controls-EN-v8-rev3.pdf
15. https://hoogendoorn.com/en/our-solutions/iivo/
16. https://support.hoogendoorn.nl/portal/en/kb/articles/https-support-hoogendoorn-nl-portal-kb-articles-en-isii-compact-how-can-i-change-a-setpoint-strategy
17. https://arguscontrols.com/uploads/documents/Titan-2-System-Description-Revised-June-2014.pdf
18. https://arguscontrols.com/uploads/documents/Developing-a-Greenhouse-Control-Specification-August-2-2017.pdf
19. https://arguscontrols.com/uploads/documents/Sensor-Troubleshooting-Rev.-May-2008.pdf
20. https://arguscontrols.com/uploads/documents/Advanced-Environmental-Control-Automation-AUS-Nov2020-MK0166-R00_Final_Digital.pdf
21. https://www.umass.edu/agriculture-food-environment/greenhouse-floriculture/fact-sheets/soil-testing
22. https://www.umass.edu/agriculture-food-environment/book/export/html/9854
23. https://extension.psu.edu/greenhouse-production/
24. https://fieldreport.caes.uga.edu/publications/C1353/hurricane-and-storm-damage-to-greenhouses-and-greenhouse-crops/
25. https://extension.uconn.edu/publication/extreme-weather-farm-operations/
26. https://www.canr.msu.edu/resources/integrated_pest_management_in_greenhouse_crops_e3296
27. https://cea.cals.cornell.edu/files/2019/06/Cornell-CEA-Lettuce-Handbook-.pdf
