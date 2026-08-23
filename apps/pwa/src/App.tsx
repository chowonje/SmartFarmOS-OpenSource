import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  commandRequestedPumpState,
  type AlarmInstance,
  type AuditEvent,
  type CommandProjection,
  type CreateCropRequestInput,
  type CropCycleDetail,
  type CropRecord,
  type Device,
  type Farm,
  type FarmControlWidget,
  type GrowingArea,
  type IrrigationStrategy,
  type LatestTelemetryResponse,
  type PatchCropRequestInput,
  type PumpState,
  type StrategyApplication,
} from "@smartfarm-os/contracts";
import { SmartFarmApi, SmartFarmApiError } from "./api/smart-farm-api";
import { readBrowserAdminConsoleUrl } from "./admin-console";
import { NavigationTabs } from "./components/navigation-tabs";
import { OverviewPage } from "./components/overview-page";
import { SettingsPage } from "./components/settings-page";
import {
  createEmptyAreaTelemetryComparisonState,
  createEmptyFarmControlProfileViewState,
  createEmptyIrrigationStrategyViewState,
  createEmptyMetricTelemetryViewState,
  createEmptyTelemetryHistoryViewState,
  createEmptyTelemetryViewState,
  ENVIRONMENT_TELEMETRY_METRICS,
  isIrrigationTargetEligible,
  type AreaTelemetryComparisonItem,
  type AreaTelemetryComparisonState,
  type AreaTelemetryMetricState,
  type CommandViewState,
  type CommandHistoryViewState,
  type EnvironmentTelemetryMetric,
  type FarmControlProfileViewState,
  type IrrigationStrategyViewState,
  type MetricTelemetryViewState,
  type TelemetryViewState,
  type TelemetryHistoryViewState,
} from "./components/page-state";
import { ScopeSidebar } from "./components/scope-sidebar";
import {
  cacheCommandProjection,
  cacheTelemetry,
  createAlarmAcknowledgementIdempotencyKey,
  createIdempotencyKey,
  removeCachedTelemetry,
  readCachedCommandProjection,
  readCachedTelemetry,
  readSelectedDeviceId,
  readSelectedFarmId,
  readBrowserUiLocale,
  removeCropRecord,
  resolveDeviceSelection,
  resolveFarmSelection,
  sortCropRecords,
  type SelectionScope,
  upsertCropRecord,
  userFacingError,
  writeSelectedDeviceId,
  writeSelectedFarmId,
  writeBrowserUiLocale,
  type UiLocale,
} from "./dashboard-model";
import { useHashRoute } from "./hooks/use-hash-route";
import {
  APP_HOME_CARDS,
  APP_NAV_ITEMS,
  APP_ROUTES,
  renderWebModuleRoute,
  type WebModuleRenderContext,
} from "./modules/web-module-registry";

const api = new SmartFarmApi({
  baseUrl: import.meta.env.PUBLIC_API_BASE_URL?.trim() || "/api",
});

const adminConsoleUrl = readBrowserAdminConsoleUrl(import.meta.env.PUBLIC_ADMIN_URL);

type CollectionState<T> = {
  readonly items: readonly T[];
  readonly loading: boolean;
  readonly refreshing: boolean;
  readonly error: string | null;
};

type CropCollectionState = CollectionState<CropRecord> & {
  readonly submitBusy: boolean;
  readonly submitError: string | null;
};

type OperationsCollectionState = CollectionState<CropCycleDetail> & {
  readonly areas: readonly GrowingArea[];
};

type AlarmCollectionState = CollectionState<AlarmInstance> & {
  readonly acknowledgingAlarmId: string | null;
  readonly acknowledgeError: string | null;
  readonly acknowledgeNotice: string | null;
};

export default function App() {
  const { route, setRoute } = useHashRoute(APP_ROUTES);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [farmsState, setFarmsState] = useState<CollectionState<Farm>>({
    items: [],
    loading: true,
    refreshing: false,
    error: null,
  });
  const [devicesState, setDevicesState] = useState<CollectionState<Device>>({
    items: [],
    loading: false,
    refreshing: false,
    error: null,
  });
  const [cropsState, setCropsState] = useState<CropCollectionState>({
    items: [],
    loading: false,
    refreshing: false,
    error: null,
    submitBusy: false,
    submitError: null,
  });
  const [operationsState, setOperationsState] = useState<OperationsCollectionState>({
    items: [],
    areas: [],
    loading: false,
    refreshing: false,
    error: null,
  });
  const [alarmsState, setAlarmsState] = useState<AlarmCollectionState>({
    items: [],
    loading: false,
    refreshing: false,
    error: null,
    acknowledgingAlarmId: null,
    acknowledgeError: null,
    acknowledgeNotice: null,
  });
  const [auditState, setAuditState] = useState<CollectionState<AuditEvent>>({
    items: [],
    loading: false,
    refreshing: false,
    error: null,
  });
  const [selectedFarmId, setSelectedFarmId] = useState<string | null>(() => readSelectedFarmId(localStorage));
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(() => readSelectedDeviceId(localStorage));
  const [uiLocale, setUiLocale] = useState<UiLocale>(() => readBrowserUiLocale());
  const [uiLocaleError, setUiLocaleError] = useState<string | null>(null);
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);
  const [selectedCropId, setSelectedCropId] = useState<string | null>(null);
  const [lastCreatedCropId, setLastCreatedCropId] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryViewState>(() => createEmptyTelemetryViewState());
  const [telemetryHistory, setTelemetryHistory] = useState<TelemetryHistoryViewState>(
    () => createEmptyTelemetryHistoryViewState(),
  );
  const [areaComparison, setAreaComparison] = useState<AreaTelemetryComparisonState>(
    () => createEmptyAreaTelemetryComparisonState(),
  );
  const [commandHistory, setCommandHistory] = useState<CommandHistoryViewState>({
    items: [],
    loading: false,
    refreshing: false,
    error: null,
  });
  const [irrigation, setIrrigation] = useState<IrrigationStrategyViewState>(
    () => createEmptyIrrigationStrategyViewState(),
  );
  const [command, setCommand] = useState<CommandViewState>({
    projection: null,
    requestedState: null,
    busy: false,
    error: null,
  });
  const [controlProfile, setControlProfile] = useState<FarmControlProfileViewState>(
    () => createEmptyFarmControlProfileViewState(),
  );
  const [nowMs, setNowMs] = useState(() => Date.now());

  const commandOperation = useRef(0);
  const controlProfileOperation = useRef(0);
  const comparisonOperation = useRef(0);
  const irrigationLoadOperation = useRef(0);
  const irrigationApplicationOperation = useRef(0);
  const selectedFarmIdRef = useRef<string | null>(selectedFarmId);
  const selectedDeviceIdRef = useRef<string | null>(selectedDeviceId);
  const selectedCycleIdRef = useRef<string | null>(selectedCycleId);
  const selectedScope = useMemo<SelectionScope | null>(
    () => selectedFarmId !== null && selectedDeviceId !== null
      ? { farmId: selectedFarmId, deviceId: selectedDeviceId }
      : null,
    [selectedDeviceId, selectedFarmId],
  );
  const selectedScopeRef = useRef<SelectionScope | null>(selectedScope);
  const selectedFarmCycleRef = useRef<{ readonly farmId: string; readonly cycleId: string | null } | null>(
    selectedFarmId === null ? null : { farmId: selectedFarmId, cycleId: selectedCycleId },
  );
  const areaComparisonRef = useRef(areaComparison);
  const areaComparisonScopeRef = useRef<AreaComparisonScope | null>(null);
  const irrigationRef = useRef(irrigation);
  const irrigationScopeRef = useRef<IrrigationScope | null>(null);

  useEffect(() => {
    selectedFarmIdRef.current = selectedFarmId;
  }, [selectedFarmId]);

  useEffect(() => {
    selectedDeviceIdRef.current = selectedDeviceId;
  }, [selectedDeviceId]);

  useEffect(() => {
    selectedCycleIdRef.current = selectedCycleId;
  }, [selectedCycleId]);

  useEffect(() => {
    selectedScopeRef.current = selectedScope;
  }, [selectedScope]);

  useEffect(() => {
    selectedFarmCycleRef.current = selectedFarmId === null
      ? null
      : { farmId: selectedFarmId, cycleId: selectedCycleId };
  }, [selectedCycleId, selectedFarmId]);

  useEffect(() => {
    areaComparisonRef.current = areaComparison;
  }, [areaComparison]);

  useEffect(() => {
    irrigationRef.current = irrigation;
  }, [irrigation]);

  const selectedFarm = useMemo(
    () => farmsState.items.find((farm) => farm.id === selectedFarmId) ?? null,
    [farmsState.items, selectedFarmId],
  );
  const selectedDevice = useMemo(
    () => devicesState.items.find((device) => device.id === selectedDeviceId) ?? null,
    [devicesState.items, selectedDeviceId],
  );
  const areaComparisonScope = useMemo<AreaComparisonScope | null>(() => {
    if (selectedFarmId === null || selectedCycleId === null) return null;
    const selectedCycle = operationsState.items.find((detail) => detail.cycle.id === selectedCycleId);
    if (selectedCycle === undefined) return null;

    const areasById = new Map(operationsState.areas.map((area) => [area.id, area]));
    const devicesById = new Map(devicesState.items.map((device) => [device.id, device]));
    const items: AreaTelemetryComparisonItem[] = [];

    for (const areaId of selectedCycle.areaIds) {
      const area = areasById.get(areaId);
      const primaryDeviceId = area?.primaryDeviceId ?? null;
      const device = primaryDeviceId === null ? null : devicesById.get(primaryDeviceId) ?? null;
      if (area === undefined || device === null) continue;
      items.push(createAreaTelemetryComparisonItem(area, device));
    }

    return {
      farmId: selectedFarmId,
      cycleId: selectedCycleId,
      items,
      signature: createAreaComparisonScopeSignature(selectedFarmId, selectedCycleId, items),
    };
  }, [
    devicesState.items,
    operationsState.areas,
    operationsState.items,
    selectedCycleId,
    selectedFarmId,
  ]);

  useEffect(() => {
    areaComparisonScopeRef.current = areaComparisonScope;
  }, [areaComparisonScope]);

  const irrigationScope = useMemo<IrrigationScope | null>(() => {
    if (selectedFarmId === null || selectedCycleId === null) return null;
    if (!operationsState.items.some((detail) => detail.cycle.id === selectedCycleId)) return null;

    const areasById = new Map(operationsState.areas.map((area) => [area.id, area]));
    const devicesById = new Map(devicesState.items.map((device) => [device.id, device]));
    const cycle = operationsState.items.find((detail) => detail.cycle.id === selectedCycleId);
    if (cycle === undefined) return null;

    const eligibleAreaIds = cycle.areaIds.filter((areaId) => {
      const area = areasById.get(areaId);
      const primaryDeviceId = area?.primaryDeviceId ?? null;
      const device = primaryDeviceId === null ? null : devicesById.get(primaryDeviceId) ?? null;
      return isIrrigationTargetEligible(area, device);
    });

    return {
      farmId: selectedFarmId,
      cycleId: selectedCycleId,
      eligibleAreaIds,
      signature: createIrrigationScopeSignature(selectedFarmId, selectedCycleId, eligibleAreaIds),
    };
  }, [
    devicesState.items,
    operationsState.areas,
    operationsState.items,
    selectedCycleId,
    selectedFarmId,
  ]);

  useEffect(() => {
    irrigationScopeRef.current = irrigationScope;
  }, [irrigationScope]);

  const refreshFarms = useCallback(async (showLoading = false) => {
    setFarmsState((current) => ({
      ...current,
      loading: showLoading && current.items.length === 0,
      refreshing: current.items.length > 0,
      error: null,
    }));

    try {
      const farms = await api.listFarms();
      const nextFarmId = resolveFarmSelection(
        farms,
        selectedFarmIdRef.current ?? readSelectedFarmId(localStorage),
      );
      if (nextFarmId !== selectedFarmIdRef.current) {
        selectedDeviceIdRef.current = null;
        selectedCycleIdRef.current = null;
        selectedScopeRef.current = null;
        setSelectedDeviceId(null);
        setSelectedCycleId(null);
        setSelectedCropId(null);
        setLastCreatedCropId(null);
        setDevicesState({ items: [], loading: nextFarmId !== null, refreshing: false, error: null });
        setOperationsState({
          items: [],
          areas: [],
          loading: nextFarmId !== null,
          refreshing: false,
          error: null,
        });
        setCropsState({
          items: [],
          loading: nextFarmId !== null,
          refreshing: false,
          error: null,
          submitBusy: false,
          submitError: null,
        });
        setAlarmsState({
          items: [],
          loading: nextFarmId !== null,
          refreshing: false,
          error: null,
          acknowledgingAlarmId: null,
          acknowledgeError: null,
          acknowledgeNotice: null,
        });
        setAuditState({
          items: [],
          loading: nextFarmId !== null,
          refreshing: false,
          error: null,
        });
        controlProfileOperation.current += 1;
        setControlProfile({
          ...createEmptyFarmControlProfileViewState(),
          loading: nextFarmId !== null,
        });
      }
      setOnline(true);
      setFarmsState({ items: farms, loading: false, refreshing: false, error: null });
      selectedFarmIdRef.current = nextFarmId;
      setSelectedFarmId(nextFarmId);
      if (nextFarmId !== null) writeSelectedFarmId(localStorage, nextFarmId);
    } catch (error) {
      if (isConnectionFailure(error)) setOnline(false);
      setFarmsState((current) => ({
        ...current,
        loading: false,
        refreshing: false,
        error: userFacingError(error, navigator.onLine, {
          notFoundMessage: "접근 가능한 농장을 찾지 못했습니다.",
          defaultMessage: "농장 목록을 불러오지 못했습니다.",
        }),
      }));
    }
  }, []);

  const refreshDevices = useCallback(async (farmId: string, showLoading = false) => {
    setDevicesState((current) => ({
      ...current,
      items: showLoading ? current.items : current.items,
      loading: showLoading && current.items.length === 0,
      refreshing: current.items.length > 0,
      error: null,
    }));

    try {
      const devices = await api.listDevices(farmId);
      if (!isCurrentFarm(farmId)) return;
      const nextDeviceId = resolveDeviceSelection(
        devices,
        readSelectedDeviceId(localStorage) ?? selectedDeviceIdRef.current,
      );
      if (nextDeviceId !== selectedDeviceIdRef.current) {
        selectedScopeRef.current = nextDeviceId === null
          ? null
          : { farmId, deviceId: nextDeviceId };
      }
      setOnline(true);
      setDevicesState({ items: devices, loading: false, refreshing: false, error: null });
      selectedDeviceIdRef.current = nextDeviceId;
      setSelectedDeviceId(nextDeviceId);
      if (nextDeviceId !== null) writeSelectedDeviceId(localStorage, nextDeviceId);
    } catch (error) {
      if (!isCurrentFarm(farmId)) return;
      const connectionFailure = isConnectionFailure(error);
      if (connectionFailure) setOnline(false);
      setDevicesState((current) => ({
        ...current,
        items: [],
        loading: false,
        refreshing: false,
        error: userFacingError(error, navigator.onLine, {
          notFoundMessage: "선택한 농장의 장치를 찾지 못했습니다.",
          defaultMessage: "장치 목록을 불러오지 못했습니다.",
        }),
      }));
      if (!connectionFailure) {
        selectedDeviceIdRef.current = null;
        setSelectedDeviceId(null);
      }
    }
  }, []);

  const refreshCrops = useCallback(async (farmId: string, showLoading = false) => {
    setCropsState((current) => ({
      ...current,
      loading: showLoading && current.items.length === 0,
      refreshing: current.items.length > 0,
      error: null,
    }));

    try {
      const crops = sortCropRecords(await api.listCrops(farmId));
      if (!isCurrentFarm(farmId)) return;
      setOnline(true);
      setCropsState((current) => ({
        ...current,
        items: crops,
        loading: false,
        refreshing: false,
        error: null,
      }));
      setSelectedCropId((current) => crops.some((crop) => crop.id === current) ? current : crops[0]?.id ?? null);
    } catch (error) {
    if (!isCurrentFarm(farmId)) return;
      if (isConnectionFailure(error)) setOnline(false);
      setCropsState((current) => ({
        ...current,
        items: [],
        loading: false,
        refreshing: false,
        error: userFacingError(error, navigator.onLine, {
          notFoundMessage: "선택한 농장의 작물 기록을 찾지 못했습니다.",
          defaultMessage: "작물 목록을 불러오지 못했습니다.",
        }),
      }));
    }
  }, []);

  const refreshOperations = useCallback(async (farmId: string, showLoading = false) => {
    setOperationsState((current) => ({
      ...current,
      loading: showLoading && current.items.length === 0,
      refreshing: current.items.length > 0,
      error: null,
    }));

    try {
      const [areas, cropCycles] = await Promise.all([
        api.listAreas(farmId),
        api.listCropCycles(farmId),
      ]);
      if (!isCurrentFarm(farmId)) return;
      setOnline(true);
      setOperationsState({
        items: cropCycles,
        areas,
        loading: false,
        refreshing: false,
        error: null,
      });
      const nextCycleId = resolveCycleSelection(cropCycles, selectedCycleIdRef.current);
      selectedCycleIdRef.current = nextCycleId;
      setSelectedCycleId(nextCycleId);
    } catch (error) {
      if (!isCurrentFarm(farmId)) return;
      if (isConnectionFailure(error)) setOnline(false);
      setOperationsState((current) => ({
        ...current,
        loading: false,
        refreshing: false,
        error: userFacingError(error, navigator.onLine, {
          notFoundMessage: "선택한 농장의 작물 운영 범위를 찾지 못했습니다.",
          defaultMessage: "작물 운영 범위를 불러오지 못했습니다.",
        }),
      }));
    }
  }, []);

  const refreshAlarms = useCallback(async (
    farmId: string,
    cycleId: string | null,
    showLoading = false,
  ) => {
    if (cycleId === null) {
      setAlarmsState((current) => ({
        ...current,
        items: [],
        loading: false,
        refreshing: false,
        error: null,
        acknowledgingAlarmId: null,
        acknowledgeError: null,
        acknowledgeNotice: null,
      }));
      return;
    }

    setAlarmsState((current) => ({
      ...current,
      loading: showLoading && current.items.length === 0,
      refreshing: current.items.length > 0,
      error: null,
      acknowledgeError: showLoading ? null : current.acknowledgeError,
      acknowledgeNotice: showLoading ? null : current.acknowledgeNotice,
    }));

    try {
      const alarms = await api.listAlarms(farmId, { cycleId, limit: 100 });
      if (!isCurrentFarmCycle(farmId, cycleId)) return;
      setOnline(true);
      setAlarmsState((current) => ({
        ...current,
        items: alarms,
        loading: false,
        refreshing: false,
        error: null,
      }));
    } catch (error) {
      if (!isCurrentFarmCycle(farmId, cycleId)) return;
      if (isConnectionFailure(error)) setOnline(false);
      setAlarmsState((current) => ({
        ...current,
        loading: false,
        refreshing: false,
        error: userFacingError(error, navigator.onLine, {
          defaultMessage: "알람 목록을 불러오지 못했습니다.",
        }),
      }));
    }
  }, []);

  const refreshAuditEvents = useCallback(async (
    farmId: string,
    cycleId: string | null,
    showLoading = false,
  ) => {
    if (cycleId === null) {
      setAuditState({
        items: [],
        loading: false,
        refreshing: false,
        error: null,
      });
      return;
    }

    setAuditState((current) => ({
      ...current,
      loading: showLoading && current.items.length === 0,
      refreshing: current.items.length > 0,
      error: null,
    }));

    try {
      const auditEvents = await api.listAuditEvents(farmId, {
        cycleId,
        includeUnscoped: true,
        limit: 50,
      });
      if (!isCurrentFarmCycle(farmId, cycleId)) return;
      setOnline(true);
      setAuditState({
        items: auditEvents,
        loading: false,
        refreshing: false,
        error: null,
      });
    } catch (error) {
      if (!isCurrentFarmCycle(farmId, cycleId)) return;
      if (isConnectionFailure(error)) setOnline(false);
      setAuditState((current) => ({
        ...current,
        loading: false,
        refreshing: false,
        error: userFacingError(error, navigator.onLine, {
          defaultMessage: "운영 감사 이력을 불러오지 못했습니다.",
        }),
      }));
    }
  }, []);

  const refreshControlProfile = useCallback(async (
    farmId: string,
    showLoading = false,
  ) => {
    const operation = controlProfileOperation.current + 1;
    controlProfileOperation.current = operation;
    setControlProfile((current) => ({
      ...current,
      loading: showLoading && current.profile === null,
      refreshing: current.profile !== null,
      error: null,
      notice: null,
    }));

    try {
      const profile = await api.farmControlProfile(farmId);
      if (controlProfileOperation.current !== operation || !isCurrentFarm(farmId)) return;
      setOnline(true);
      setControlProfile({
        profile,
        loading: false,
        refreshing: false,
        saving: false,
        error: null,
        notice: null,
      });
    } catch (error) {
      if (controlProfileOperation.current !== operation || !isCurrentFarm(farmId)) return;
      if (isConnectionFailure(error)) setOnline(false);
      setControlProfile((current) => ({
        ...current,
        loading: false,
        refreshing: false,
        saving: false,
        error: userFacingError(error, navigator.onLine, {
          notFoundMessage: "선택한 농장의 맞춤 제어 설정을 찾지 못했습니다.",
          defaultMessage: "맞춤 제어 설정을 불러오지 못했습니다.",
        }),
      }));
    }
  }, []);

  const refreshCommandHistory = useCallback(async (farmId: string, showLoading = false) => {
    setCommandHistory((current) => ({
      ...current,
      loading: showLoading && current.items.length === 0,
      refreshing: current.items.length > 0,
      error: null,
    }));

    try {
      const commands = await api.listCommands(farmId, { limit: 50 });
      if (!isCurrentFarm(farmId)) return;
      setOnline(true);
      setCommandHistory({
        items: commands,
        loading: false,
        refreshing: false,
        error: null,
      });
      const selectedScope = selectedScopeRef.current;
      if (selectedScope?.farmId === farmId) {
        const cachedProjection = readCachedCommandProjection(localStorage, selectedScope);
        const refreshedProjection = cachedProjection === null
          ? null
          : commands.find((projection) => (
            projection.command.id === cachedProjection.command.id
          )) ?? null;
        if (refreshedProjection !== null) {
          cacheCommandProjection(localStorage, refreshedProjection);
          setCommand((current) => (
            current.projection?.command.id !== refreshedProjection.command.id
              ? current
              : {
                projection: refreshedProjection,
                requestedState: commandRequestedPumpState(refreshedProjection.command),
                busy: refreshedProjection.status === "pending",
                error: null,
              }
          ));
        }
      }
    } catch (error) {
      if (!isCurrentFarm(farmId)) return;
      if (isConnectionFailure(error)) setOnline(false);
      setCommandHistory((current) => ({
        ...current,
        loading: false,
        refreshing: false,
        error: userFacingError(error, navigator.onLine, {
          defaultMessage: "명령 이력을 불러오지 못했습니다.",
        }),
      }));
    }
  }, []);

  const refreshIrrigationStrategies = useCallback(async (
    scope: IrrigationScope,
    showLoading = false,
  ) => {
    const operation = irrigationLoadOperation.current + 1;
    irrigationLoadOperation.current = operation;

    setIrrigation((current) => ({
      ...current,
      loading: showLoading && current.items.length === 0,
      refreshing: current.items.length > 0,
      error: null,
      selectedAreaIds: orderAreaIdsByEligibility(current.selectedAreaIds, scope.eligibleAreaIds),
      applicationConfirmed: current.applicationConfirmed
        && orderAreaIdsByEligibility(current.selectedAreaIds, scope.eligibleAreaIds) === current.selectedAreaIds,
    }));

    try {
      const strategies = (await api.listIrrigationStrategies(scope.farmId, scope.cycleId))
        .filter((strategy) => strategy.status === "approved");
      if (!isCurrentIrrigationScope(scope, operation)) return;
      setOnline(true);
      setIrrigation((current) => {
        const selectedStrategy = resolveIrrigationStrategySelection(
          strategies,
          current.selectedStrategyId,
          current.selectedStrategyVersion,
        );
        const selectedAreaIds = orderAreaIdsByEligibility(
          current.selectedAreaIds,
          scope.eligibleAreaIds,
        );
        const selectionUnchanged = selectedStrategy?.id === current.selectedStrategyId
          && selectedStrategy?.version === current.selectedStrategyVersion
          && selectedAreaIds === current.selectedAreaIds;
        return {
          ...current,
          items: strategies,
          loading: false,
          refreshing: false,
          error: null,
          selectedStrategyId: selectedStrategy?.id ?? null,
          selectedStrategyVersion: selectedStrategy?.version ?? null,
          selectedAreaIds,
          applicationConfirmed: current.applicationConfirmed && selectionUnchanged,
        };
      });
    } catch (error) {
      if (!isCurrentIrrigationScope(scope, operation)) return;
      if (isConnectionFailure(error)) setOnline(false);
      setIrrigation((current) => ({
        ...current,
        loading: false,
        refreshing: false,
        error: userFacingError(error, navigator.onLine, {
          defaultMessage: "관수 전략을 불러오지 못했습니다.",
        }),
        selectedAreaIds: orderAreaIdsByEligibility(current.selectedAreaIds, scope.eligibleAreaIds),
        applicationConfirmed: current.applicationConfirmed
          && orderAreaIdsByEligibility(current.selectedAreaIds, scope.eligibleAreaIds) === current.selectedAreaIds,
      }));
    }
  }, []);

  const followIrrigationApplication = useCallback(async (
    scope: IrrigationScope,
    initialApplication: StrategyApplication,
    operation: number,
  ): Promise<void> => {
    let application = initialApplication;
    const deadline = Date.now() + (
      initialApplication.runDurationSeconds === undefined
        ? 65_000
        : initialApplication.runDurationSeconds * 1_000 + 90_000
    );

    while (application.status === "pending" && Date.now() < deadline) {
      await delay(500);
      if (!isCurrentIrrigationApplication(scope, application.id, operation)) return;

      try {
        application = await api.strategyApplication(scope.farmId, application.id);
      } catch (error) {
        if (!isCurrentIrrigationApplication(scope, application.id, operation)) return;
        if (isConnectionFailure(error)) setOnline(false);
        setIrrigation((current) => (
          current.application?.id !== application.id
            ? current
            : {
              ...current,
              applying: false,
              applicationError: userFacingError(error, navigator.onLine, {
                defaultMessage: "관수 전략 적용 상태를 확인하지 못했습니다.",
              }),
            }
        ));
        return;
      }

      if (!isCurrentIrrigationApplication(scope, application.id, operation)) return;
      setOnline(true);
      setIrrigation((current) => (
        current.application?.id !== application.id
          ? current
          : {
            ...current,
            application,
            applying: application.status === "pending",
            applicationError: null,
          }
      ));
    }

    if (!isCurrentIrrigationApplication(scope, application.id, operation)) return;

    if (application.status === "pending") {
      setIrrigation((current) => (
        current.application?.id !== application.id
          ? current
          : {
            ...current,
            applying: false,
            applicationError: "전략 적용 결과를 기다리는 중입니다. 잠시 후 다시 확인해 주세요.",
          }
      ));
      return;
    }

    void refreshCommandHistory(scope.farmId);
    void refreshAuditEvents(scope.farmId, scope.cycleId);
  }, [refreshAuditEvents, refreshCommandHistory]);

  const resumePendingIrrigationApplication = useCallback((scope: IrrigationScope) => {
    const pendingApplication = irrigationRef.current.application;
    if (
      pendingApplication === null
      || pendingApplication.status !== "pending"
      || pendingApplication.farmId !== scope.farmId
      || pendingApplication.cycleId !== scope.cycleId
    ) {
      return;
    }

    const operation = irrigationApplicationOperation.current + 1;
    irrigationApplicationOperation.current = operation;
    setIrrigation((current) => (
      current.application?.id !== pendingApplication.id
        ? current
        : {
          ...current,
          applying: true,
          applicationError: null,
        }
    ));
    void followIrrigationApplication(scope, pendingApplication, operation);
  }, [followIrrigationApplication]);

  const fetchAreaComparisonMetricState = useCallback(async (
    farmId: string,
    item: AreaTelemetryComparisonItem,
    metric: EnvironmentTelemetryMetric,
    previous: AreaTelemetryMetricState,
  ): Promise<ComparisonMetricResult> => {
    const scope = { farmId, deviceId: item.deviceId } satisfies SelectionScope;
    const cachedLatest = readCachedTelemetry(localStorage, scope, metric);

    const [latestResult, historyResult] = await Promise.allSettled([
      api.latestTelemetry(farmId, item.deviceId, metric),
      api.telemetryHistory(farmId, item.deviceId, metric, 24),
    ]);

    let latest = previous.latest;
    let points = previous.points;
    let cached = previous.cached;
    let error: string | null = null;
    let connectionFailure = false;

    if (latestResult.status === "fulfilled") {
      latest = latestResult.value;
      cached = false;
      cacheTelemetry(localStorage, latestResult.value);
    } else {
      const reason = latestResult.reason;
      if (isMetricNotFound(reason)) {
        latest = null;
        cached = false;
        removeCachedTelemetry(localStorage, scope, metric);
      } else {
        if (isConnectionFailure(reason)) connectionFailure = true;
        if (latest === null && cachedLatest !== null) {
          latest = cachedLatest;
          cached = true;
        }
        error = userFacingError(reason, navigator.onLine);
      }
    }

    if (historyResult.status === "fulfilled") {
      points = historyResult.value.telemetry;
    } else {
      const reason = historyResult.reason;
      if (isMetricNotFound(reason)) {
        points = [];
      } else {
        if (isConnectionFailure(reason)) connectionFailure = true;
        error ??= userFacingError(reason, navigator.onLine);
      }
    }

    return {
      state: {
        latest,
        points,
        loading: false,
        refreshing: false,
        cached,
        error,
      },
      connectionFailure,
    };
  }, []);

  const refreshAreaComparison = useCallback(async (
    scope: AreaComparisonScope,
    showLoading = false,
  ) => {
    const operation = comparisonOperation.current + 1;
    comparisonOperation.current = operation;

    const pendingState = createPendingAreaComparisonState(
      areaComparisonRef.current,
      scope.items,
      showLoading,
    );
    setAreaComparison(pendingState);
    const pendingItemByKey = new Map(
      pendingState.items.map((item) => [createAreaComparisonItemKey(item.areaId, item.deviceId), item]),
    );

    const metricResults = await Promise.all(
      scope.items.map(async (item) => {
        const metrics = await Promise.all(
          ENVIRONMENT_TELEMETRY_METRICS.map(async (metric) => {
            const previous = pendingItemByKey.get(
              createAreaComparisonItemKey(item.areaId, item.deviceId),
            )?.metrics[metric] ?? createEmptyAreaTelemetryMetricState();
            const next = await fetchAreaComparisonMetricState(scope.farmId, item, metric, previous);
            return [metric, next] as const;
          }),
        );

        return {
          item,
          metrics: Object.fromEntries(
            metrics.map(([metric, result]) => [metric, result.state]),
          ) as AreaTelemetryComparisonItem["metrics"],
          resultsByMetric: Object.fromEntries(metrics) as Record<
            EnvironmentTelemetryMetric,
            ComparisonMetricResult
          >,
        };
      }),
    );

    if (!isCurrentAreaComparisonScope(scope, operation)) return;

    const nextItems = metricResults.map(({ item, metrics }) => ({
      ...item,
      metrics,
    }));
    const connectionFailure = metricResults.some(({ resultsByMetric }) => (
      ENVIRONMENT_TELEMETRY_METRICS.some((metric) => resultsByMetric[metric].connectionFailure)
    ));
    const stateError = metricResults.flatMap(({ resultsByMetric }) => (
      ENVIRONMENT_TELEMETRY_METRICS.map((metric) => resultsByMetric[metric].state.error)
    )).find((message) => message !== null) ?? null;

    if (connectionFailure) {
      setOnline(false);
    } else {
      setOnline(true);
    }

    setAreaComparison({
      items: nextItems,
      loading: false,
      refreshing: false,
      error: stateError,
    });
  }, [fetchAreaComparisonMetricState]);

  const refreshTelemetryMetric = useCallback(async (
    scope: SelectionScope,
    metric: EnvironmentTelemetryMetric,
    showLoading = false,
  ) => {
    setTelemetry((current) => ({
      ...current,
      [metric]: {
        ...current[metric],
        loading: showLoading && current[metric].latest === null,
        refreshing: current[metric].latest !== null,
        error: null,
      },
    }));

    try {
      const latest = await api.latestTelemetry(scope.farmId, scope.deviceId, metric);
      if (!isCurrentScope(scope)) return;
      cacheTelemetry(localStorage, latest);
      setOnline(true);
      setTelemetry((current) => ({
        ...current,
        [metric]: {
          latest,
          loading: false,
          refreshing: false,
          cached: false,
          unsupported: false,
          error: null,
        },
      }));
    } catch (error) {
      if (!isCurrentScope(scope)) return;
      if (isConnectionFailure(error)) setOnline(false);
      const unsupported = isMetricNotFound(error);
      if (unsupported) {
        removeCachedTelemetry(localStorage, scope, metric);
      }
      setTelemetry((current) => {
        const previous = current[metric];
        return {
          ...current,
          [metric]: {
            latest: unsupported ? null : previous.latest,
            loading: false,
            refreshing: false,
            cached: unsupported ? false : previous.latest !== null,
            unsupported,
            error: unsupported ? null : userFacingError(error, navigator.onLine),
          },
        };
      });
    }
  }, []);

  const refreshTelemetry = useCallback(async (scope: SelectionScope, showLoading = false) => {
    await Promise.allSettled(
      ENVIRONMENT_TELEMETRY_METRICS.map((metric) => refreshTelemetryMetric(scope, metric, showLoading)),
    );
  }, [refreshTelemetryMetric]);

  const refreshTelemetryHistoryMetric = useCallback(async (
    scope: SelectionScope,
    metric: EnvironmentTelemetryMetric,
    showLoading = false,
  ) => {
    setTelemetryHistory((current) => ({
      ...current,
      [metric]: {
        ...current[metric],
        loading: showLoading && current[metric].points.length === 0,
        error: null,
      },
    }));

    try {
      const history = await api.telemetryHistory(scope.farmId, scope.deviceId, metric, 24);
      if (!isCurrentScope(scope)) return;
      setOnline(true);
      setTelemetryHistory((current) => ({
        ...current,
        [metric]: {
          points: history.telemetry,
          loading: false,
          error: null,
        },
      }));
    } catch (error) {
      if (!isCurrentScope(scope)) return;
      if (isConnectionFailure(error)) setOnline(false);
      const notFound = isMetricNotFound(error);
      setTelemetryHistory((current) => ({
        ...current,
        [metric]: {
          points: notFound ? [] : current[metric].points,
          loading: false,
          error: notFound ? null : userFacingError(error, navigator.onLine),
        },
      }));
    }
  }, []);

  const refreshTelemetryHistory = useCallback(async (
    scope: SelectionScope,
    showLoading = false,
  ) => {
    await Promise.allSettled(
      ENVIRONMENT_TELEMETRY_METRICS.map((metric) => (
        refreshTelemetryHistoryMetric(scope, metric, showLoading)
      )),
    );
  }, [refreshTelemetryHistoryMetric]);

  const updateCommandProjection = useCallback((
    scope: SelectionScope,
    projection: CommandProjection,
    requestedState: PumpState,
    operation: number,
  ): boolean => {
    if (commandOperation.current !== operation || !isCurrentScope(scope)) return false;
    cacheCommandProjection(localStorage, projection);
    setOnline(true);
    setCommand({
      projection,
      requestedState,
      busy: projection.status === "pending",
      error: null,
    });
    return true;
  }, []);

  const followCommand = useCallback(async (
    scope: SelectionScope,
    initialProjection: CommandProjection,
    requestedState: PumpState,
    operation: number,
  ): Promise<void> => {
    let projection = initialProjection;
    if (!updateCommandProjection(scope, projection, requestedState, operation)) return;

    const deadline = Date.parse(projection.command.expiresAt) + 1_000;
    while (projection.status === "pending" && Date.now() < deadline) {
      await delay(500);
      if (commandOperation.current !== operation || !isCurrentScope(scope)) return;
      projection = await api.commandProjection(scope.farmId, projection.command.id);
      if (!updateCommandProjection(scope, projection, requestedState, operation)) return;
    }

    if (projection.status !== "pending" && commandOperation.current === operation && isCurrentScope(scope)) {
      void refreshCommandHistory(scope.farmId);
    }

    if (projection.status === "pending" && commandOperation.current === operation && isCurrentScope(scope)) {
      setCommand((current) => ({
        ...current,
        busy: false,
        error: "장치 응답을 기다리는 중입니다. 잠시 후 다시 확인해 주세요.",
      }));
    }
  }, [refreshCommandHistory, updateCommandProjection]);

  useEffect(() => {
    void refreshFarms(true);
  }, [refreshFarms]);

  useEffect(() => {
    if (selectedFarmId === null) {
      setDevicesState({ items: [], loading: false, refreshing: false, error: null });
      setOperationsState({ items: [], areas: [], loading: false, refreshing: false, error: null });
      setAreaComparison(createEmptyAreaTelemetryComparisonState());
      setCommandHistory(createEmptyCommandHistoryState());
      setIrrigation(createEmptyIrrigationStrategyViewState());
      setCropsState((current) => ({
        ...current,
        items: [],
        loading: false,
        refreshing: false,
        error: null,
      }));
      setAlarmsState({
        items: [],
        loading: false,
        refreshing: false,
        error: null,
        acknowledgingAlarmId: null,
        acknowledgeError: null,
        acknowledgeNotice: null,
      });
      setAuditState({ items: [], loading: false, refreshing: false, error: null });
      controlProfileOperation.current += 1;
      setControlProfile(createEmptyFarmControlProfileViewState());
      selectedDeviceIdRef.current = null;
      selectedCycleIdRef.current = null;
      selectedScopeRef.current = null;
      selectedFarmCycleRef.current = null;
      areaComparisonScopeRef.current = null;
      irrigationScopeRef.current = null;
      setSelectedDeviceId(null);
      setSelectedCycleId(null);
      setSelectedCropId(null);
      setTelemetryHistory(createEmptyTelemetryHistoryViewState());
      return;
    }

    writeSelectedFarmId(localStorage, selectedFarmId);
    void refreshDevices(selectedFarmId, true);
    void refreshOperations(selectedFarmId, true);
    void refreshCrops(selectedFarmId, true);
    void refreshControlProfile(selectedFarmId, true);
  }, [refreshControlProfile, refreshCrops, refreshDevices, refreshOperations, selectedFarmId]);

  useEffect(() => {
    if (selectedDeviceId !== null) writeSelectedDeviceId(localStorage, selectedDeviceId);
  }, [selectedDeviceId]);

  useEffect(() => {
    if (selectedFarmId === null) {
      setCommandHistory(createEmptyCommandHistoryState());
      return;
    }

    void refreshCommandHistory(selectedFarmId, true);
    const refreshTimer = window.setInterval(() => {
      void refreshCommandHistory(selectedFarmId);
    }, 10_000);

    return () => window.clearInterval(refreshTimer);
  }, [refreshCommandHistory, selectedFarmId]);

  useEffect(() => {
    if (selectedFarmId === null) return;

    if (selectedCycleId === null) {
      void refreshAlarms(selectedFarmId, null, true);
      void refreshAuditEvents(selectedFarmId, null, true);
      return;
    }

    void refreshAlarms(selectedFarmId, selectedCycleId, true);
    void refreshAuditEvents(selectedFarmId, selectedCycleId, true);

    const refreshTimer = window.setInterval(() => {
      void refreshAlarms(selectedFarmId, selectedCycleId);
      void refreshAuditEvents(selectedFarmId, selectedCycleId);
    }, 10_000);

    return () => window.clearInterval(refreshTimer);
  }, [refreshAlarms, refreshAuditEvents, selectedCycleId, selectedFarmId]);

  useEffect(() => {
    if (irrigationScope === null) {
      irrigationLoadOperation.current += 1;
      irrigationApplicationOperation.current += 1;
      setIrrigation(createEmptyIrrigationStrategyViewState());
      return;
    }

    setIrrigation((current) => ({
      ...current,
      selectedAreaIds: orderAreaIdsByEligibility(current.selectedAreaIds, irrigationScope.eligibleAreaIds),
      applicationConfirmed: current.applicationConfirmed
        && orderAreaIdsByEligibility(current.selectedAreaIds, irrigationScope.eligibleAreaIds) === current.selectedAreaIds,
    }));
    void refreshIrrigationStrategies(irrigationScope, true);
    resumePendingIrrigationApplication(irrigationScope);
  }, [irrigationScope, refreshIrrigationStrategies, resumePendingIrrigationApplication]);

  useEffect(() => {
    if (irrigationScope === null) return;
    setIrrigation((current) => {
      const nextSelectedAreaIds = orderAreaIdsByEligibility(
        current.selectedAreaIds,
        irrigationScope.eligibleAreaIds,
      );
      return nextSelectedAreaIds === current.selectedAreaIds
        ? current
        : { ...current, selectedAreaIds: nextSelectedAreaIds, applicationConfirmed: false };
    });
  }, [irrigationScope]);

  useEffect(() => {
    if (areaComparisonScope === null) {
      comparisonOperation.current += 1;
      const emptyState = createEmptyAreaTelemetryComparisonState();
      areaComparisonRef.current = emptyState;
      setAreaComparison(emptyState);
      return;
    }

    const cachedState = createAreaTelemetryComparisonStateFromCache(areaComparisonScope, localStorage);
    areaComparisonRef.current = cachedState;
    setAreaComparison(cachedState);
    void refreshAreaComparison(areaComparisonScope, true);

    const refreshTimer = window.setInterval(() => {
      void refreshAreaComparison(areaComparisonScope);
    }, 10_000);

    return () => {
      window.clearInterval(refreshTimer);
      comparisonOperation.current += 1;
    };
  }, [areaComparisonScope, refreshAreaComparison]);

  useEffect(() => {
    if (selectedScope === null) {
      setTelemetry(createEmptyTelemetryViewState());
      setTelemetryHistory(createEmptyTelemetryHistoryViewState());
      setCommand({
        projection: null,
        requestedState: null,
        busy: false,
        error: null,
      });
      return;
    }

    const cachedTelemetry = createTelemetryStateFromCache(selectedScope);
    const cachedCommand = readCachedCommandProjection(localStorage, selectedScope);
    setTelemetry(cachedTelemetry);
    setCommand({
      projection: cachedCommand,
      requestedState: cachedCommand === null
        ? null
        : commandRequestedPumpState(cachedCommand.command),
      busy: cachedCommand?.status === "pending",
      error: null,
    });

    const operation = commandOperation.current + 1;
    commandOperation.current = operation;

    void refreshTelemetry(selectedScope, true);
    void refreshTelemetryHistory(selectedScope, true);

    if (cachedCommand !== null) {
      void (async () => {
        try {
          const latest = await api.commandProjection(selectedScope.farmId, cachedCommand.command.id);
          await followCommand(
            selectedScope,
            latest,
            commandRequestedPumpState(latest.command),
            operation,
          );
        } catch (error) {
          if (commandOperation.current !== operation || !isCurrentScope(selectedScope)) return;
          if (isConnectionFailure(error)) setOnline(false);
          setCommand((current) => ({
            ...current,
            busy: false,
            error: userFacingError(error, navigator.onLine),
          }));
        }
      })();
    }

    const refreshTimer = window.setInterval(() => {
      void refreshTelemetry(selectedScope);
      void refreshTelemetryHistory(selectedScope);
    }, 10_000);
    return () => {
      window.clearInterval(refreshTimer);
      commandOperation.current += 1;
    };
  }, [followCommand, refreshTelemetry, refreshTelemetryHistory, selectedScope]);

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      if (selectedScopeRef.current !== null) {
        void refreshTelemetry(selectedScopeRef.current);
        void refreshTelemetryHistory(selectedScopeRef.current);
      }
      if (selectedFarmIdRef.current !== null) {
        void refreshOperations(selectedFarmIdRef.current);
        void refreshCommandHistory(selectedFarmIdRef.current);
      }
      if (areaComparisonScopeRef.current !== null) {
        void refreshAreaComparison(areaComparisonScopeRef.current);
      }
      if (irrigationScopeRef.current !== null) {
        void refreshIrrigationStrategies(irrigationScopeRef.current);
        resumePendingIrrigationApplication(irrigationScopeRef.current);
      }
      if (selectedFarmCycleRef.current !== null) {
        void refreshAlarms(
          selectedFarmCycleRef.current.farmId,
          selectedFarmCycleRef.current.cycleId,
        );
        void refreshAuditEvents(
          selectedFarmCycleRef.current.farmId,
          selectedFarmCycleRef.current.cycleId,
        );
      }
      void refreshFarms();
    };
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [
    refreshAlarms,
    refreshAuditEvents,
    refreshFarms,
    refreshAreaComparison,
    refreshCommandHistory,
    refreshIrrigationStrategies,
    refreshOperations,
    refreshTelemetry,
    refreshTelemetryHistory,
    resumePendingIrrigationApplication,
  ]);

  useEffect(() => {
    const clockTimer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1_000);

    return () => window.clearInterval(clockTimer);
  }, []);

  useEffect(() => {
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
  }, []);

  const requestPumpState = async (state: PumpState) => {
    if (selectedScope === null) return;

    if (!navigator.onLine) {
      setCommand((current) => ({ ...current, error: userFacingError(null, false) }));
      return;
    }

    const operation = commandOperation.current + 1;
    commandOperation.current = operation;
    const previousProjection = command.projection;
    const previousRequestedState = command.requestedState;
    setCommand({ projection: null, requestedState: state, busy: true, error: null });

    let projection: CommandProjection;
    try {
      projection = await api.createPumpCommand({
        farmId: selectedScope.farmId,
        deviceId: selectedScope.deviceId,
        state,
        idempotencyKey: createIdempotencyKey(),
      });
    } catch (error) {
      if (commandOperation.current !== operation || !isCurrentScope(selectedScope)) return;
      if (isConnectionFailure(error)) setOnline(false);
      setCommand({
        projection: previousProjection,
        requestedState: previousRequestedState,
        busy: false,
        error: userFacingError(error, navigator.onLine),
      });
      return;
    }

    try {
      await followCommand(selectedScope, projection, state, operation);
    } catch (error) {
      if (commandOperation.current !== operation || !isCurrentScope(selectedScope)) return;
      if (isConnectionFailure(error)) setOnline(false);
      setCommand((current) => ({
        ...current,
        busy: false,
        error: userFacingError(error, navigator.onLine),
      }));
    }
  };

  const acknowledgeAlarm = useCallback(async (alarmId: string): Promise<void> => {
    const farmId = selectedFarmIdRef.current;
    const originCycleId = selectedCycleIdRef.current;
    if (farmId === null || originCycleId === null) return;

    setAlarmsState((current) => ({
      ...current,
      acknowledgingAlarmId: alarmId,
      acknowledgeError: null,
      acknowledgeNotice: null,
    }));

    try {
      await api.acknowledgeAlarm(
        farmId,
        alarmId,
        createAlarmAcknowledgementIdempotencyKey(alarmId),
      );
      if (!isCurrentFarm(farmId)) return;
      setOnline(true);
      const currentCycleId = selectedCycleIdRef.current;
      await Promise.all([
        refreshAlarms(farmId, currentCycleId),
        refreshAuditEvents(farmId, currentCycleId),
      ]);
      if (!isCurrentFarmCycle(farmId, originCycleId)) return;
      setAlarmsState((current) => ({
        ...current,
        acknowledgeError: null,
        acknowledgeNotice: "알람 확인이 반영되었습니다.",
      }));
    } catch (error) {
      if (!isCurrentFarm(farmId)) return;
      if (isConnectionFailure(error)) setOnline(false);
      if (!isCurrentFarmCycle(farmId, originCycleId)) return;
      setAlarmsState((current) => ({
        ...current,
        acknowledgeError: userFacingError(error, navigator.onLine, {
          defaultMessage: "알람 확인을 저장하지 못했습니다.",
        }),
        acknowledgeNotice: null,
      }));
    } finally {
      setAlarmsState((current) => ({
        ...current,
        acknowledgingAlarmId: current.acknowledgingAlarmId === alarmId
          ? null
          : current.acknowledgingAlarmId,
      }));
    }
  }, [refreshAlarms, refreshAuditEvents]);

  const createCrop = useCallback(async (input: CreateCropRequestInput): Promise<CropRecord | null> => {
    const farmId = selectedFarmIdRef.current;
    if (farmId === null) return null;
    setCropsState((current) => ({ ...current, submitBusy: true, submitError: null }));

    try {
      const crop = await api.createCrop(farmId, input);
      if (!isCurrentFarm(farmId)) return null;
      setOnline(true);
      setCropsState((current) => ({
        ...current,
        items: upsertCropRecord(current.items, crop),
        submitBusy: false,
        submitError: null,
      }));
      setSelectedCropId(crop.id);
      setLastCreatedCropId(crop.id);
      return crop;
    } catch (error) {
      if (!isCurrentFarm(farmId)) return null;
      if (isConnectionFailure(error)) setOnline(false);
      setCropsState((current) => ({
        ...current,
        submitBusy: false,
        submitError: userFacingError(error, navigator.onLine, {
          conflictMessage: "같은 범위의 작물 기록과 충돌했습니다. 새로고침 후 다시 시도해 주세요.",
          defaultMessage: "작물을 저장하지 못했습니다.",
        }),
      }));
      return null;
    }
  }, []);

  const updateCrop = useCallback(async (
    cropId: string,
    input: PatchCropRequestInput,
  ): Promise<CropRecord | null> => {
    const farmId = selectedFarmIdRef.current;
    if (farmId === null) return null;
    setCropsState((current) => ({ ...current, submitBusy: true, submitError: null }));

    try {
      const crop = await api.updateCrop(farmId, cropId, input);
      if (!isCurrentFarm(farmId)) return null;
      setOnline(true);
      setCropsState((current) => ({
        ...current,
        items: upsertCropRecord(current.items, crop),
        submitBusy: false,
        submitError: null,
      }));
      setSelectedCropId(crop.id);
      setLastCreatedCropId(null);
      return crop;
    } catch (error) {
      if (!isCurrentFarm(farmId)) return null;
      if (isConnectionFailure(error)) setOnline(false);
      setCropsState((current) => ({
        ...current,
        submitBusy: false,
        submitError: userFacingError(error, navigator.onLine, {
          notFoundMessage: "수정할 작물 기록을 찾지 못했습니다.",
          conflictMessage: "작물 기록 변경이 충돌했습니다. 목록을 새로고침한 뒤 다시 시도해 주세요.",
          defaultMessage: "작물 변경을 저장하지 못했습니다.",
        }),
      }));
      return null;
    }
  }, []);

  const deleteCrop = useCallback(async (cropId: string): Promise<boolean> => {
    const farmId = selectedFarmIdRef.current;
    if (farmId === null) return false;
    setCropsState((current) => ({ ...current, submitBusy: true, submitError: null }));

    try {
      await api.deleteCrop(farmId, cropId);
      if (!isCurrentFarm(farmId)) return false;
      setOnline(true);
      setCropsState((current) => {
        const remaining = removeCropRecord(current.items, cropId);
        return {
          ...current,
          items: remaining,
          submitBusy: false,
          submitError: null,
        };
      });
      setSelectedCropId((current) => current === cropId ? null : current);
      setLastCreatedCropId(null);
      return true;
    } catch (error) {
      if (!isCurrentFarm(farmId)) return false;
      if (isConnectionFailure(error)) setOnline(false);
      setCropsState((current) => ({
        ...current,
        submitBusy: false,
        submitError: userFacingError(error, navigator.onLine, {
          notFoundMessage: "삭제할 작물 기록을 찾지 못했습니다.",
          defaultMessage: "작물 기록을 삭제하지 못했습니다.",
        }),
      }));
      return false;
    }
  }, []);

  const saveControlProfile = async (
    widgets: readonly FarmControlWidget[],
  ): Promise<boolean> => {
    const farmId = selectedFarmIdRef.current;
    const currentProfile = controlProfile.profile;
    if (farmId === null || currentProfile === null) {
      setControlProfile((current) => ({
        ...current,
        error: "맞춤 제어 설정을 먼저 불러와 주세요.",
        notice: null,
      }));
      return false;
    }

    const operation = controlProfileOperation.current + 1;
    controlProfileOperation.current = operation;
    setControlProfile((current) => ({
      ...current,
      saving: true,
      error: null,
      notice: null,
    }));

    try {
      const profile = await api.updateFarmControlProfile(farmId, {
        expectedRevision: currentProfile.revision,
        widgets,
      });
      if (controlProfileOperation.current !== operation || !isCurrentFarm(farmId)) return false;
      setOnline(true);
      setControlProfile({
        profile,
        loading: false,
        refreshing: false,
        saving: false,
        error: null,
        notice: "농장 맞춤 제어 설정을 저장했습니다.",
      });
      return true;
    } catch (error) {
      if (controlProfileOperation.current !== operation || !isCurrentFarm(farmId)) return false;
      if (isConnectionFailure(error)) setOnline(false);
      setControlProfile((current) => ({
        ...current,
        saving: false,
        error: userFacingError(error, navigator.onLine, {
          conflictMessage: "다른 화면에서 설정이 변경되었습니다. 새로고침 후 다시 편집해 주세요.",
          defaultMessage: "농장 맞춤 제어 설정을 저장하지 못했습니다.",
        }),
        notice: null,
      }));
      return false;
    }
  };

  const selectDevice = useCallback((deviceId: string) => {
    selectedDeviceIdRef.current = deviceId;
    selectedScopeRef.current = selectedFarmIdRef.current === null
      ? null
      : { farmId: selectedFarmIdRef.current, deviceId };
    setSelectedDeviceId(deviceId);
    setLastCreatedCropId(null);
  }, []);

  const installApp = async () => {
    if (installPrompt === null) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const selectUiLocale = useCallback((locale: UiLocale) => {
    if (!writeBrowserUiLocale(locale)) {
      setUiLocaleError("날짜·시간 형식을 저장할 수 없습니다. 브라우저 저장소 설정을 확인해 주세요.");
      return;
    }

    setUiLocaleError(null);
    setUiLocale(locale);
  }, []);

  const discoveryError = farmsState.error ?? devicesState.error;

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#overview" aria-label="SmartFarm OS 홈">
          <span className="brand-mark" aria-hidden="true">SF</span>
          <span className="brand-copy">
            <strong>SmartFarm OS</strong>
            <small>Farm Operations</small>
          </span>
        </a>
        <div className="topbar-actions">
          {installPrompt !== null && (
            <button className="install-button" type="button" onClick={() => void installApp()}>
              앱 설치
            </button>
          )}
          <span
            className={`connection-state ${online ? "is-online" : "is-offline"}`}
            aria-label={`시스템 ${online ? "온라인" : "오프라인"}`}
          >
            <span className="status-dot" aria-hidden="true" />
            <strong>{online ? "온라인" : "오프라인"}</strong>
          </span>
        </div>
      </header>

      <div className="workspace-shell">
        <aside className="workspace-sidebar" aria-label="앱 탐색과 상태">
          <section className="panel-block sidebar-note">
            <p className="section-label">운영 워크스페이스</p>
            <h2>농장 업무 관리</h2>
            <p className="muted-copy">
              선택한 농장과 장치를 기준으로 현황, 기록, 제어 업무를 이어서 처리합니다.
            </p>
          </section>

          <NavigationTabs route={route} items={APP_NAV_ITEMS} onNavigate={setRoute} />

          <ScopeSidebar
            farms={farmsState.items}
            devices={devicesState.items}
            selectedFarmId={selectedFarmId}
            selectedDeviceId={selectedDeviceId}
            selectedFarm={selectedFarm}
            selectedDevice={selectedDevice}
            farmsLoading={farmsState.loading || farmsState.refreshing}
            devicesLoading={devicesState.loading || devicesState.refreshing}
            error={discoveryError}
            onFarmChange={(farmId) => {
              comparisonOperation.current += 1;
              irrigationLoadOperation.current += 1;
              irrigationApplicationOperation.current += 1;
              areaComparisonScopeRef.current = null;
              irrigationScopeRef.current = null;
              const emptyAreaComparison = createEmptyAreaTelemetryComparisonState();
              const emptyIrrigation = createEmptyIrrigationStrategyViewState();
              areaComparisonRef.current = emptyAreaComparison;
              selectedFarmIdRef.current = farmId;
              selectedDeviceIdRef.current = null;
              selectedCycleIdRef.current = null;
              selectedScopeRef.current = null;
              setDevicesState({ items: [], loading: true, refreshing: false, error: null });
              setOperationsState({
                items: [],
                areas: [],
                loading: true,
                refreshing: false,
                error: null,
              });
              setAreaComparison(emptyAreaComparison);
              setCommandHistory(createEmptyCommandHistoryState());
              setIrrigation(emptyIrrigation);
              setCropsState({
                items: [],
                loading: true,
                refreshing: false,
                error: null,
                submitBusy: false,
                submitError: null,
              });
              setAlarmsState({
                items: [],
                loading: true,
                refreshing: false,
                error: null,
                acknowledgingAlarmId: null,
                acknowledgeError: null,
                acknowledgeNotice: null,
              });
              setAuditState({
                items: [],
                loading: true,
                refreshing: false,
                error: null,
              });
              controlProfileOperation.current += 1;
              setControlProfile({
                ...createEmptyFarmControlProfileViewState(),
                loading: true,
              });
              setSelectedFarmId(farmId);
              setSelectedDeviceId(null);
              setSelectedCycleId(null);
              setSelectedCropId(null);
              setLastCreatedCropId(null);
            }}
            onDeviceChange={selectDevice}
          />
        </aside>

        <main id="main" className="app-main">
          <section className="context-toolbar" aria-label="현재 작업 범위">
            <div className="context-toolbar-title">
              <span className="context-kicker">현재 작업 범위</span>
              <strong>{selectedFarm?.name ?? "농장 선택 대기"}</strong>
            </div>
            <dl className="context-facts">
              <div>
                <dt>장치</dt>
                <dd>{selectedDevice?.name ?? "선택 대기"}</dd>
              </div>
              <div>
                <dt>연결</dt>
                <dd>{online ? "정상" : "오프라인"}</dd>
              </div>
            </dl>
          </section>
          {renderRoute(route, {
            farmCount: farmsState.items.length,
            deviceCount: devicesState.items.length,
            devices: devicesState.items,
            areas: operationsState.areas,
            cropCycles: operationsState.items,
            alarms: selectedCycleId === null
              ? []
              : alarmsState.items.filter((alarm) => alarm.cycleId === selectedCycleId),
            alarmsLoading: alarmsState.loading,
            alarmsRefreshing: alarmsState.refreshing,
            alarmsError: alarmsState.error,
            acknowledgingAlarmId: alarmsState.acknowledgingAlarmId,
            acknowledgeAlarmError: alarmsState.acknowledgeError,
            acknowledgeAlarmNotice: alarmsState.acknowledgeNotice,
            auditEvents: auditState.items,
            auditLoading: auditState.loading,
            auditRefreshing: auditState.refreshing,
            auditError: auditState.error,
            operationsLoading: operationsState.loading,
            operationsRefreshing: operationsState.refreshing,
            operationsError: operationsState.error,
            areaComparison,
            irrigation,
            commandHistory,
            crops: cropsState.items,
            cropsLoading: cropsState.loading,
            cropsRefreshing: cropsState.refreshing,
            cropsError: cropsState.error,
            cropsSubmitBusy: cropsState.submitBusy,
            cropsSubmitError: cropsState.submitError,
            selectedFarm,
            selectedDevice,
            selectedCycleId,
            selectedCropId,
            lastCreatedCropId,
            online,
            uiLocale,
            uiLocaleError,
            adminConsoleUrl,
            nowMs,
            telemetry,
            telemetryHistory,
            command,
            controlProfile,
            onNavigate: setRoute,
            onLocaleChange: selectUiLocale,
            onSelectCycle: (cycleId) => {
              comparisonOperation.current += 1;
              irrigationLoadOperation.current += 1;
              irrigationApplicationOperation.current += 1;
              areaComparisonScopeRef.current = null;
              irrigationScopeRef.current = null;
              const emptyAreaComparison = createEmptyAreaTelemetryComparisonState();
              const emptyIrrigation = createEmptyIrrigationStrategyViewState();
              areaComparisonRef.current = emptyAreaComparison;
              selectedCycleIdRef.current = cycleId;
              selectedFarmCycleRef.current = selectedFarmId === null
                ? null
                : { farmId: selectedFarmId, cycleId };
              setAreaComparison(emptyAreaComparison);
              setIrrigation(emptyIrrigation);
              setSelectedCycleId(cycleId);
            },
            onSelectIrrigationStrategy: (id, version) => {
              const eligibleAreaIds = irrigationScopeRef.current?.eligibleAreaIds ?? [];
              setIrrigation((current) => (
                current.applying || current.application?.status === "pending"
                  ? current
                  : {
                    ...current,
                    selectedStrategyId: id,
                    selectedStrategyVersion: version,
                    selectedAreaIds: orderAreaIdsByEligibility(
                      current.selectedAreaIds,
                      eligibleAreaIds,
                    ),
                    applicationConfirmed: false,
                    application: null,
                    applying: false,
                    applicationError: null,
                  }
              ));
            },
            onToggleIrrigationArea: (areaId, selected) => {
              const scope = irrigationScopeRef.current;
              if (scope === null) return;
              setIrrigation((current) => {
                if (current.applying || current.application?.status === "pending") return current;
                const selectedAreaIds = toggleAreaIdInEligibilityOrder(
                  current.selectedAreaIds,
                  areaId,
                  selected,
                  scope.eligibleAreaIds,
                );
                return {
                  ...current,
                  selectedAreaIds,
                  applicationConfirmed: selectedAreaIds === current.selectedAreaIds
                    ? current.applicationConfirmed
                    : false,
                  application: selectedAreaIds === current.selectedAreaIds
                    ? current.application
                    : null,
                  applicationError: selectedAreaIds === current.selectedAreaIds
                    ? current.applicationError
                    : null,
                };
              });
            },
            onConfirmIrrigationApplication: (confirmed) => {
              setIrrigation((current) => (
                current.applying || current.application?.status === "pending"
                  ? current
                  : {
                    ...current,
                    applicationConfirmed: confirmed,
                    applicationError: confirmed ? null : current.applicationError,
                  }
              ));
            },
            onApplyIrrigationStrategy: () => {
              const scope = irrigationScopeRef.current;
              if (scope === null || !navigator.onLine) {
                setIrrigation((current) => ({
                  ...current,
                  applying: false,
                  applicationError: userFacingError(null, false),
                }));
                return;
              }

              const currentState = irrigationRef.current;
              const selectedStrategy = findIrrigationStrategy(
                currentState.items,
                currentState.selectedStrategyId,
                currentState.selectedStrategyVersion,
              );
              const selectedAreaIds = orderAreaIdsByEligibility(
                currentState.selectedAreaIds,
                scope.eligibleAreaIds,
              );
              if (
                selectedStrategy === null
                || selectedStrategy.status !== "approved"
                || selectedAreaIds.length === 0
                || !currentState.applicationConfirmed
              ) {
                setIrrigation((current) => ({
                  ...current,
                  applying: false,
                  applicationError: "전략, 대상 구역, 적용 전 확인을 마친 뒤 다시 시도해 주세요.",
                }));
                return;
              }

              const operation = irrigationApplicationOperation.current + 1;
              irrigationApplicationOperation.current = operation;
              setIrrigation((current) => ({
                ...current,
                selectedAreaIds,
                applicationConfirmed: false,
                applying: true,
                applicationError: null,
              }));

              void (async () => {
                let application: StrategyApplication;
                try {
                  application = await api.applyIrrigationStrategy(
                    scope.farmId,
                    selectedStrategy.id,
                    {
                      cycleId: scope.cycleId,
                      strategyVersion: selectedStrategy.version,
                      areaIds: selectedAreaIds,
                      idempotencyKey: createIdempotencyKey(),
                    },
                  );
                } catch (error) {
                  if (!isCurrentIrrigationScopeForApplication(scope, operation)) return;
                  if (isConnectionFailure(error)) setOnline(false);
                  setIrrigation((current) => ({
                    ...current,
                    applying: false,
                    applicationError: userFacingError(error, navigator.onLine, {
                      defaultMessage: "관수 전략 적용을 시작하지 못했습니다.",
                    }),
                  }));
                  return;
                }

                if (!isCurrentIrrigationScopeForApplication(scope, operation)) return;
                setOnline(true);
                setIrrigation((current) => ({
                  ...current,
                  application,
                  applying: application.status === "pending",
                  applicationError: null,
                }));

                if (application.status === "pending") {
                  await followIrrigationApplication(scope, application, operation);
                  return;
                }

                void refreshCommandHistory(scope.farmId);
                void refreshAuditEvents(scope.farmId, scope.cycleId);
              })();
            },
            onSelectCrop: setSelectedCropId,
            onAcknowledgeAlarm: (alarmId) => {
              void acknowledgeAlarm(alarmId);
            },
            onRefreshAlarmCenter: () => {
              if (selectedFarmId !== null) {
                void refreshAlarms(selectedFarmId, selectedCycleId);
                void refreshAuditEvents(selectedFarmId, selectedCycleId);
              }
            },
            onRefreshOperations: () => {
              if (selectedFarmId !== null) {
                void refreshOperations(selectedFarmId);
                void refreshCommandHistory(selectedFarmId);
              }
              if (areaComparisonScopeRef.current !== null) {
                void refreshAreaComparison(areaComparisonScopeRef.current);
              }
              if (irrigationScopeRef.current !== null) {
                void refreshIrrigationStrategies(irrigationScopeRef.current);
                resumePendingIrrigationApplication(irrigationScopeRef.current);
              }
            },
            onRefreshTelemetry: () => {
              if (selectedScope !== null) {
                void refreshTelemetry(selectedScope);
                void refreshTelemetryHistory(selectedScope);
              }
            },
            onSelectDevice: selectDevice,
            onRequestPumpState: requestPumpState,
            onRefreshControlProfile: () => {
              if (selectedFarmId !== null) void refreshControlProfile(selectedFarmId);
            },
            onSaveControlProfile: saveControlProfile,
            onRefreshCrops: () => {
              if (selectedFarmId !== null) void refreshCrops(selectedFarmId);
            },
            onCreateCrop: createCrop,
            onUpdateCrop: updateCrop,
            onDeleteCrop: deleteCrop,
          })}
        </main>
      </div>
    </div>
  );

  function isCurrentScope(scope: SelectionScope): boolean {
    return selectedScopeRef.current?.farmId === scope.farmId
      && selectedScopeRef.current?.deviceId === scope.deviceId;
  }

  function isCurrentFarm(farmId: string): boolean {
    return selectedFarmIdRef.current === farmId;
  }

  function isCurrentFarmCycle(farmId: string, cycleId: string | null): boolean {
    return selectedFarmCycleRef.current?.farmId === farmId
      && selectedFarmCycleRef.current?.cycleId === cycleId;
  }

  function isCurrentAreaComparisonScope(scope: AreaComparisonScope, operation: number): boolean {
    return comparisonOperation.current === operation
      && areaComparisonScopeRef.current?.signature === scope.signature
      && areaComparisonScopeRef.current?.farmId === scope.farmId
      && areaComparisonScopeRef.current?.cycleId === scope.cycleId;
  }

  function isCurrentIrrigationScope(scope: IrrigationScope, operation: number): boolean {
    return irrigationLoadOperation.current === operation
      && irrigationScopeRef.current?.signature === scope.signature
      && irrigationScopeRef.current?.farmId === scope.farmId
      && irrigationScopeRef.current?.cycleId === scope.cycleId;
  }

  function isCurrentIrrigationScopeForApplication(
    scope: IrrigationScope,
    operation: number,
  ): boolean {
    return irrigationApplicationOperation.current === operation
      && irrigationScopeRef.current?.farmId === scope.farmId
      && irrigationScopeRef.current?.cycleId === scope.cycleId;
  }

  function isCurrentIrrigationApplication(
    scope: IrrigationScope,
    applicationId: string,
    operation: number,
  ): boolean {
    return isCurrentIrrigationScopeForApplication(scope, operation)
      && irrigationRef.current.application?.id === applicationId;
  }

  function createTelemetryStateFromCache(scope: SelectionScope): TelemetryViewState {
    const nextState = createEmptyTelemetryViewState();
    for (const metric of ENVIRONMENT_TELEMETRY_METRICS) {
      nextState[metric] = createMetricStateFromCache(
        readCachedTelemetry(localStorage, scope, metric),
      );
    }
    return nextState;
  }
}

function renderRoute(
  route: string,
  input: WebModuleRenderContext & {
    readonly farmCount: number;
    readonly deviceCount: number;
    readonly uiLocale: UiLocale;
    readonly uiLocaleError: string | null;
    readonly adminConsoleUrl: string | null;
    readonly onNavigate: (route: string) => void;
    readonly onLocaleChange: (locale: UiLocale) => void;
  },
) {
  if (route === "overview") {
    return (
      <OverviewPage
        selectedFarm={input.selectedFarm}
        selectedDevice={input.selectedDevice}
        farmCount={input.farmCount}
        deviceCount={input.deviceCount}
        quickLinks={APP_HOME_CARDS}
        onNavigate={input.onNavigate}
      />
    );
  }

  if (route === "settings") {
    return (
      <SettingsPage
        selectedFarm={input.selectedFarm}
        selectedDevice={input.selectedDevice}
        farmCount={input.farmCount}
        deviceCount={input.deviceCount}
        online={input.online}
        locale={input.uiLocale}
        localeError={input.uiLocaleError}
        adminUrl={input.adminConsoleUrl}
        onLocaleChange={input.onLocaleChange}
        onNavigate={input.onNavigate}
      />
    );
  }

  return renderWebModuleRoute(route, input);
}

function resolveCycleSelection(
  cropCycles: readonly CropCycleDetail[],
  currentCycleId: string | null,
): string | null {
  if (currentCycleId !== null && cropCycles.some((detail) => detail.cycle.id === currentCycleId)) {
    return currentCycleId;
  }
  return cropCycles.find((detail) => detail.cycle.status === "active")?.cycle.id
    ?? cropCycles[0]?.cycle.id
    ?? null;
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ readonly outcome: "accepted" | "dismissed" }>;
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function isConnectionFailure(error: unknown): boolean {
  return error instanceof SmartFarmApiError
    && (error.kind === "network" || error.kind === "timeout");
}

function isMetricNotFound(error: unknown): boolean {
  return error instanceof SmartFarmApiError
    && error.kind === "http"
    && error.apiCode === "not_found";
}

function createMetricStateFromCache(
  latest: MetricTelemetryViewState["latest"],
): MetricTelemetryViewState {
  return {
    ...createEmptyMetricTelemetryViewState(),
    latest,
    loading: latest === null,
    cached: latest !== null,
  };
}

type AreaComparisonScope = {
  readonly farmId: string;
  readonly cycleId: string;
  readonly signature: string;
  readonly items: readonly AreaTelemetryComparisonItem[];
};

type ComparisonMetricResult = {
  readonly state: AreaTelemetryMetricState;
  readonly connectionFailure: boolean;
};

type IrrigationScope = {
  readonly farmId: string;
  readonly cycleId: string;
  readonly eligibleAreaIds: readonly GrowingArea["id"][];
  readonly signature: string;
};

function createEmptyCommandHistoryState(): CommandHistoryViewState {
  return {
    items: [],
    loading: false,
    refreshing: false,
    error: null,
  };
}

function createEmptyAreaTelemetryMetricState(): AreaTelemetryMetricState {
  return {
    latest: null,
    points: [],
    loading: false,
    refreshing: false,
    cached: false,
    error: null,
  };
}

function createAreaTelemetryComparisonItem(
  area: GrowingArea,
  device: Device,
): AreaTelemetryComparisonItem {
  return {
    areaId: area.id,
    areaName: area.name,
    areaKind: area.kind,
    areaStatus: area.status,
    deviceId: device.id,
    deviceName: device.name,
    deviceStatus: device.status,
    metrics: createAreaTelemetryMetrics(),
  };
}

function createAreaTelemetryComparisonStateFromCache(
  scope: AreaComparisonScope,
  storage: Storage,
): AreaTelemetryComparisonState {
  return {
    items: scope.items.map((item) => ({
      ...item,
      metrics: Object.fromEntries(
        ENVIRONMENT_TELEMETRY_METRICS.map((metric) => [
          metric,
          createAreaTelemetryMetricStateFromCache(
            readCachedTelemetry(storage, { farmId: scope.farmId, deviceId: item.deviceId }, metric),
          ),
        ]),
      ) as AreaTelemetryComparisonItem["metrics"],
    })),
    loading: false,
    refreshing: false,
    error: null,
  };
}

function createPendingAreaComparisonState(
  current: AreaTelemetryComparisonState,
  scopeItems: readonly AreaTelemetryComparisonItem[],
  showLoading: boolean,
): AreaTelemetryComparisonState {
  const currentItemsByKey = new Map(
    current.items.map((item) => [createAreaComparisonItemKey(item.areaId, item.deviceId), item]),
  );
  const items = scopeItems.map((item) => {
    const previous = currentItemsByKey.get(createAreaComparisonItemKey(item.areaId, item.deviceId));
    const metrics = Object.fromEntries(
      ENVIRONMENT_TELEMETRY_METRICS.map((metric) => [
        metric,
        createPendingAreaTelemetryMetricState(previous?.metrics[metric], showLoading),
      ]),
    ) as AreaTelemetryComparisonItem["metrics"];
    return {
      ...item,
      metrics,
    };
  });
  const hasVisibleData = items.some((item) => (
    ENVIRONMENT_TELEMETRY_METRICS.some((metric) => {
      const state = item.metrics[metric];
      return state.latest !== null || state.points.length > 0;
    })
  ));

  return {
    items,
    loading: showLoading && items.length > 0 && !hasVisibleData,
    refreshing: items.length > 0 && hasVisibleData,
    error: null,
  };
}

function createPendingAreaTelemetryMetricState(
  previous: AreaTelemetryMetricState | undefined,
  showLoading: boolean,
): AreaTelemetryMetricState {
  const next = previous ?? createEmptyAreaTelemetryMetricState();
  const hasVisibleData = next.latest !== null || next.points.length > 0;
  return {
    ...next,
    loading: showLoading && !hasVisibleData,
    refreshing: hasVisibleData,
    error: null,
  };
}

function createAreaTelemetryMetricStateFromCache(
  latest: LatestTelemetryResponse | null,
): AreaTelemetryMetricState {
  return {
    ...createEmptyAreaTelemetryMetricState(),
    latest,
    loading: latest === null,
    cached: latest !== null,
  };
}

function createAreaTelemetryMetrics(): Record<EnvironmentTelemetryMetric, AreaTelemetryMetricState> {
  return {
    temperature: createEmptyAreaTelemetryMetricState(),
    humidity: createEmptyAreaTelemetryMetricState(),
    illuminance: createEmptyAreaTelemetryMetricState(),
    water_level: createEmptyAreaTelemetryMetricState(),
  };
}

function createAreaComparisonScopeSignature(
  farmId: string,
  cycleId: string,
  items: readonly AreaTelemetryComparisonItem[],
): string {
  return `${farmId}::${cycleId}::${items.map((item) => (
    `${item.areaId}:${item.deviceId}`
  )).join("|")}`;
}

function createAreaComparisonItemKey(areaId: string, deviceId: string): string {
  return `${areaId}:${deviceId}`;
}

function createIrrigationScopeSignature(
  farmId: string,
  cycleId: string,
  eligibleAreaIds: readonly GrowingArea["id"][],
): string {
  return `${farmId}::${cycleId}::${eligibleAreaIds.join("|")}`;
}

function orderAreaIdsByEligibility(
  areaIds: readonly GrowingArea["id"][],
  eligibleAreaIds: readonly GrowingArea["id"][],
): readonly GrowingArea["id"][] {
  const selectedSet = new Set(areaIds);
  const ordered = eligibleAreaIds.filter((areaId) => selectedSet.has(areaId));
  return arraysEqual(ordered, areaIds) ? areaIds : ordered;
}

function toggleAreaIdInEligibilityOrder(
  areaIds: readonly GrowingArea["id"][],
  areaId: GrowingArea["id"],
  selected: boolean,
  eligibleAreaIds: readonly GrowingArea["id"][],
): readonly GrowingArea["id"][] {
  if (!eligibleAreaIds.includes(areaId)) {
    return orderAreaIdsByEligibility(areaIds, eligibleAreaIds);
  }

  const nextSet = new Set(areaIds);
  if (selected) {
    nextSet.add(areaId);
  } else {
    nextSet.delete(areaId);
  }
  return orderAreaIdsByEligibility([...nextSet], eligibleAreaIds);
}

function resolveIrrigationStrategySelection(
  strategies: readonly IrrigationStrategy[],
  selectedStrategyId: IrrigationStrategyViewState["selectedStrategyId"],
  selectedStrategyVersion: number | null,
): IrrigationStrategy | null {
  return findIrrigationStrategy(strategies, selectedStrategyId, selectedStrategyVersion)
    ?? strategies[0]
    ?? null;
}

function findIrrigationStrategy(
  strategies: readonly IrrigationStrategy[],
  selectedStrategyId: IrrigationStrategyViewState["selectedStrategyId"],
  selectedStrategyVersion: number | null,
): IrrigationStrategy | null {
  if (selectedStrategyId === null || selectedStrategyVersion === null) return null;
  return strategies.find((strategy) => (
    strategy.id === selectedStrategyId && strategy.version === selectedStrategyVersion
  )) ?? null;
}

function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
