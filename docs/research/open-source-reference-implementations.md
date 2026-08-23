# 스마트팜·IoT 오픈소스 구현 비교

- 조사일: 2026-08-12
- 범위: 공식 저장소, 공식 문서, GitHub release·repository metadata
- 원칙: 코드를 복사하거나 의존성을 추가하지 않았다. 표의 라이선스는 발견된
  SPDX 또는 저장소 파일이며 SmartFarmOS와의 법적 호환성을 확정하지 않는다.
- 대회 경계: 아래 후보는 설계·운영 UX·어댑터 참고자료다. 대회 전 production
  dependency 추가는 `0`으로 유지한다.

## 후보 비교

| 후보 | SHA 고정 공식 근거 | 라이선스 | default HEAD / 활동 | 주 언어 | 재사용할 원리 | 통합 비용 | 판정 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| farmOS | [README](https://github.com/farmOS/farmOS/blob/3fe0ce7e23de807be9b8bc97a211ce934327db39/README.md#L12-L21) | GPL-2.0 | `3fe0ce7e`; 4.0.4, 2026-07-16 | PHP | 농장 자산·작업·기록 중심 도메인과 API·module 확장 방식 | 중상 | 개념 `adapt` |
| OpenAg Device Software | [README](https://github.com/OpenAgricultureFoundation/openag-device-software/blob/848d6d92817d670690e23dbd0816a425ff18dfee/README.md#L2-L11) | GPL-3.0 | `848d6d92`; 마지막 release 0.1.1은 2018, repo push는 2026-03 | Python | CEA 로컬 loop, UI/API, MQTT device-manager 경계 | 중 | Edge 참고 `adapt` |
| OpenAg Brain Balena wrapper | [README](https://github.com/OpenAgricultureFoundation/openag-brain-balena/blob/30a51000133bda1cb24d15dbfdc64a5ead8d87ba/README.md#L1-L5) | 감지되지 않음 | `30a51000`; release 없음, 2022-06 이후 push 없음 | Shell | 배포 wrapper와 core를 분리해 보아야 한다는 반례 | 낮음 | `defer` |
| ThingsBoard | [README](https://github.com/thingsboard/thingsboard/blob/684f92bbfd0cf48015b6e42f5592bc0c2fc18038/README.md#L5-L18) | Apache-2.0 | `684f92bb`; 4.3.1.3, 2026-06-30 | Java | multi-tenant 장치 관리, telemetry UX, rule pipeline | 높음 | 플랫폼 도입 `defer` |
| ThingsBoard Gateway | [README](https://github.com/thingsboard/thingsboard-gateway/blob/846e133e226551ca22f9a6d3b3644110762acc83/README.md#L3-L24) | Apache-2.0 | `846e133e`; 3.8.4, 2026-08-05 | Python | legacy protocol을 중앙 계약으로 정규화하는 gateway/connector 구조 | 중 | 어댑터 원리 `adapt` |
| Mainflux 역사 저장소 | [README](https://github.com/mainflux/mainflux/blob/35230a90bfbe8699c0503ddaebbd540d8d6bb410/README.md#L1-L7) | Apache-2.0 | `35230a90`; archived, 후속 저장소 안내 | Go | 프로젝트 계보와 유지보수 상태를 확인해야 한다는 사례 | 낮음 | 신규 사용 `reject` |
| MainfluxLabs/mainflux | [README](https://github.com/MainfluxLabs/mainflux/blob/c18b8f41a4878fb9ab5818709fcacbab0dcc4684/README.md) | Apache-2.0 | `c18b8f41`; 0.41.1, 2026-07-24 | Go | identity·message·backend 분리 | 중상 | 참고 `defer` |
| Magistrala | [README](https://github.com/absmach/magistrala/blob/39457c7059723c9b701a03fe9d94cf7fda1f873d/README.md) | Apache-2.0 | `39457c70`; 0.51.0, 2026-08-05 | Go | IoT platform successor의 service boundary와 message flow | 높음 | 참고 `defer` |
| ChirpStack | [README](https://github.com/chirpstack/chirpstack/blob/8c30625090aa9f5e14783cf380d9a3e6d42907e8/README.md#L1-L10) | MIT | `8c306250`; 4.19.1, 2026-08-04 | Rust | LoRaWAN gateway·device lifecycle과 integration hook | 중 | LoRaWAN 요구 시 `adapt` |
| EdgeX Foundry (`edgex-go`) | [README](https://github.com/edgexfoundry/edgex-go/blob/2bee238e8510a15974a23743e1f7ddd35801407b/README.md#L1-L10) | Apache-2.0 | `2bee238e`; 4.0.2, 2026-05-29 | Go | device service와 protocol bridge의 분리 | 높음 | 구조 참고 `defer` |
| Eclipse Tahu | [README](https://github.com/eclipse-tahu/tahu/blob/5736e404889d4b95910613040a99ba79589ffb13/README.md#L1-L14) | EPL-2.0 | `5736e404`; default HEAD commit은 2023-11, release metadata 없음 | Java | Sparkplug birth/death·metric-state 참고 구현 | 중 | 규약 참고 `adapt` |
| FIWARE Orion-LD | [README](https://github.com/FIWARE/context.Orion-LD/blob/5f8b1fd730f50eed138abcddb37f426127462bc2/README.md#L1-L25) | AGPL-3.0 | `5f8b1fd7`; 1.12.0, 2026-01 | C++ 계열 | NGSI-LD entity/event와 context-broker API 의미론 | 높음 | export 의미 참고 `defer` |
| OpenRemote | [README](https://github.com/openremote/openremote/blob/8616a12735bba9ca4ffc256aa71fe5f79a9a5c90/README.md#L1-L11), [LICENSE](https://github.com/openremote/openremote/blob/8616a12735bba9ca4ffc256aa71fe5f79a9a5c90/LICENSE.txt#L1-L13) | AGPL-3.0-or-later; GitHub API는 NOASSERTION | `8616a127`; 1.29.0, 2026-08-10 | Java | rule·multi-tenancy·Edge·dashboard를 한 제품에서 나누는 법 | 높음 | UX·경계 참고 `defer` |
| Home Assistant Core | [README](https://github.com/home-assistant/core/blob/035ae91efb2f70e977d75a413abd4cfb703d5c3c/README.rst#L1-L20) | Apache-2.0 | `035ae91e`; 2026.8.1, 2026-08-07 | Python | local-first와 모듈형 integration architecture | 중 | integration 원리 `adapt` |

`mainflux/mainflux`, `MainfluxLabs/mainflux`, `absmach/magistrala`는 관련 계보지만
현재 소유 조직·활동 상태·release가 다른 저장소다. 하나의 “Mainflux 최신판”으로
합치지 않는다. Eclipse Tahu도 repository `pushed_at`과 default HEAD commit 날짜가
달라 활동성을 강하게 주장하지 않는다.

## SmartFarmOS에 가져올 패턴

1. **도메인과 transport 분리** — farmOS의 농장 기록 모델과 ThingsBoard
   Gateway·EdgeX의 connector 경계를 참고하되 내부 계약은 그대로 유지한다.
2. **local-first Edge** — Home Assistant와 OpenAg의 로컬 실행 원리를 참고하되
   SmartFarmOS의 명령 journal·ACK outbox·stop fence를 진실 원장으로 유지한다.
3. **선택형 adapter** — 실제 장비가 LoRaWAN을 요구할 때만 ChirpStack,
   Sparkplug를 요구할 때만 Tahu를 참고한다.
4. **외부 의미론은 export에서** — Orion-LD 같은 context model은 내부 도메인
   교체가 아니라 외부 변환기 설계에만 참고한다.
5. **활동성·라이선스·규모를 함께 본다** — 코드가 공개돼 있어도 stale wrapper,
   강한 copyleft, 대형 플랫폼 운영비는 별도 위험이다.

## 가져오지 않을 패턴

- 전체 IoT 플랫폼을 현재 모노레포의 기반으로 교체
- broker나 context broker를 command truth로 사용
- 특정 프로토콜의 field/topic/entity를 중앙 도메인에 직접 노출
- 라이선스 호환성 검토 없이 코드·schema·UI를 복사
- 학생용 demo·관리 중단 repository의 제어 로직을 안전 근거로 사용

## 대회 전과 이후

### 2026-08-27 전

- production dependency와 runtime integration 추가: **0개**
- 공개 구현은 비교·로드맵·라이선스 위험 근거로만 사용
- 기존 검증과 제출 증거를 고정

### 대회 후

1. 첫 실장비의 실제 transport 요구를 확정한다.
2. 필요한 후보 하나의 adapter pattern만 최소 proof-of-concept로 검토한다.
3. 당시 HEAD·release·license 파일을 다시 고정하고 법적 호환성을 별도 검토한다.
4. 단절·재시작·중복·out-of-order·권한·장치 상태 재조정 시험을 먼저 만든다.

## 최종 판단

가장 직접적인 도메인 참고는 farmOS, local-control 참고는 OpenAg와 Home
Assistant, 현장 connector 참고는 ThingsBoard Gateway다. ThingsBoard, EdgeX,
MainfluxLabs/Magistrala, Orion-LD, OpenRemote 같은 전체 플랫폼은 아이디어는
유용하지만 현재 SmartFarmOS 코어에 들여올 이유가 없다. 공개 소스는 “가져올
코드 목록”이 아니라 “경계를 더 잘 나누기 위한 비교 자료”로 쓰는 것이 맞다.
