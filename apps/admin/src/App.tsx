import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Device, Farm } from "@smartfarm-os/contracts";
import { AdminGatewayApi, AdminGatewayApiError } from "./api/admin-gateway-api";
import { GatewayAdminPage } from "./components/gateway-admin-page";
import type {
  GatewayAccessView,
  IssuedGatewayEnrollment,
} from "./gateway-admin-model";

const api = new AdminGatewayApi({
  baseUrl: import.meta.env.PUBLIC_API_BASE_URL?.trim() || "/api",
});

type LoadState = {
  readonly farms: readonly Farm[];
  readonly devices: readonly Device[];
  readonly access: GatewayAccessView | null;
  readonly loading: boolean;
  readonly error: string | null;
};

export default function App() {
  const [state, setState] = useState<LoadState>({
    farms: [],
    devices: [],
    access: null,
    loading: true,
    error: null,
  });
  const [selectedFarmId, setSelectedFarmId] = useState("");
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [issuedEnrollment, setIssuedEnrollment] = useState<IssuedGatewayEnrollment | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const selectionRevision = useRef(0);

  const selectedFarm = useMemo(
    () => state.farms.find((farm) => farm.id === selectedFarmId) ?? null,
    [selectedFarmId, state.farms],
  );

  const refreshAccess = useCallback(async (farmId: string, deviceId: string) => {
    const revision = selectionRevision.current + 1;
    selectionRevision.current = revision;
    setState((current) => ({ ...current, loading: true, error: null }));

    try {
      const access = await api.gatewayAccess(farmId, deviceId);
      if (selectionRevision.current !== revision) return;
      setState((current) => ({ ...current, access, loading: false, error: null }));
    } catch (error) {
      if (selectionRevision.current !== revision) return;
      setState((current) => ({
        ...current,
        access: null,
        loading: false,
        error: userFacingError(error),
      }));
    }
  }, []);

  const loadDevices = useCallback(async (farmId: string) => {
    const revision = selectionRevision.current + 1;
    selectionRevision.current = revision;
    setIssuedEnrollment(null);
    setState((current) => ({ ...current, devices: [], access: null, loading: true, error: null }));

    try {
      const devices = await api.listDevices(farmId);
      if (selectionRevision.current !== revision) return;
      const nextDeviceId = devices[0]?.id ?? "";
      setSelectedDeviceId(nextDeviceId);
      setState((current) => ({ ...current, devices, access: null, loading: nextDeviceId !== "", error: null }));
      if (nextDeviceId !== "") await refreshAccess(farmId, nextDeviceId);
    } catch (error) {
      if (selectionRevision.current !== revision) return;
      setState((current) => ({ ...current, loading: false, error: userFacingError(error) }));
    }
  }, [refreshAccess]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const farms = await api.listFarms();
        if (cancelled) return;
        const farmId = farms[0]?.id ?? "";
        setSelectedFarmId(farmId);
        setState((current) => ({ ...current, farms, loading: farmId !== "", error: null }));
        if (farmId !== "") await loadDevices(farmId);
      } catch (error) {
        if (cancelled) return;
        setState((current) => ({ ...current, loading: false, error: userFacingError(error) }));
      }
    })();

    return () => {
      cancelled = true;
      selectionRevision.current += 1;
    };
  }, [loadDevices]);

  useEffect(() => {
    if (issuedEnrollment === null) return;
    // The server enforces the authoritative expiry. Keep the one-time value in
    // memory for at most the documented TTL so a skewed browser clock cannot
    // erase a still-valid token immediately.
    const timeout = window.setTimeout(() => setIssuedEnrollment(null), 10 * 60 * 1_000);
    return () => window.clearTimeout(timeout);
  }, [issuedEnrollment]);

  const issueEnrollment = async () => {
    if (selectedFarmId === "" || selectedDeviceId === "" || busyAction !== null) return;
    setBusyAction("issue");
    setIssuedEnrollment(null);
    setState((current) => ({ ...current, error: null }));

    try {
      const issued = await api.issueEnrollment(selectedFarmId, selectedDeviceId);
      setIssuedEnrollment(issued);
      await refreshAccess(selectedFarmId, selectedDeviceId);
    } catch (error) {
      setState((current) => ({ ...current, error: userFacingError(error) }));
    } finally {
      setBusyAction(null);
    }
  };

  const revokeCredential = async (credentialId: string) => {
    if (selectedFarmId === "" || selectedDeviceId === "" || busyAction !== null) return;
    setBusyAction(credentialId);
    setState((current) => ({ ...current, error: null }));

    try {
      await api.revokeCredential(selectedFarmId, selectedDeviceId, credentialId);
      await refreshAccess(selectedFarmId, selectedDeviceId);
    } catch (error) {
      setState((current) => ({ ...current, error: userFacingError(error) }));
    } finally {
      setBusyAction(null);
    }
  };

  const revokeEnrollment = async (enrollmentId: string) => {
    if (selectedFarmId === "" || selectedDeviceId === "" || busyAction !== null) return;
    setBusyAction(enrollmentId);
    setState((current) => ({ ...current, error: null }));

    try {
      await api.revokeEnrollment(selectedFarmId, selectedDeviceId, enrollmentId);
      if (issuedEnrollment?.id === enrollmentId) setIssuedEnrollment(null);
      await refreshAccess(selectedFarmId, selectedDeviceId);
    } catch (error) {
      setState((current) => ({ ...current, error: userFacingError(error) }));
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <GatewayAdminPage
      farms={state.farms}
      devices={state.devices}
      selectedFarmId={selectedFarmId}
      selectedDeviceId={selectedDeviceId}
      access={state.access}
      issuedEnrollment={issuedEnrollment}
      loading={state.loading}
      busyAction={busyAction}
      error={state.error}
      authMode={import.meta.env.PUBLIC_ADMIN_AUTH_MODE === "external" ? "external" : "demo"}
      onSelectFarm={(farmId) => {
        setSelectedFarmId(farmId);
        setSelectedDeviceId("");
        void loadDevices(farmId);
      }}
      onSelectDevice={(deviceId) => {
        setSelectedDeviceId(deviceId);
        setIssuedEnrollment(null);
        void refreshAccess(selectedFarmId, deviceId);
      }}
      onIssueEnrollment={() => void issueEnrollment()}
      onRevokeCredential={(credentialId) => void revokeCredential(credentialId)}
      onRevokeEnrollment={(enrollmentId) => void revokeEnrollment(enrollmentId)}
      onRefresh={() => {
        if (selectedFarm !== null && selectedDeviceId !== "") {
          void refreshAccess(selectedFarm.id, selectedDeviceId);
        }
      }}
      onDismissEnrollment={() => setIssuedEnrollment(null)}
    />
  );
}

function userFacingError(error: unknown): string {
  if (!(error instanceof AdminGatewayApiError)) {
    return "요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (error.kind === "network") return "SmartFarm 서버에 연결할 수 없습니다.";
  if (error.kind === "timeout") return "서버 응답이 늦어지고 있습니다.";
  if (error.statusCode === 401) return "관리자 로그인이 필요합니다.";
  if (error.statusCode === 403) return "게이트웨이 관리 권한이 없습니다.";
  if (error.statusCode === 404) return "선택한 농장 또는 장치를 찾지 못했습니다.";
  if (error.statusCode === 409) return "현재 등록 상태와 충돌했습니다. 새로고침해 주세요.";
  return "게이트웨이 관리 요청을 완료하지 못했습니다.";
}
