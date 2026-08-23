# SmartFarmOS 공개 데이터셋·시뮬레이션·평가 설계 조사

- 조사 기준일: 2026-08-12
- 대상: SmartFarmOS의 현재 결정적 시뮬레이터를 더 현실적인 검증 도구로 확장하기 위한 공개 데이터, 공개 시뮬레이션, 장애 주입, 평가 지표
- 로컬 맥락:
  - [아키텍처](../architecture.md)
  - [현장 사용성 프로토콜](../usability/field-test-protocol.md)
  - [국내 표준·데이터 조사](./korea-standards-and-data.md)
  - [현재 device simulator README](../../tools/device-simulator/README.md)
- 제외:
  - 비공개 제어 알고리즘 복제
  - 제조사 비공개 프로토콜 역설계
  - 대회 전 실장비 적합성·물리 안전 주장
  - Kaggle 같은 2차 호스팅을 원 출처처럼 취급하는 행위

## 한 줄 결론

SmartFarmOS는 대회 전에는 현재 결정적 시뮬레이터와 복구 검증을 고정하고,
`실측 데이터 재생 fixture + 결정적 장애 주입`은 대회 후 첫 검증 확장으로 두는
편이 맞다. WUR Autonomous Greenhouse Challenge와 GreenLight 계열 공개 자료는
**fixture와 시나리오 설계의 근거**로 매우 유용하지만, GreenLight/Modelica/
EnergyPlus급 물리모델을 코어 데모에 붙이면 구현·검증 비용이 크고 현재 데모
안정성을 해칠 가능성이 높다.

## 사실·추론·미확인

- `사실`: 아래 표와 본문에서 직접 URL로 확인한 내용
- `추론`: SmartFarmOS 현재 구조와 공개 자료를 함께 보고 내린 설계 판단
- `미확인`: 공개 랜딩 페이지에서 라이선스 세부, 샘플 payload, 실제 quota, 데이터 품질 메타데이터까지 직접 확인하지 못한 항목

## 현재 SmartFarmOS 기준선

현재 [device simulator](../../tools/device-simulator/README.md)는 `temperature`, `humidity`, `illuminance`, `water_level` 텔레메트리를 결정적으로 내보내고, `smartfarm.command.v1` 즉시 펌프 상태 전환과 `smartfarm.command.v2`의 `run_pump_for`를 시뮬레이터 로컬 타이머로 처리한다. [`tools/device-simulator/src/simulator.ts`](../../tools/device-simulator/src/simulator.ts) 기준으로 텔레메트리는 단조 증가 `sequence`와 `observedAt`을 갖고, 명령은 idempotency 충돌, scope mismatch, 만료, 실행 중 충돌, manual stop causal ACK를 다룬다.

반면 [아키텍처](../architecture.md)는 여전히 MQTT, 오프라인 텔레메트리 버퍼링, 장치 상태 재조정, 다중 Edge 소유권, 생산 인증, 물리 안전을 남은 공백으로 둔다. 따라서 이번 조사에서 우선순위는 "더 똑똑한 제어기"가 아니라 다음 세 가지다.

1. 텔레메트리가 현실적으로 더 지저분해졌을 때도 UI와 API가 버티는가
2. 재부팅·지연·중복·결측·시간 왜곡이 있어도 ACK와 감사 경로가 망가지지 않는가
3. 현장 사용성 프로토콜이 요구하는 오구역 제출 0건, pending 중복 제출 0건을 계속 지키는가

## 데이터셋 비교

### 우선순위가 높은 데이터셋

| 데이터셋 | 원 출처 | 공개 확인 범위 | 시간 해상도·범위 | 접근·라이선스 | 품질·개인정보 | SmartFarmOS 적합성 | 판단 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WUR AGC 1st Edition 2018 cucumber | WUR Research Portal, DOI `10.4121/uuid:e4987a7b-04dd-4c89-9b18-883aad30ba9a` | 온실 기후, 관수, 외기, setpoint, 수확, crop management, resource consumption, 6개 glasshouse compartment, 4개월 cucumber 실험 | 2018-08~2018-12, 4개월 | 공개 DOI 랜딩 페이지 확인. 세부 라이선스 조항은 랜딩 페이지에서 직접 미확인 | 개인식별정보 언급 없음. 구획 단위라 재식별 위험 낮음 | 관수/외기/자원 소비를 함께 가진 공개 온실 제어 데이터로 가치가 높다 | `adapt` |
| WUR AGC 2nd Edition 2019 tomato | WUR Research Portal, DOI `10.4121/uuid:88d22c60-21b3-4ea8-90db-20249a5be2a7` | 외기·실내 기후, 관수, actuator 상태, 요청/실현 setpoint, 자원 소비, 수확, 토마토 품질, 배액·슬랩 정보 | 6개월 cherry tomato, 6개 compartment | 공개 DOI 랜딩 페이지 확인. 세부 라이선스는 미확인 | 농장 운영자 식별보다는 실험실 구획 데이터 중심으로 보임 | SmartFarmOS의 `control + telemetry + alarm evidence` fixture에 가장 바로 쓸 수 있다 | `adopt` |
| WUR AGC 3rd Edition lettuce 2022 | WUR Research Portal, DOI `10.4121/21960932` | realized climate 시계열과 annotated lettuce images | 랜딩 페이지에서 2022 Bleiswijk, 실험시설 데이터 공개 확인 | 공개 DOI 랜딩 페이지 확인. 라이선스 세부는 미확인 | 이미지 포함. 사람 PII보다는 작물 영상 위주 | 카메라/이미지 없이도 기후 시계열 fixture로 사용 가능. 다만 현재 SmartFarmOS MVP와 직접 연결성은 AGC2보다 약함 | `adapt` |
| WUR AGC 4th pre-trial dwarf tomato | WUR Research Portal, DOI `10.4121/e1ee9de9-6ce9-4502-a37c-34b5b1372bed` | RGBD 개체 이미지 479개, 2개월 canopy camera, 수동 측정, 외기, camera-derived plant traits | 2개월, 96m² research greenhouse | 공개 DOI 랜딩 페이지 확인. 라이선스 세부는 미확인 | 이미지/형질 데이터 중심, 개인정보 위험 낮음 | 현재 SmartFarmOS 데모의 센서/제어 경로보다는 대회 후 CV·생육 lane에 적합 | `defer` |
| WUR AGC 4th dwarf tomato timeseries and images | WUR Research Portal, DOI `10.4121/fa102772-32db-4b30-bace-12f2016722ce` | 5분 간격 greenhouse climate, control state, weather, yield 관련 plant measurement, canopy RGBD | 5-minute interval, 2개월 dwarf tomato | 공개 DOI 랜딩 페이지 확인. 라이선스 세부는 미확인 | 이미지 포함, PII 낮음 | 5분 간격이라 SmartFarmOS 실시간 데모보다 느리지만, **replay fixture의 현실적 패턴**으로 매우 좋다 | `adopt` |
| GreenLight 측정+시뮬레이션 데이터 | WUR Research Portal, DOI `10.4121/78968e1b-eaea-4f37-89f9-2b98ba3ed865` | 2009-2010 Bleiswijk trial, outdoor weather, indoor climate, greenhouse control actions, LED/HPS 시뮬레이션 결과 | 2009-10-19~2010-02-08, 특정 lighting 조건 | 공개 DOI 랜딩 페이지 확인. 관련 논문은 open access | 사람 PII 위험 낮음 | 실측과 시뮬레이션 결과를 같이 볼 수 있어 `fixture replay vs model replay` 비교 기준으로 좋다 | `adopt` |
| SmartFarm Korea Data Mart OpenAPI | 공공데이터포털 `15121334` | 농가·작기 식별정보, 작물별 환경·생육·제어 데이터, 온도·습도·CO₂, 양액·광·관수, 생육 단계 지표 | 시간 범위·샘플링 간격은 랜딩 페이지에서 미확인 | 무료, 이용허락 범위 제한 없음, 개발계 자동승인 / 운영계 수동심사, 트래픽은 제공기관 정책에 따라 변동 | 농가·작기 식별정보가 있어 재식별·약관 검토 필요 | 국내 현장 적합성은 높지만, 샘플 품질과 비식별 정책을 먼저 확인해야 한다 | `adapt` |
| KMA Open MET Data Portal | 기상청 Open MET | 30종 이상 기상데이터, 100년 이상 통계, Open API 제공 | 기상 종류별 상이 | 공개 포털·Open API 확인 | 개인정보 위험 매우 낮음 | 한국 온실 외기 forcing을 만드는 데 적합 | `adopt` |
| NASA POWER Hourly API | NASA POWER | 시간별 solar·meteorological data, JSON/CSV/NetCDF, EPW 제공, UTC/LST 제공 | 시간별, 파라미터 최대 20개/point | 공개 API 문서 확인 | 개인정보 위험 매우 낮음 | 대회 후 GreenLight/EnergyPlus 입력용 외기 생성에 유용. 한국 농장의 현지 관측 대체로는 한계 | `adapt` |

### 참고용이지만 시뮬레이터 직접 입력으로는 약한 데이터셋

| 데이터셋 | 원 출처 | 공개 확인 범위 | SmartFarmOS 적합성 | 판단 |
| --- | --- | --- | --- | --- |
| USDA NASS Quick Stats | USDA NASS Developers / Quick Stats | 미국 농업 생산 전반의 공식 통계, API 최대 50,000 records, JSON/CSV/XML | 시설원예 제어 fixture가 아니라 품목·지역·시기 기준의 집계 통계다. 운영 KPI나 장기 벤치마크에는 쓸 수 있지만 실시간 제어 시뮬레이터 입력에는 부적합 | `defer` |
| FAOSTAT | FAO Statistics / FAOSTAT API portal | 245개국 이상, 1961년부터 최신 연도까지의 식량·농업 통계, JSON/CSV API | 글로벌 비교·시장/정책 맥락에는 좋지만 온실 기후·관수 시계열이 아니다 | `defer` |

### 데이터셋 관련 사실

- `사실`: WUR AGC 4th timeseries dataset은 "5-minute interval greenhouse climate, control state and weather data"를 포함한다고 명시한다.  
  출처: <https://research.wur.nl/en/datasets/4th-autonomous-greenhouse-challenge-dwarf-tomato-timeseries-and-i/>
- `사실`: SmartFarm Korea Data Mart OpenAPI는 농가·작기 식별정보와 온도, 습도, CO₂, 양액, 광, 관수, 생육 단계 지표를 제공한다고 명시한다.  
  출처: <https://www.data.go.kr/en/data/15121334/openapi.do>
- `사실`: USDA Quick Stats API는 한 요청당 최대 50,000건을 반환하고 JSON/CSV/XML을 지원한다.  
  출처: <https://quickstats.nass.usda.gov/api>, <https://www.nass.usda.gov/developer/index.php>
- `사실`: FAOSTAT은 245개국 이상, 1961년부터 최신 연도까지의 통계를 제공하며 2026-04-13에 API developer portal을 발표했다.  
  출처: <https://www.fao.org/statistics/en>, <https://www.fao.org/statistics/highlights-archive/highlights-detail/faostat-launches-a-new-api-developer-portal-to-make-data-access-easier/en>

## 공개 시뮬레이션·디지털 트윈 후보

| 후보 | 원 출처 | 공개 확인 범위 | SmartFarmOS에 주는 값 | 대회 전 판단 |
| --- | --- | --- | --- | --- |
| 현재 SmartFarmOS deterministic simulator | 로컬 코드와 README | 4개 metric, 단조 증가 sequence, idempotency/expiry/manual stop 처리, device-local timed pump | 지금 당장 테스트 가능한 기준선 | `adopt` |
| GreenLight | GitHub `davkat1/GreenLight`, WUR 논문/데이터 | BSD-3-Clause-Clear, horticultural greenhouse and crop simulation, location-specific simulation 가이드, open science 지향 | 실제 외기와 모델 파라미터를 주입해 온실 climate trajectory를 생성하는 출발점 | `defer` |
| Greenhouses Modelica Library | ReadTheDocs + GitHub | Modelica 기반 open-source greenhouse climate library, heating/ventilation/crop yield, pre-programmed climate/HVAC control, Modelica License 2 | 에너지·설비 연동까지 포함한 고충실도 시스템 모델 | `defer` |
| EnergyPlus | DOE/NREL/Big Ladder 공식 문서 | whole-building energy simulation, Hourly weather file 연계, EPW 활용 가능 | 외피·에너지·외기 조건 sensitivity study | `defer` |
| NASA POWER + KMA weather drivers | NASA POWER, KMA Open MET | 시간별·통계형 외기 소스 | GreenLight/EnergyPlus 입력 또는 시뮬레이션 replay 외기 forcing | `adapt` |

### 시뮬레이션 관련 사실

- `사실`: GreenLight GitHub는 이 프로젝트를 "horticultural greenhouses and crops"를 위한 동적 모델 플랫폼으로 설명하고, 특정 위치 시뮬레이션 가이드를 둔다.  
  출처: <https://github.com/davkat1/GreenLight>
- `사실`: Greenhouses Modelica Library는 greenhouse construction elements, indoor climate, heating systems, ventilation systems, crop yield, pre-programmed control systems를 포함한다고 설명한다.  
  출처: <https://greenhouses-library.readthedocs.io/en/latest/>
- `사실`: NASA POWER Hourly API는 analysis-ready hourly solar and meteorological data를 JSON/CSV/NetCDF로 제공하고, EPW는 SB community에 제공된다고 문서화한다.  
  출처: <https://power.larc.nasa.gov/docs/services/api/temporal/hourly/>

### 시뮬레이션 관련 추론

- `추론`: WUR/국내 공개 데이터에서 관측된 **결측, 지연, 구간별 추세,
  명령 후 반응 지연**을 시뮬레이터에 재생하는 것은 GreenLight를 실시간
  제어 루프에 넣는 것보다 우선이지만, 현재 대회 제출 게이트 뒤에 진행한다.
- `추론`: GreenLight/Modelica/EnergyPlus는 코드 데모의 기본 시뮬레이터를 대체하기보다, 대회 후 `fixture 생성기` 또는 `what-if batch evaluator`로 쓰는 편이 아키텍처 경계와 맞다.
- `미확인`: GreenLight 2.x Python 계열이 현재 SmartFarmOS 리포지토리의 CI/로컬 데모 속도 제약 안에서 충분히 가볍게 돌 수 있는지는 아직 검증하지 않았다.

## 대회 후 첫 최소 확장안

### 권장 구조

```text
public dataset / weather source
  -> import script (offline, reviewed)
  -> normalized fixture JSON/CSV
  -> perturbation layer
      - missing
      - duplicate
      - delay
      - drift
      - timestamp skew
      - reboot / replay marker
  -> current device simulator contract
  -> existing Edge/API/PWA demo
```

### 최소 산출물

1. `fixture` 2~3개
   - `wur-agc2-bed-low-water.json`
   - `wur-agc4-5min-replay.json`
   - `smartfarm-korea-sample-normalized.json` 또는 데이터 접근이 어려우면 명세 문서만
2. `scenario manifest` 1개
   - 정상
   - 저수위
   - 과습
   - 센서 고착
   - 결측/지연
   - 재부팅/ACK 재전송
3. 문서
   - fixture 출처
   - 단위/시간대/결측 처리 규칙
   - 시나리오 기대 결과

### 지금 하지 말 일

- GreenLight 또는 Modelica를 데모 기본 런타임으로 바꾸기
- 실시간 외부 API 의존으로 데모 재현성을 깨기
- 실제 농가 식별정보가 남는 SmartFarm Korea 원본을 그대로 저장소 fixture로 넣기
- "디지털 트윈 완성" 같은 과장된 표현 사용

## 시나리오 카탈로그

| 시나리오 | 주입 방법 | 검증해야 할 것 | 적용 시점 |
| --- | --- | --- | --- |
| 정상 baseline | 현재 deterministic 패턴을 재생 | 텔레메트리 유효성, sequence 단조 증가, UI 최신값/이력 표시 | 현재 회귀 유지; WUR replay는 대회 후 |
| 저수위 | `water_level`만 임계치 아래로 서서히 하강 | 알람 개시, 올바른 구역 강조, 승인형 전략 적용, ACK/감사 기록 | 현재 회귀 유지 |
| 과습 | `water_level` 또는 배액 관련 surrogate를 높게 유지 | 무조건 관수 추천하지 않는지, 오구역 적용 억제 문구 유지 | 대회 후 |
| 고 VPD | `temperature` 상승 + `humidity` 하락 조합을 fixture에서 재생 | VPD 파생 계산 또는 설명용 경고가 future lane으로 타당한지 평가 | 대회 후 |
| 센서 고착(flatline) | 값은 동일, `observedAt`과 sequence만 증가 또는 둘 다 정지 | stale/suspect 표기, 정상으로 오인하지 않음 | 대회 후 |
| 결측 burst | N개 샘플 누락 또는 null equivalent | UI가 마지막 정상값과 결측 상태를 구분 | 대회 후 |
| 지연/지터 | `observedAt`은 과거, 도착 시각은 늦게 반영 | stale 판단, 오경보/중복 알람 억제 | 대회 후 |
| 시계 skew | 미래 timestamp 또는 과거로 역행하는 timestamp 주입 | time-order 검증, replay/중복 처리, 감사 시각 혼란 방지 | 대회 후 |
| sequence gap | `1,2,5,6`처럼 번호 비연속 | 수집 경고, silently accept 여부 기록 | 대회 후 |
| 중복 샘플 | 동일 `id` 또는 동일 payload 재전송 | idempotent 처리와 중복 시각화 억제 | 대회 후 |
| out-of-order | 최신값 이후 더 오래된 값 도착 | latest projection 오염 방지 | 대회 후 |
| 재부팅 중 timed run | 실행 중 Edge restart marker 삽입 | 현재 설계의 `recovery_required`가 정확히 노출되는지 | 현재 회귀 유지 |
| ACK 저장 후 전달 전 장애 | terminal ACK 저장 후 API 전달 실패를 강제 | exactly-once가 아니라 `no duplicate actuation + durable replay`가 지켜지는지 | 현재 회귀 유지 |
| 네트워크 단절 | 일정 기간 telemetry/ACK 업로드 차단 | 오프라인 안내, 재연결 후 회복, 잘못된 성공 표시 금지 | ACK 회귀는 현재; telemetry buffer는 대회 후 |
| 명령 충돌 | timed run 중 새 activation 또는 stop과 activation 동시성 | execution_failed, manual_stop causal ACK, pending 중복 제출 0건 | 현재 회귀 유지 |
| scope mismatch | 다른 device/farm scope command 삽입 | reject와 감사 경계 유지 | 현재 회귀 유지 |
| 외기 급변 | KMA/NASA 또는 WUR weather replay에서 급격한 irradiance/temperature 변화 | 향후 weather-aware control/UX용 기준선 | 대회 후 |

## 장애 주입 방법 제안

### 1. 재생 기반 주입

실측 또는 공개 데이터셋을 정규화한 뒤 그대로 재생한다.

- 장점: 가장 쉽게 "사람이 만든 사인파"가 아닌 현실 패턴을 얻음
- 단점: 현재 계약에 없는 변수는 버리거나 파생해야 함

권장 첫 대상:

1. WUR AGC2 tomato
2. WUR AGC4 5-minute dwarf tomato
3. GreenLight 실측+시뮬레이션 비교 데이터

### 2. 결정적 변형 계층

재생 fixture 위에 다음 변형을 deterministic seed로 얹는다.

- offset drift: 20분 동안 일정 bias 증가
- stuck-at: 특정 시점부터 동일값 반복
- dropout: N개 샘플 생략
- replay duplicate: 같은 샘플 재송신
- reorder: 최근 2개 샘플 순서 교환
- timestamp skew: `+90s`, `-300s`
- command/ack lag: ACK를 n초 늦게 전달
- reboot marker: timed run 중 프로세스 재시작처럼 상태 전환

이 방식은 현재 SmartFarmOS 시뮬레이터의 결정성과 잘 맞고, 테스트 재현성도 유지된다.

### 3. 대회 후 물리모델 보강

- GreenLight로 외기와 제어 setpoint에서 climate trajectory 생성
- Greenhouses Modelica Library로 에너지·환기·HVAC coupling 검증
- EnergyPlus는 greenhouse crop physiology보다는 외피·에너지 민감도 분석에 한정

## 평가 지표 제안

### 텔레메트리 수집 지표

| 지표 | 의미 |
| --- | --- |
| schema_valid_rate | 계약 검증을 통과한 샘플 비율 |
| monotonic_sequence_rate | 역행 없는 sequence 비율 |
| duplicate_drop_rate | 중복 샘플 억제율 |
| stale_detection_latency | 마지막 정상 관측 이후 stale 상태로 바뀌기까지의 시간 |
| timestamp_skew_detected | 미래/과거 왜곡 탐지 건수 |
| replay_recovery_gap | 재연결 후 누락 없이 회복한 구간 비율 |

### 제어·ACK 지표

| 지표 | 의미 |
| --- | --- |
| command_accept_to_terminal_ack | 명령 수락부터 terminal ACK까지 걸린 시간 |
| duplicate_actuation_count | 동일 의도에 대해 실제 장치 actuation이 중복된 횟수 |
| ack_replay_success | 저장된 ACK가 재전송 후 중앙 projection과 일치한 횟수 |
| manual_stop_preemption_success | timed run을 stop이 우선 중단한 성공률 |
| conflicting_command_reject_rate | 실행 중 충돌 명령을 정확히 실패/거절한 비율 |

### UX·운영 지표

현장 사용성 프로토콜과 직접 연결되는 지표다.

| 지표 | 의미 |
| --- | --- |
| wrong_target_submit | 잘못된 구역 제출 횟수. 목표는 0 |
| pending_duplicate_submit | pending 상태에서 중복 적용 횟수. 목표는 0 |
| result_location_accuracy | 사용자가 결과와 처리 주체/시각을 정확히 찾은 비율 |
| stale_label_accuracy | stale·offline·error를 참가자가 구분한 비율 |
| alarm_to_action_time | 저수위 인지부터 올바른 프리셋 적용까지 걸린 시간 |

### 시뮬레이터 충실도 지표

이 부분은 대회 후에만 본격화한다.

| 지표 | 의미 |
| --- | --- |
| trajectory_rmse | 실측 대비 temperature/humidity 등 경로 오차 |
| event_timing_error | 저수위 도달, 회복, 명령 반응 등 이벤트 시점 오차 |
| control_outcome_match | 같은 입력 조건에서 상태 전이 방향이 실측과 얼마나 일치하는지 |
| scenario_coverage | catalog에 정의한 장애 유형 중 자동 재현 가능한 비율 |

## 채택·보류 결정

| 제안 | 결정 | 이유 |
| --- | --- | --- |
| WUR AGC replay fixture 도입 | `adopt` | 공개 접근 가능하고, 온실 climate/control/weather가 함께 있어 현재 MVP와 가장 잘 맞음 |
| SmartFarm Korea 원본 fixture 직접 커밋 | `reject` | 농가·작기 식별정보와 이용 조건 검토가 먼저다 |
| SmartFarm Korea를 정규화 규격 설계 근거로 사용 | `adapt` | 국내성은 높지만 비식별·단위·quota 확인이 선행돼야 한다 |
| KMA/NASA 외기 forcing 추가 | `adapt` | fixture·post-contest model input에 유용하지만 대회 기본 데모 의존성으로 넣을 필요는 없다 |
| GreenLight를 대회 전 기본 런타임으로 통합 | `defer` | 모델링·검증·성능 비용이 큼 |
| Greenhouses Modelica Library 연계 | `defer` | 에너지/HVAC까지 넓어져 현재 MVP 범위를 넘음 |
| EnergyPlus 기반 디지털 트윈 | `defer` | greenhouse crop control보다 건물 에너지 분석에 더 적합 |
| 장애 주입용 deterministic perturbation layer | `adopt` | 현재 simulator와 가장 자연스럽게 맞물리고 재현성이 좋음 |

## 2026-08-27 대회 전 실행안

1. 현재 simulator contract와 검증 시나리오를 변경하지 않는다.
2. 이 문서의 데이터셋·시나리오 후보를 결과보고서의 대회 후 로드맵에만 쓴다.
3. 실제 사용자 3–5명, 권리·라이선스·자격증명, 최종 보고서·영상·Git 재현성
   게이트에 시간을 집중한다.
4. SmartFarm Korea는 실제 sample payload와 약관 검토 전까지 저장소 fixture로
   넣지 않는다.

## 대회 후 로드맵

1. WUR fixture 2개와 scenario manifest 1개를 출처·라이선스 검토 후 만든다.
2. 현재 계약은 바꾸지 않고 import 단계에서 공개 데이터를 정규화한다.
3. `stuck`, `missing`, `delay`, `reboot`, `ack replay` 장애를 deterministic seed로 추가한다.
4. GreenLight batch runner로 외기 forcing 기반 synthetic trajectory를 만들고
   실측+시뮬레이션 model-vs-replay evaluator를 구성한다.
5. Greenhouses Modelica 또는 EnergyPlus는 에너지·설비 민감도 분석 lane으로 분리한다.
6. VPD, drain, CO₂, screen, ventilation은 실제 센서·계약 검토 후 확장한다.
7. 공개 데이터 train/validation/test split과 reproducible benchmark를 문서화한다.

## 불확실성과 추가 확인

- `미확인`: WUR 각 DOI의 세부 사용허락 문구를 랜딩 페이지 바깥까지 직접 확인하지 못했다.
- `미확인`: SmartFarm Korea Data Mart의 실제 응답 예시, 시계열 간격, quota, 필드별 비식별 수준을 아직 실호출로 검증하지 않았다.
- `미확인`: NASA POWER EPW 접근 제한의 정확한 SB community 범위와 재배포 조건을 별도 검토하지 않았다.
- `미확인`: EnergyPlus를 greenhouse crop control digital twin으로 쓰는 공식 예제가 있는지는 이번 조사 범위에서 확인하지 못했다.

## 원 출처 목록

- WUR Autonomous Greenhouse Challenge overview: <https://www.wur.nl/en/research/plant/autonomous-greenhouse-challenge>
- WUR AGC 1st edition dataset: <https://research.wur.nl/en/datasets/autonomous-greenhouse-challenge-first-edition-2018/>
- WUR AGC 2nd edition dataset: <https://research.wur.nl/en/datasets/autonomous-greenhouse-challenge-second-edition-2019/>
- WUR AGC 3rd edition dataset: <https://research.wur.nl/en/datasets/3rd-autonomous-greenhouse-challenge-time-series-data-on-realized-/>
- WUR AGC 4th pre-trial dataset: <https://research.wur.nl/en/datasets/4th-autonomous-greenhouse-challenge-pre-trial-dwarf-tomato-measur/>
- WUR AGC 4th timeseries dataset: <https://research.wur.nl/en/datasets/4th-autonomous-greenhouse-challenge-dwarf-tomato-timeseries-and-i/>
- WUR GreenLight paper/data landing pages:
  - <https://research.wur.nl/en/publications/greenlight-an-open-source-model-for-greenhouses-with-supplemental/>
  - <https://research.wur.nl/en/datasets/data-from-greenlight-an-open-source-model-for-greenhouses-with-su>
- GreenLight GitHub: <https://github.com/davkat1/GreenLight>
- Greenhouses Modelica Library docs: <https://greenhouses-library.readthedocs.io/en/latest/>
- USDA NASS developer portal: <https://www.nass.usda.gov/developer/index.php>
- USDA Quick Stats API: <https://quickstats.nass.usda.gov/api>
- FAO Statistics / FAOSTAT:
  - <https://www.fao.org/statistics/en>
  - <https://www.fao.org/statistics/highlights-archive/highlights-detail/faostat-launches-a-new-api-developer-portal-to-make-data-access-easier/en>
- SmartFarm Korea Data Mart OpenAPI: <https://www.data.go.kr/en/data/15121334/openapi.do>
- KMA Open MET Data Portal: <https://data.kma.go.kr/resources/html/en/aowdp.html>
- NASA POWER home/docs:
  - <https://power.larc.nasa.gov/>
  - <https://power.larc.nasa.gov/docs/services/api/temporal/hourly/>
