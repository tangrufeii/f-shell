import type { KeyboardEventHandler, Ref } from "react";
import type { RemoteEntry } from "../types";

type FileActionMode = "new-file" | "new-directory" | "rename" | "delete";

type FileActionDialogState = {
  mode: FileActionMode;
  targetDir: string;
  entry: RemoteEntry | null;
  name: string;
  errors: {
    name?: string;
  };
  busy: boolean;
  dangerText: string;
};

type FileActionDialogProps = {
  inputRef: Ref<HTMLInputElement>;
  dialog: FileActionDialogState;
  title: string;
  confirmLabel: string;
  onNameChange: (value: string) => void;
  onNameKeyDown: KeyboardEventHandler<HTMLInputElement>;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function FileActionDialog({
  inputRef,
  dialog,
  title,
  confirmLabel,
  onNameChange,
  onNameKeyDown,
  onConfirm,
  onCancel
}: FileActionDialogProps) {
  return (
    <div className="modal-backdrop">
      <section className="glass-panel connect-dialog action-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="section-title">
          <div>
            <p className="eyebrow">文件操作</p>
            <h2>{title}</h2>
          </div>
          <span className={`status-pill ${dialog.mode === "delete" ? "" : "live"}`}>
            {dialog.entry ? dialog.entry.name : dialog.targetDir}
          </span>
        </div>

        {dialog.mode === "delete" ? (
          <div className="form-alert error-alert">
            <strong>确认删除</strong>
            <span>
              即将删除 `{dialog.entry?.path}`。{dialog.dangerText}
            </span>
          </div>
        ) : (
          <label className={`field ${dialog.errors.name ? "has-error" : ""}`}>
            <span>{dialog.mode === "rename" ? "新的名称" : "名称"}</span>
            <input
              ref={inputRef}
              placeholder={dialog.mode === "new-file" ? "例如 index.html" : "输入名称"}
              value={dialog.name}
              onChange={(event) => onNameChange(event.target.value)}
              onKeyDown={onNameKeyDown}
            />
            {dialog.errors.name ? <small>{dialog.errors.name}</small> : null}
          </label>
        )}

        <div className="list-block action-dialog-meta">
          <div className="path-chip subtle">{dialog.targetDir}</div>
          {dialog.entry ? <div className="path-chip subtle">{dialog.entry.path}</div> : null}
        </div>

        <div className="action-row">
          <button
            className={`primary-button ${dialog.mode === "delete" ? "danger-primary" : ""}`}
            disabled={dialog.busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
          <button className="ghost-button" disabled={dialog.busy} onClick={onCancel}>
            取消
          </button>
        </div>
      </section>
    </div>
  );
}
