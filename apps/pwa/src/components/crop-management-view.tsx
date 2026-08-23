import { useEffect, useMemo, useState } from "react";
import type {
  CreateCropRequestInput,
  CropHealthStatus,
  CropRecord,
  Device,
  Farm,
  PatchCropRequestInput,
} from "@smartfarm-os/contracts";
import {
  createCropDraftFromRecord,
  createCropRequestFromDraft,
  createEmptyCropDraft,
  cropHealthStatusLabel,
  formatDateTime,
  patchCropRequestFromDraft,
  type CropDraft,
} from "../dashboard-model";

type CropManagementViewProps = {
  readonly farm: Farm | null;
  readonly devices: readonly Device[];
  readonly crops: readonly CropRecord[];
  readonly loading: boolean;
  readonly refreshing: boolean;
  readonly error: string | null;
  readonly submitBusy: boolean;
  readonly submitError: string | null;
  readonly selectedCropId: string | null;
  readonly lastCreatedCropId: string | null;
  readonly onSelectCrop: (cropId: string | null) => void;
  readonly onRefresh: () => void;
  readonly onCreateCrop: (input: CreateCropRequestInput) => Promise<CropRecord | null>;
  readonly onUpdateCrop: (cropId: string, input: PatchCropRequestInput) => Promise<CropRecord | null>;
  readonly onDeleteCrop: (cropId: string) => Promise<boolean>;
};

export function CropManagementView({
  farm,
  devices,
  crops,
  loading,
  refreshing,
  error,
  submitBusy,
  submitError,
  selectedCropId,
  lastCreatedCropId,
  onSelectCrop,
  onRefresh,
  onCreateCrop,
  onUpdateCrop,
  onDeleteCrop,
}: CropManagementViewProps) {
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [draft, setDraft] = useState<CropDraft>(() => createEmptyCropDraft());
  const [confirmDeleteCropId, setConfirmDeleteCropId] = useState<string | null>(null);

  const selectedCrop = useMemo(
    () => crops.find((crop) => crop.id === selectedCropId) ?? null,
    [crops, selectedCropId],
  );

  useEffect(() => {
    setMode("create");
    setDraft(createEmptyCropDraft());
    setConfirmDeleteCropId(null);
  }, [farm?.id]);

  useEffect(() => {
    if (mode === "edit" && selectedCrop !== null) {
      setDraft(createCropDraftFromRecord(selectedCrop));
      return;
    }
    if (mode === "create") {
      setDraft(createEmptyCropDraft());
    }
  }, [mode, selectedCrop]);

  useEffect(() => {
    if (selectedCrop === null && mode === "edit") {
      setMode("create");
      setDraft(createEmptyCropDraft());
    }
  }, [mode, selectedCrop]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (mode === "create") {
      const created = await onCreateCrop(createCropRequestFromDraft(draft));
      if (created !== null) {
        onSelectCrop(created.id);
        setMode("edit");
        setDraft(createCropDraftFromRecord(created));
      }
      return;
    }

    if (selectedCrop === null) return;
    const patch = patchCropRequestFromDraft(selectedCrop, draft);
    if (patch === null) return;

    const updated = await onUpdateCrop(selectedCrop.id, patch);
    if (updated !== null) {
      onSelectCrop(updated.id);
      setDraft(createCropDraftFromRecord(updated));
    }
  };

  const handleDelete = async (cropId: string) => {
    if (confirmDeleteCropId !== cropId) {
      setConfirmDeleteCropId(cropId);
      return;
    }

    const deleted = await onDeleteCrop(cropId);
    if (deleted) {
      setConfirmDeleteCropId(null);
      setMode("create");
      setDraft(createEmptyCropDraft());
      onSelectCrop(null);
    }
  };

  const handleEdit = (crop: CropRecord) => {
    setMode("edit");
    setConfirmDeleteCropId(null);
    onSelectCrop(crop.id);
    setDraft(createCropDraftFromRecord(crop));
  };

  const handleCreate = () => {
    setMode("create");
    setConfirmDeleteCropId(null);
    onSelectCrop(null);
    setDraft(createEmptyCropDraft());
  };

  return (
    <section className="page-shell" aria-labelledby="crops-title">
      <header className="page-header">
        <div>
          <p className="section-label">작물일지</p>
          <h1 id="crops-title">{farm?.name ?? "농장 선택 대기"} 작물 기록</h1>
          <p className="page-copy">
            선택한 농장의 작물 목록을 보고, 장치 연결 여부와 건강 상태, 담당자, 메모를 한곳에서 정리할 수 있습니다.
          </p>
        </div>
        <div className="page-actions">
          <button className="text-button" type="button" onClick={onRefresh} disabled={refreshing || farm === null}>
            {refreshing ? "동기화 중" : "목록 새로고침"}
          </button>
          <button className="primary-control" type="button" onClick={handleCreate} disabled={farm === null}>
            새 작물 등록
          </button>
        </div>
      </header>

      <div className="panel-grid two-column">
        <section className="panel-block crop-list-card" aria-labelledby="crop-list-title">
          <div className="page-header compact-header">
            <div>
              <p className="section-label">저장된 목록</p>
              <h2 id="crop-list-title">작물 기록</h2>
            </div>
            <span className="count-pill">{crops.length}개</span>
          </div>

          {loading ? (
            <div className="loading-state" aria-label="작물 목록 불러오는 중">작물 목록을 불러오는 중입니다.</div>
          ) : error !== null ? (
            <p className="inline-error" role="alert">{error}</p>
          ) : crops.length === 0 ? (
            <div className="empty-state">
              <strong>아직 등록된 작물이 없습니다.</strong>
              <span>새 작물 등록으로 첫 기록을 추가하세요.</span>
            </div>
          ) : (
            <div className="crop-list" aria-live="polite">
              {crops.map((crop) => {
                const linkedDevice = devices.find((device) => device.id === crop.deviceId) ?? null;
                const isActive = crop.id === selectedCropId;
                const isCreatedRow = crop.id === lastCreatedCropId;

                return (
                  <article
                    key={crop.id}
                    className={`crop-row ${isActive ? "is-active" : ""}`}
                    data-testid={isCreatedRow ? "crop-row-created" : "crop-row"}
                  >
                    <button
                      className="crop-row-button"
                      type="button"
                      onClick={() => {
                        setMode("edit");
                        setConfirmDeleteCropId(null);
                        onSelectCrop(crop.id);
                      }}
                    >
                      <div className="crop-row-header">
                        <strong>{crop.name}</strong>
                        <span className={`health-pill health-${crop.healthStatus}`}>
                          {cropHealthStatusLabel(crop.healthStatus)}
                        </span>
                      </div>
                      <div className="crop-row-meta">
                        <span>{linkedDevice?.name ?? "장치 연결 없음"}</span>
                        <span>{crop.managerName ?? "담당자 미지정"}</span>
                        <span>{formatDateTime(crop.updatedAt)}</span>
                      </div>
                    </button>
                    <div className="crop-row-actions">
                      <button
                        className="text-button"
                        type="button"
                        data-testid="crop-edit-action"
                        onClick={() => handleEdit(crop)}
                      >
                        수정
                      </button>
                      <button
                        className={confirmDeleteCropId === crop.id ? "danger-button" : "ghost-danger-button"}
                        type="button"
                        data-testid={confirmDeleteCropId === crop.id ? "crop-delete-confirm" : "crop-delete-action"}
                        onClick={() => void handleDelete(crop.id)}
                        disabled={submitBusy}
                      >
                        {confirmDeleteCropId === crop.id ? "삭제 확인" : "삭제"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="panel-block crop-form-card" aria-labelledby="crop-form-title">
          <div className="page-header compact-header">
            <div>
              <p className="section-label">{mode === "create" ? "새 기록" : "선택한 기록"}</p>
              <h2 id="crop-form-title">{mode === "create" ? "작물 등록" : "작물 수정"}</h2>
            </div>
            {selectedCrop !== null && <span className="count-pill">{selectedCrop.id}</span>}
          </div>

          <form
            className="crop-form"
            data-testid={mode === "create" ? "crop-create-form" : undefined}
            onSubmit={(event) => void handleSubmit(event)}
          >
            <label className="field-stack">
              <span>작물 이름</span>
              <input
                data-testid="crop-name-input"
                type="text"
                name="name"
                value={draft.name}
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder="예: 바질 1베드"
                maxLength={120}
                required
              />
            </label>

            <div className="form-grid">
              <label className="field-stack">
                <span>건강 상태</span>
                <select
                  name="healthStatus"
                  value={draft.healthStatus}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    healthStatus: event.target.value as CropHealthStatus,
                  }))}
                >
                  <option value="good">좋음</option>
                  <option value="fair">보통</option>
                  <option value="poor">주의</option>
                </select>
              </label>

              <label className="field-stack">
                <span>연결 장치</span>
                <select
                  name="deviceId"
                  value={draft.deviceId}
                  onChange={(event) => setDraft((current) => ({ ...current, deviceId: event.target.value }))}
                >
                  <option value="">장치 연결 없음</option>
                  {devices.map((device) => (
                    <option key={device.id} value={device.id}>{device.name}</option>
                  ))}
                </select>
              </label>
            </div>

            <label className="field-stack">
              <span>담당자</span>
              <input
                type="text"
                name="managerName"
                value={draft.managerName}
                onChange={(event) => setDraft((current) => ({ ...current, managerName: event.target.value }))}
                placeholder="담당자 이름"
                maxLength={80}
              />
            </label>

            <label className="field-stack">
              <span>메모</span>
              <textarea
                name="notes"
                value={draft.notes}
                onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
                placeholder="파종, 상태 변화, 조치 내용을 기록하세요."
                rows={6}
                maxLength={4_000}
              />
            </label>

            {submitError !== null && <p className="inline-error" role="alert">{submitError}</p>}

            <div className="form-actions">
              <button
                className="primary-control"
                type="submit"
                data-testid={mode === "create" ? "crop-create-submit" : "crop-edit-submit"}
                disabled={submitBusy || farm === null}
              >
                {submitBusy ? "저장 중" : mode === "create" ? "작물 저장" : "변경 저장"}
              </button>
              {mode === "edit" && (
                <button className="secondary-control" type="button" onClick={handleCreate} disabled={submitBusy}>
                  새 등록으로 전환
                </button>
              )}
            </div>
          </form>
        </section>
      </div>
    </section>
  );
}
