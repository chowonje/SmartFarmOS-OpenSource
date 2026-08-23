# SmartFarmOS 상용 온실·CEA 제품 지형도

- 조사 기준일: 2026-08-12
- 조사 범위: 각 회사의 공식 웹사이트, 공식 API/Swagger, 공식 도움말/매뉴얼, 공식 약관·보안·지원 페이지
- 프로젝트 맥락: [SmartFarmOS 아키텍처](../architecture.md), [기능 격차](../feature-parity.md), [Priva 벤치마크](../benchmarks/priva-one.md)
- 제외: 비공개 알고리즘·프로토콜 역설계, 독점 UI/문구 복제, 회사가 주장한 수율 향상 수치를 독립 사실처럼 재사용하는 행위

## 1. 한 줄 결론

SmartFarmOS가 지금 당장 따라야 할 축은 "새 기후 컴퓨터를 통째로 재현"이
아니라, 이미 구현한 `중앙 API + Edge + 작물/구역 중심 UX + 감사 가능한
제어`를 대회 증거로 고정하는 것이다. 표준 데이터/API, 자율 제어·예측·고급
최적화는 대회 이후 선택형 계층으로 올린다. 이 결론은 [현재 아키텍처가 이미
브라우저 앱, 중앙 API, Edge, ACK 저널, 구역/작기/알람/전략 모델을 분리해
두었고](../architecture.md), [남은 공백이 MQTT, 오프라인 텔레메트리, 장치
상태 재조정, 다중 Edge 소유권, 생산 인증, 물리 안전, 상호운용성에 집중돼
있기 때문](../architecture.md)이다.

## 2. 이번 조사에서 확인된 시장 구조

공개 자료 기준으로 상용 시장은 대체로 두 층으로 나뉜다.

1. 현장 제어 중심 제품군
   - [Priva One](https://www.priva.com/), [Hoogendoorn IIVO](https://hoogendoorn.com/en/our-solutions/iivo), [Ridder Hortimax Pro/Go/Plus](https://ridder.com/process-automation/climate-computers), [Argus TITAN](https://arguscontrols.com/products-and-solutions/control-systems/titan-system), [Autogrow](https://www.autogrow.com/)
   - 공통점: 기후·관수·에너지·알람·현장 제어를 한 시스템으로 묶고, 설치·지원·확장 파트너를 제품 일부로 본다.

2. 데이터·자율운영 상위 계층
   - [LetsGrow.com](https://www.letsgrow.com/), [Blue Radix Crop Controller](https://blue-radix.com/solutions/), [Source Workspace / Irrigation Control](https://www.source.ag/solutions), [Koidra DataPilot / KoPilot](https://www.koidra.ai/cea/)
   - 공통점: 기존 climate computer와 센서 위에 데이터 통합, 알람, 대시보드, 전략 검증, 자율 관수·기후 제어를 얹는다.

SmartFarmOS는 현재 구조상 1층의 "안전한 제어 경계"와 2층의 "작물 중심 운영 UX"를 일부 갖고 있고, 아직 1층의 현장 신뢰성과 2층의 분석·자율화 사이를 메우는 단계에 있다. 따라서 제품 전략도 같은 두 층을 분리하는 편이 맞다.

## 3. 회사별 조사

### 3.1 Priva

Priva는 이미 [별도 벤치마크 문서](../benchmarks/priva-one.md)에 정리돼 있으므로 여기서는 최신성만 다시 확인했다. 2026-08-12 기준으로 [Priva 메인 사이트는 Priva One을 "하나의 crop-focused system"으로 소개하고](https://www.priva.com/), [온실 데이터 통합 페이지는 open platform과 외부 파트너 연결을 계속 전면에 두며](https://www.priva.com/horticulture/solutions/digital-services/integrate-greenhouse-data), [API Services 도움말은 secure Priva cloud를 통한 데이터 접근을 명시하고](https://support.priva.com/hc/en-us/articles/6253313360796-What-are-Horticulture-API-Services), [Notification Center 시작 문서는 Edge Gateway 등록과 Access Control 권한을 요구한다](https://support.priva.com/hc/en-us/articles/4402991271826-How-can-I-start-using-the-Notification-Center). 전략 결론은 기존 [Priva 벤치마크](../benchmarks/priva-one.md)와 바뀌지 않는다.

- 확인된 사실:
  - 클라우드 서비스만이 아니라 [Edge Gateway](https://support.priva.com/hc/en-us/articles/4402991271826-How-can-I-start-using-the-Notification-Center), [Access Control 감사 로그](https://support.priva.com/hc/en-us/articles/6301230347154-Audit-logs), [API Services](https://support.priva.com/hc/en-us/articles/6253313360796-What-are-Horticulture-API-Services)를 묶어 판다.
- 근거 기반 추론:
  - SmartFarmOS도 PWA 화면보다 `권한/감사/API/Edge`를 더 제품 핵심으로 봐야 한다.
- SmartFarmOS 결정:
  - `채택`: 작물 중심 범위, 권한/감사, 파트너 API.
  - `변형`: Priva형 통합은 유지하되 국내 중소형 운영자용으로 더 좁고 명시적인 안전 경계를 둔다.
  - `보류`: 멀티사이트 상용 운영 패키지화.
  - `거부`: Priva 화면/명칭/문구 모사.

### 3.2 Hoogendoorn IIVO

[IIVO 공식 페이지](https://hoogendoorn.com/en/our-solutions/iivo)는 기후, CO2, 수분 사용량을 지속 모니터링하고 데이터를 수집·보관하며, 센서 데이터·날씨 예보·과거 학습을 조합해 작물별 기후를 예측적으로 만든다고 설명한다. [Hoogendoorn Online](https://hoogendoorn.com/trainingen/hoogendoorn-online)는 고객·파트너·직원을 위한 보안 대시보드, 기술 문서, 교육 영상, 지원 진입점을 제공한다.

- 확인된 사실:
  - IIVO는 [기후, CO2, water usage를 통합 감시하고 데이터를 아카이브](https://hoogendoorn.com/en/our-solutions/iivo)한다.
  - [날씨 예보와 과거 학습을 활용하는 predictive control 서사](https://hoogendoorn.com/en/our-solutions/iivo)를 공개적으로 사용한다.
  - [제품 문서·지원·교육 포털을 별도로 운영](https://hoogendoorn.com/trainingen/hoogendoorn-online)한다.
- 근거 기반 추론:
  - Hoogendoorn은 제어 알고리즘만큼 운영 지식 전달과 파트너 지원 체계를 제품화하고 있다.
  - SmartFarmOS가 장기적으로 경쟁하려면 "기능 나열"보다 운영 지식과 현장 온보딩 흐름이 필요하다.
- SmartFarmOS 결정:
  - `채택`: 예측 제어를 위한 날씨/과거 데이터 결합, 문서·지원 포털 개념.
  - `변형`: 대회 후에는 예측 제어보다 "이력+목표선+편차 설명"부터 검토.
  - `보류`: 본격 predictive control.
  - `거부`: 비공개 "past learnings" 로직의 추정 복제.

### 3.3 Ridder Hortimax

[Ridder의 climate computers 페이지](https://ridder.com/process-automation/climate-computers)는 climate, irrigation, energy를 통합 제어하고 modular/scalable design, open connectivity, real-time insights를 핵심 가치로 제시한다. [Hortimax Pro 페이지](https://ridder.com/hortimax-pro)는 "open and modular platform"과 "intelligent automation"을 강조한다. [Blue Radix 협업 발표](https://ridder.com/insights/news/ridder-and-blue-radix-commitment-to-an-open-and-connected-future-for-horticulture)는 Ridder climate computer 기능이 API를 통해 안전하게 Blue Radix 알고리즘에 노출된다고 밝힌다. [Hortimax Plus 발표](https://ridder.com/insights/news/ridder-expands-possibilities-with-hortimax-plus)는 모바일 앱, 알람 알림, third-party sensor 통합, Ridder IoT를 언급한다.

- 확인된 사실:
  - [기후·관수·에너지 통합 제어](https://ridder.com/process-automation/climate-computers).
  - [개방형 연결성](https://ridder.com/process-automation/climate-computers)과 [open and modular platform](https://ridder.com/hortimax-pro).
  - [Blue Radix와의 공식 API 연동](https://ridder.com/insights/news/ridder-and-blue-radix-commitment-to-an-open-and-connected-future-for-horticulture).
  - [모바일 앱, 알람 알림, third-party sensor 연동](https://ridder.com/insights/news/ridder-expands-possibilities-with-hortimax-plus).
- 근거 기반 추론:
  - Ridder는 "완전 폐쇄형 단일 스택"보다 `자사 climate computer + 외부 AI/센서` 조합을 상용 강점으로 밀고 있다.
  - SmartFarmOS도 나중에 모든 알고리즘을 내장하기보다 안정적 계약과 파트너 연결을 우선해야 한다.
- SmartFarmOS 결정:
  - `채택`: 공개 계약, 외부 알고리즘 연결 가능성, 모바일 알람·제어.
  - `변형`: 외부 AI는 대회 후; 대회 전에는 현재 전략 엔진과 명령 감사를 유지.
  - `보류`: third-party sensor marketplace 수준의 생태계.
  - `거부`: 장치·센서 vendor-specific 결합을 초기 코어에 하드코딩.

### 3.4 Argus TITAN

[Argus TITAN 페이지](https://arguscontrols.com/products-and-solutions/control-systems/titan-system)는 setpoints, recipes, schedules, BMS HVAC 연계, climate/light/CO2/irrigation/nutrient delivery 통합, evapotranspiration model을 공개한다. [TITAN 2 System Description PDF](https://arguscontrols.com/uploads/documents/Titan-2-System-Description-Revised-June-2014.pdf)는 동적 climate target, energy balance calculation, resource rationing limits, irrigation decision과 delivery capacity 분리를 설명한다. [2020 Argus brochure PDF](https://arguscontrols.com/uploads/documents/Advanced-Environmental-Control-Automation-AUS-Nov2020-MK0166-R00_Final_Digital.pdf)는 Titan 900 UI, graphs, API, smart reporting, Argus Live 모바일/PC 접근을 설명한다. [Commercial Horticulture 페이지](https://arguscontrols.com/applications/commercial-horticulture-indoor-greenhouse)는 24/7 모니터링, nutrient injection, plant-centric algorithms를 언급한다.

- 확인된 사실:
  - [기후·관수·비료·조명·CO2를 하나의 모델링 프로그램으로 통합](https://arguscontrols.com/products-and-solutions/control-systems/titan-system).
  - [동적 target scheduling, energy balance, resource rationing](https://arguscontrols.com/uploads/documents/Titan-2-System-Description-Revised-June-2014.pdf).
  - [API, smart reporting, customizable graphs, Argus Live 모바일/PC UI](https://arguscontrols.com/uploads/documents/Advanced-Environmental-Control-Automation-AUS-Nov2020-MK0166-R00_Final_Digital.pdf).
  - [관수 의사결정과 관수 시스템 용량 관리를 분리하는 설계](https://arguscontrols.com/uploads/documents/Titan-2-System-Description-Revised-June-2014.pdf).
- 근거 기반 추론:
  - Argus는 현장 설비 제약을 제어 모델 안으로 넣는 쪽에 강하고, SmartFarmOS의 현재 강점인 "command lifecycle"보다 훨씬 넓은 설비 통합을 한다.
  - 관수 의사결정과 실행 용량 분리는 SmartFarmOS의 전략 도메인 설계에 매우 유용하다.
- SmartFarmOS 결정:
  - `채택`: strategy와 execution capacity 분리, schedule/recipe 구조, energy-aware target 개념.
  - `변형`: 대회 전에는 ET/MPC 대신 명시적 목표와 제한값 중심.
  - `보류`: BMS/HVAC/boiler까지 포함한 시설 전체 제어.
  - `거부`: SmartFarmOS를 즉시 "시설 전체 OS"로 넓히는 범위 확장.

### 3.5 LetsGrow.com

[LetsGrow.com 메인 사이트](https://www.letsgrow.com/)와 [solutions 페이지](https://www.letsgrow.com/solutions/)는 greenhouse data centralization, smart analytics, expert advice, strategy building을 전면에 둔다. [ISO 인증 페이지](https://www.letsgrow.com/iso-certification/)는 ISO 27001/9001, 정보 기밀성·무결성·가용성 보장을 명시한다. [공식 API 안내](https://support.letsgrow.com/portal/en/kb/articles/api-documentation)는 MyLetsGrow.com에 데이터를 직접 import/export하는 Web API가 있음을 확인한다. 이전에 공개 검색된 Swagger 상세는 현재 직접 endpoint가 404를 반환하므로 인증 방식, path 개수, schema를 최신 사실로 고정하지 않는다.

- 확인된 사실:
  - [데이터 통합, 분석, 재배 전략 지원이 제품 중심](https://www.letsgrow.com/solutions/).
  - [ISO 27001/9001 보유와 정보 보안 약속](https://www.letsgrow.com/iso-certification/).
  - [공식 Web API 안내](https://support.letsgrow.com/portal/en/kb/articles/api-documentation)에서 platform import/export API 존재 확인.
- 근거 기반 추론:
  - LetsGrow는 하드웨어 제어기 제조사라기보다 데이터 플랫폼·컨설팅·분석 계층에 더 가깝다.
  - SmartFarmOS는 이 계층에서 국내 중소형 온실 파일럿에 맞는 차별화를
    검증할 수 있다. 특히 "명령 증거·데이터 신뢰도·전략 검토·알람·비교"는
    현재 코드베이스와 잘 맞는다. 국내 표준 호환이 완료됐다는 뜻은 아니다.
- SmartFarmOS 결정:
  - `채택`: 중앙 데이터 플랫폼, 보안 명시, API-first 태도.
  - `변형`: OAuth2/JWT 운영 방식은 참고하되 생산 인증은 별도 검토 후 도입.
  - `보류`: crop consultant용 원격 자문 기능.
  - `거부`: 분석 결과를 사람 검토 없이 자율 제어와 동일 계층에 혼합.

### 3.6 Blue Radix

[Crop Controller 솔루션 페이지](https://blue-radix.com/solutions/)는 autonomous climate and irrigation control, 개인 지원, 농가 전략 정렬을 전면에 둔다. [4개 모듈 설명 페이지](https://blue-radix.com/one-central-control-point-for-your-greenhouse-climate-irrigation-strategy-and-knowledge-fully-integrated/)는 실시간 데이터, weather forecasts, crop behavior에 따라 기후와 관수를 계속 업데이트한다고 설명한다. 다만 Blue Radix 자체 사이트에서는 일반 개발자용 공개 API를 찾지 못했고, 공식 공개 통합 방식은 [Ridder와의 API 협업 발표](https://ridder.com/insights/news/ridder-and-blue-radix-commitment-to-an-open-and-connected-future-for-horticulture)처럼 climate computer vendor 경유 형태가 더 분명하다.

- 확인된 사실:
  - [자율 기후·관수 제어를 하나의 서비스로 판매](https://blue-radix.com/solutions/).
  - [실시간 데이터, 날씨 예보, crop behavior를 기반으로 setpoint를 갱신](https://blue-radix.com/one-central-control-point-for-your-greenhouse-climate-irrigation-strategy-and-knowledge-fully-integrated/).
  - [기술만이 아니라 Autonomous Greenhouse Managers 같은 인적 지원을 함께 둔다](https://blue-radix.com/solutions/).
  - [Ridder API를 통해 연동되는 공식 사례](https://ridder.com/insights/news/ridder-and-blue-radix-commitment-to-an-open-and-connected-future-for-horticulture).
- 근거 기반 추론:
  - Blue Radix는 독립 제어기보다 "기존 제어기 위의 자율 운영 레이어"에 가깝다.
  - SmartFarmOS가 이후 자율화에 가더라도 먼저 해야 할 일은 API/권한/감사/override 경계다.
- SmartFarmOS 결정:
  - `채택`: operator override, 자율화와 인간 승인 공존, 설명 가능한 대시보드.
  - `변형`: 대회 전에는 "반자동 추천 + 승인 후 실행" 수준으로 제한.
  - `보류`: 24/7 완전 자율 climate/irrigation.
  - `거부`: 설명 불가능한 black-box 제어를 초기 핵심에 넣는 것.

### 3.7 Source.ag

[Source Workspace](https://www.source.ag/products/source-workspace)는 중앙화된 실시간 데이터, 표준화된 crop registration, performance benchmark를 제공한다. [FAQ](https://www.source.ag/faq)는 Plant App -> climate computer/infra data -> Track/Workspace -> Cultivate -> Irrigation Control로 이어지는 제품 흐름을 설명한다. [Source sensor API](https://www.source.ag/source-api)는 grower authorization 아래 sensor provider가 센서를 만들고 실시간 데이터를 보낼 수 있게 한다. 별도의 공식 발표는 [harvest API](https://www.source.ag/news/source-ag-launches-the-source-api-for-harvest)를 설명한다. [Irrigation Control](https://www.source.ag/products/irrigation-control)은 water/nutrient delivery 자동화와 top climate computer와의 연계를 내세운다.

- 확인된 사실:
  - [중앙 데이터 플랫폼과 KPI/plant balance 가시화](https://www.source.ag/products/source-workspace).
  - [제품 간 데이터 흐름: Plant App -> Track/Workspace -> Cultivate -> Irrigation Control](https://www.source.ag/faq).
  - [센서 API와 grower authorization 기반 연동](https://www.source.ag/source-api),
    [별도 harvest API 공개 발표](https://www.source.ag/news/source-ag-launches-the-source-api-for-harvest).
  - [Irrigation Control이 top climate computer와 연동되는 자율 관수 계층](https://www.source.ag/products/irrigation-control).
  - [Source Track/Workspace 호환성 FAQ는 "all sensors and climate computers"를 주장](https://www.source.ag/faq)하지만, 실제 통합 범위는 파트너/온보딩 조건을 따를 가능성이 크다.
- 근거 기반 추론:
  - Source는 "현장 제어기 교체"보다 "데이터 표준화 + 자율 관수 + 수확 예측"의 상위 운영 체계를 파는 회사다.
  - SmartFarmOS는 Source처럼 `작물/구역 비교 -> 전략 검토 -> 실행 -> 결과 피드백` 루프를 강화할 가치가 있다.
- SmartFarmOS 결정:
  - `채택`: 표준화된 crop registration, benchmark/compare, grower-authorized sensor API.
  - `변형`: 대회 전에는 harvest prediction보다 area comparison과 irrigation evidence에 집중.
  - `보류`: Source Cultivate급 예측 수량 모델.
  - `거부`: 앱 시작부터 iPad 전용 입력 전제를 두는 UX.

### 3.8 Koidra

[CEA 솔루션 페이지](https://www.koidra.ai/cea/)는 DataPilot와 KoPilot을 분리해 보여준다. DataPilot은 [crop·climate data 통합, mobile crop registration, smart alarms, custom metrics](https://www.koidra.ai/cea/)를 제공하고, KoPilot은 [adaptive control, boundary 기반 safety, operator override, 시각화 대시보드](https://www.koidra.ai/cea/)를 강조한다. [KoPilot 상세 페이지](https://www.koidra.ai/cea/kopilot/)는 기존 시스템·센서 위에서 작동한다고 설명한다. [Terms of Service](https://www.koidra.ai/terms-of-service/)는 User Agreement, SLA, Privacy Policy, Security Practices를 별도 문서로 둔다.

- 확인된 사실:
  - [DataPilot: 통합 대시보드, 모바일 crop input, smart alarms, custom metrics](https://www.koidra.ai/cea/).
  - [KoPilot: adaptive real-time climate/irrigation control, built-in safety, operator override](https://www.koidra.ai/cea/).
  - [기존 시스템·센서와의 통합을 전제](https://www.koidra.ai/cea/kopilot/).
  - [SLA, Privacy, Security Practices를 공개 링크로 분리](https://www.koidra.ai/terms-of-service/).
- 근거 기반 추론:
  - Koidra는 Source보다 제어 쪽이 더 강하고, Blue Radix보다 운영 데이터 제품화를 더 전면에 둔다.
  - SmartFarmOS는 Koidra처럼 분석 계층과 자율 제어 계층을 분리하는 편이 설계상 안전하다.
- SmartFarmOS 결정:
  - `채택`: Smart alarms, operator override, analytics/control 이원화.
  - `변형`: 경계 기반 안전은 현재 ACK/stop fence/expiry/idempotency와 결합해 구현.
  - `보류`: 완전 adaptive control.
  - `거부`: 안전 경계 없이 "AI가 알아서 한다"는 메시지.

### 3.9 Autogrow

[Autogrow 메인 사이트](https://www.autogrow.com/)는 automation and control solutions, remote management를 내세운다. [Autogrow Lab 소개](https://lab.autogrow.com/docs/en/intro.html)는 RESTful APIs로 장치 데이터 조회와 third-party device integration, 자체 웹앱 구축을 지원한다고 설명한다. [API v3 문서](https://lab.autogrow.com/docs/en/v3-api.html)는 Multigrow 구독 장치 데이터에 대해 공식 REST API v3를 제공한다고 밝힌다.

- 확인된 사실:
  - [원격 관리 가능한 automation and control provider 포지셔닝](https://www.autogrow.com/).
  - [RESTful API, third-party device integration, 자체 웹앱 연동 가능](https://lab.autogrow.com/docs/en/intro.html).
  - [v3 API는 구독된 Multigrow 장치 데이터에 한해 사용 가능](https://lab.autogrow.com/docs/en/v3-api.html).
- 근거 기반 추론:
  - Autogrow는 대형 현장 제어기 벤더들보다 개발자·통합 친화성이 비교적 높은 편이다.
  - SmartFarmOS가 오픈소스 전략을 강화하려면 이런 "공식 개발자 표면"이 중요하다.
- SmartFarmOS 결정:
  - `채택`: 개발자용 문서화, 외부 연동용 공식 표면.
  - `변형`: 공개 API는 읽기 전용부터 시작하고, 쓰기 제어는 훨씬 좁게 연다.
  - `보류`: 광범위한 외부 쓰기 API.
  - `거부`: 인증·범위 제한 없이 장치 제어 API 공개.

## 4. SmartFarmOS에 실제로 필요한 공통 원리

이번 조사에서 SmartFarmOS에 유효한 공통 원리는 아래 여섯 가지다.

1. 제어기와 운영 콘솔을 분리하되 연결은 강하게 한다.
   - [Priva의 Edge Gateway + Access Control + API Services](https://support.priva.com/hc/en-us/articles/4402991271826-How-can-I-start-using-the-Notification-Center), [Ridder의 open connectivity](https://ridder.com/process-automation/climate-computers), [Source의 grower-authorized sensor API](https://www.source.ag/source-api), [Koidra의 existing systems integration](https://www.koidra.ai/cea/kopilot/)이 모두 이 패턴이다.

2. 기후·관수·에너지·알람은 별개 메뉴가 아니라 같은 운영 맥락에 있어야 한다.
   - [Ridder](https://ridder.com/hortimax-pro), [Argus](https://arguscontrols.com/products-and-solutions/control-systems/titan-system), [Blue Radix](https://blue-radix.com/solutions/)가 모두 climate + irrigation를 하나의 운영 코어로 다룬다.

3. 데이터 통합은 기능이 아니라 제품의 전제다.
   - [Source Workspace](https://www.source.ag/products/source-workspace), [LetsGrow.com](https://www.letsgrow.com/solutions/), [Koidra DataPilot](https://www.koidra.ai/cea/)은 모두 중앙화된 운영 데이터 없이는 상위 기능이 성립하지 않음을 전제로 한다.

4. 자율화보다 먼저 override, alarm, audit, safety boundary가 온다.
   - [Koidra built-in safety와 operator override](https://www.koidra.ai/cea/), [Priva audit logs](https://support.priva.com/hc/en-us/articles/6301230347154-Audit-logs), [Ridder app/alarm notifications](https://ridder.com/insights/news/ridder-expands-possibilities-with-hortimax-plus)가 이 점을 보여준다.

5. 사업 모델은 공개 가격보다 구독·온보딩·지원·파트너를 중심으로 움직인다.
   - [Source](https://www.source.ag/greenhouse-owners), [Blue Radix](https://blue-radix.com/solutions/), [LetsGrow](https://www.letsgrow.com/solutions/), [Ridder](https://ridder.com/process-automation/climate-computers), [Autogrow](https://lab.autogrow.com/docs/en/v3-api.html)는 대부분 데모·구독·지원 전제를 둔다.

6. 공개 API가 있는 회사일수록 데이터 계층 확장성이 높다.
   - [Priva API Services](https://support.priva.com/hc/en-us/articles/6253313360796-What-are-Horticulture-API-Services), [LetsGrow Web API](https://support.letsgrow.com/portal/en/kb/articles/api-documentation), [Source APIs](https://www.source.ag/source-api), [Autogrow API](https://lab.autogrow.com/docs/en/v3-api.html).

## 5. SmartFarmOS 결정표

| 항목 | 대회 전 | 대회 후 |
| --- | --- | --- |
| 작물/구역 중심 운영 범위 | `유지` - 현재 [CropCycle/GrowingArea 구조](../architecture.md)를 핵심 데모로 쓴다. 새 런타임 범위는 추가하지 않는다. | `확장 검토` |
| 비교 가능한 텔레메트리 이력 | `유지` - [현재 24포인트/4지표 비교](../architecture.md)를 그대로 증명한다. | `고급화` - 기간 선택, 목표선, downsampling, 장기 보관, cost overlays |
| 알람 + 확인 + 감사 | `유지` - [이미 있는 alarm/audit 경로](../architecture.md)를 핵심 데모로 유지한다. | `확장` - rule templates, escalation, delivery providers |
| 명령/전략과 실행 분리 | `유지` - 현재 전략·명령·ACK·감사 경계를 설명한다. | `확장` - 장치 그룹/용량/자원 제약 |
| 공개 읽기 API | `보류` - 현재 내부 API와 제출 증거를 고정한다. | `변형 채택` - 농장/구역/텔레메트리/알람 읽기부터 시작하고 파트너 쓰기는 별도 안전 검토 |
| 외부 센서/서비스 연동 | `보류` - 파일/수동 등록 수준만 고려 | `채택` - vendor-neutral adapter 계층 |
| MQTT 오프라인 큐 / device shadow / lease | `보류` - 중요한 공백이지만 현재 제출 병목이 아니며 검증 범위가 크다. | `단계 채택` - 실장비·단절·다중 Edge 시험과 함께 |
| 자율 climate/irrigation control | `보류` - 대회 전에는 추천/승인형만 가능 | `선별 채택` - 충분한 감사/override/물리 안전 뒤에 |
| 수확 예측·생산 계획 | `보류` | `선별 채택` - Source/Koidra 계열 참고 |
| 현장 안전·생산 인증 | `문서화` - 현재 비주장과 파일럿 진입 조건을 유지 | `필수` - 실장비 pilot 전 물리 증거 필요 |

## 6. 적용 우선순위

### 6.1 대회 전 필수 — 새 기능이 아니라 제출 증거

1. 현재 작물/구역 비교, 알람, 전략·명령·ACK·감사 흐름의 범위를 잠근다.
2. 실제 농업 사용자 또는 도메인 대리 사용자 3–5명의 과업 증거를 확보한다.
3. 자격증명, 출처·권리, 프로젝트 라이선스, AI 고지의 소유자 게이트를 끝낸다.
4. 결과보고서·발표·3분 이내 영상에서 현재 기능과 비주장을 일치시킨다.
5. 상용사 조사는 향후 방향의 근거로만 사용하고 구현 완료나 성능 비교로
   바꾸지 않는다.

### 6.2 대회 후 유망

1. 생산 신원·RBAC·자격증명 회전과 물리 안전
2. 장치 상태 재조정, 텔레메트리 버퍼, 선택형 MQTT, 단일 Edge lease/fencing
3. grower-authorized sensor/read API와 표준 export adapter
4. 전략 버전 비교·rollback, 고급 알람·notification delivery
5. 충분한 데이터와 현장 검증 뒤 예측 생산 계획과 선택형 자율 관수/기후 모듈

## 7. 하지 말아야 할 것

- `거부`: 현 시점에서 SmartFarmOS를 Argus/Priva 급 "시설 전체 통합 제어기"로 포장하는 것
- `거부`: Blue Radix/Koidra류 자율 제어를 감사·override·물리 안전 없이 바로 붙이는 것
- `거부`: 특정 벤더의 센서/제어기를 코어 데이터 모델에 하드코딩하는 것
- `거부`: 레거시의 뉴스/지도/시세처럼 운영 코어와 무관한 범위를 다시 넓히는 것
- `거부`: 회사의 마케팅 수율 수치를 SmartFarmOS 계획 근거로 삼는 것

## 8. 최종 판단

SmartFarmOS의 최적 포지션은 "국내 중소형 시설원예 파일럿을 목표로 한
운영·감사 콘솔"이다. 프로젝트는 오픈소스 공개를 목표로 하지만 현재는
권리·라이선스 확정 전이다. [현재 구조처럼](../architecture.md) 브라우저는 중앙
API만 보고, 중앙 API는 감사 가능한 제어와 데이터 권한을 관리하며, Edge는
검증된 명령 경계와 ACK outbox를 책임지는 구조를 더 단단히 하는 편이 맞다.
물리 안전과 텔레메트리 버퍼는 아직 제공한다고 주장하지 않는다. 상용사 조사
결과도 이 방향을 지지한다. 차이는 상용사는 이미 설치·지원·통합 생태계를
갖췄고, SmartFarmOS는 아직 그 이전 단계라는 점이다.

따라서 대회 전 목표는 "상용사처럼 모든 것을 한다"가 아니라 아래 다섯 가지를 명확히 증명하는 것이다.

1. 작물/구역 중심으로 현재 상태와 이력을 비교할 수 있다.
2. 이상을 알람으로 보고 확인·감사할 수 있다.
3. 전략 적용과 수동 제어가 모두 범위·만료·중복·ACK·stop fence 아래에서 동작한다.
4. 클라우드 장애나 Edge 재시작에 대한 최소 신뢰성 설계가 있다.
5. 내부 versioned 계약과 데이터 경계가 있다. 공개 read/export API와 외부
   transport는 대회 후다.

이 다섯 가지가 되면 Priva/Ridder/Source/Koidra 계열의 공개된 핵심 논리와는 같은 방향에 서게 된다. 그 다음에야 자율화와 예측을 얹을 차례다.

## 9. 미확인 사항

- 각 회사의 비공개 실제 제어 알고리즘, 현장 장애 처리 세부, 실계약 가격, 실제 SLA 수치, 정확한 배포 아키텍처 내부 구성은 공개 자료만으로 확인할 수 없었다.
- [Argus의 일부 상세 설명은 2014 PDF](https://arguscontrols.com/uploads/documents/Titan-2-System-Description-Revised-June-2014.pdf)와 [2020 PDF](https://arguscontrols.com/uploads/documents/Advanced-Environmental-Control-Automation-AUS-Nov2020-MK0166-R00_Final_Digital.pdf)에 의존하므로, 최신 UI와 운영 방식 일부는 달라졌을 수 있다.
- [Blue Radix](https://blue-radix.com/solutions/)는 공개 사이트에서 범용 개발자 API를 확인하지 못했다. 공개 통합 표면은 [Ridder API 연동 발표](https://ridder.com/insights/news/ridder-and-blue-radix-commitment-to-an-open-and-connected-future-for-horticulture) 같은 파트너 경유 사례가 더 선명하다.
- [LetsGrow API](https://support.letsgrow.com/portal/en/kb/articles/api-documentation)의 상세 권한 모델, endpoint schema, 실제 고객별 기능 차이는 현재 공개 안내만으로 확정할 수 없다.
