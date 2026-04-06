import type { KeyboardEventHandler } from "react";
import type { ConnectionProgress } from "../types";
import type { ConnectionForm, ConnectionProfile } from "../lib/connectionProfiles";

type ConnectFieldErrors = Partial<Record<keyof ConnectionForm, string>>;

type ConnectDialogProps = {
  isOpen: boolean;
  form: ConnectionForm;
  connectFieldErrors: ConnectFieldErrors;
  connectError: string;
  connectionProgress: ConnectionProgress | null;
  connectionProgressPercent: number;
  connectionProgressDetail: string;
  connectionStageLabel: string;
  activeConnectionProfile: ConnectionProfile | null;
  connectionProfiles: ConnectionProfile[];
  visibleConnectionProfiles: ConnectionProfile[];
  pinnedConnectionProfiles: number;
  activeProfileId: string;
  profileSearchQuery: string;
  isConnecting: boolean;
  hasConnection: boolean;
  onClose: () => void;
  onConnect: () => void;
  onReset: () => void;
  onDisconnect: () => void;
  onSaveCurrentProfile: () => void;
  onProfileSearchChange: (value: string) => void;
  onApplyProfile: (profile: ConnectionProfile) => void;
  onTogglePin: (profileId: string) => void;
  onDeleteProfile: (profileId: string) => void;
  onFieldChange: <Key extends keyof ConnectionForm>(field: Key, value: ConnectionForm[Key]) => void;
  formatTime: (value: string | null | undefined) => string;
};

function ConnectField({
  label,
  value,
  error,
  placeholder,
  type = "text",
  onChange,
  onEnter
}: {
  label: string;
  value: string;
  error?: string;
  placeholder?: string;
  type?: string;
  onChange: (value: string) => void;
  onEnter: KeyboardEventHandler<HTMLInputElement>;
}) {
  return (
    <label className={`field ${error ? "has-error" : ""}`}>
      <span>{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onEnter}
      />
      {error ? <small>{error}</small> : null}
    </label>
  );
}

export default function ConnectDialog({
  isOpen,
  form,
  connectFieldErrors,
  connectError,
  connectionProgress,
  connectionProgressPercent,
  connectionProgressDetail,
  connectionStageLabel,
  activeConnectionProfile,
  connectionProfiles,
  visibleConnectionProfiles,
  pinnedConnectionProfiles,
  activeProfileId,
  profileSearchQuery,
  isConnecting,
  hasConnection,
  onClose,
  onConnect,
  onReset,
  onDisconnect,
  onSaveCurrentProfile,
  onProfileSearchChange,
  onApplyProfile,
  onTogglePin,
  onDeleteProfile,
  onFieldChange,
  formatTime
}: ConnectDialogProps) {
  if (!isOpen) {
    return null;
  }

  const handleEnter: KeyboardEventHandler<HTMLInputElement> = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onConnect();
    }
  };

  return (
    <div className="modal-backdrop">
      <section className="glass-panel connect-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="section-title">
          <div>
            <p className="eyebrow">连接</p>
            <h2>连接配置</h2>
          </div>
          <span className={`status-pill ${hasConnection ? "live" : connectionProgress?.isError ? "" : "progress-pill"}`}>
            {hasConnection ? "已在线" : connectionStageLabel}
          </span>
        </div>

        {connectError ? (
          <div className="form-alert error-alert">
            <strong>连接失败</strong>
            <span>{connectError}</span>
          </div>
        ) : null}

        <div className="connect-layout">
          <div className="connect-form-column">
            <ConnectField
              label="连接名称"
              value={form.name}
              error={connectFieldErrors.name}
              onChange={(value) => onFieldChange("name", value)}
              onEnter={handleEnter}
            />

            <ConnectField
              label="主机地址"
              value={form.host}
              error={connectFieldErrors.host}
              placeholder="例如 192.168.1.20 或 example.com"
              onChange={(value) => onFieldChange("host", value)}
              onEnter={handleEnter}
            />

            <div className="field-row">
              <ConnectField
                label="端口"
                value={form.port}
                error={connectFieldErrors.port}
                onChange={(value) => onFieldChange("port", value)}
                onEnter={handleEnter}
              />
              <ConnectField
                label="用户名"
                value={form.username}
                error={connectFieldErrors.username}
                onChange={(value) => onFieldChange("username", value)}
                onEnter={handleEnter}
              />
            </div>

            <label className={`field ${connectFieldErrors.password ? "has-error" : ""}`}>
              <span>密码</span>
              <input
                type="password"
                value={form.password}
                onChange={(event) => onFieldChange("password", event.target.value)}
                onKeyDown={handleEnter}
              />
              {connectFieldErrors.password ? <small>{connectFieldErrors.password}</small> : null}
              <small className="field-hint">密码只用于当前连接，不会保存到本地配置。</small>
            </label>
          </div>

          <aside className="connect-side-column">
            <div className="connect-side-card">
              <div className="section-title compact-title">
                <div>
                  <p className="eyebrow">连接状态</p>
                  <h3>{connectionStageLabel}</h3>
                </div>
              </div>
              <div className={`connect-progress-card ${connectionProgress?.isError ? "error" : hasConnection ? "connected" : ""}`}>
                <div className="connect-progress-head">
                  <strong>{connectionProgress?.message ?? (hasConnection ? "当前会话已连接" : "等待连接")}</strong>
                  <span>{connectionProgress ? `${Math.round(connectionProgressPercent)}%` : hasConnection ? "100%" : "--"}</span>
                </div>
                <div className="update-progress-track connect-progress-track">
                  <div className="update-progress-fill" style={{ width: `${hasConnection ? 100 : connectionProgressPercent}%` }} />
                </div>
                <p>{connectionProgressDetail}</p>
              </div>
            </div>

            <div className="connect-side-card">
              <div className="section-title compact-title">
                <div>
                  <p className="eyebrow">连接配置</p>
                  <h3>{activeConnectionProfile ? activeConnectionProfile.name : "未选择配置"}</h3>
                </div>
                <button className="ghost-button small" disabled={isConnecting} onClick={onSaveCurrentProfile}>
                  保存当前
                </button>
              </div>

              {connectionProfiles.length ? (
                <div className="connection-profile-list">
                  <div className="connection-profile-toolbar">
                    <input
                      className="toolbar-input profile-search-input"
                      placeholder="搜索名称、主机或账号"
                      value={profileSearchQuery}
                      onChange={(event) => onProfileSearchChange(event.target.value)}
                    />
                    <span className="toolbar-hint">
                      {visibleConnectionProfiles.length} / {connectionProfiles.length} 项
                    </span>
                    <span className="toolbar-hint">置顶 {pinnedConnectionProfiles}</span>
                  </div>

                  {visibleConnectionProfiles.length ? (
                    visibleConnectionProfiles.map((profile) => (
                      <div key={profile.id} className={`connection-profile-item ${activeProfileId === profile.id ? "active" : ""}`}>
                        <button className="connection-profile-main" onClick={() => onApplyProfile(profile)}>
                          <strong>{profile.name}</strong>
                          <span>{profile.username}@{profile.host}:{profile.port}</span>
                          <small>{profile.lastUsedAt ? `最近使用 ${formatTime(profile.lastUsedAt)}` : "尚未使用"}</small>
                        </button>
                        <div className="profile-item-actions">
                          <button
                            className={`ghost-button small profile-pin-button ${profile.pinned ? "pinned" : ""}`}
                            disabled={isConnecting}
                            onClick={() => onTogglePin(profile.id)}
                            title={profile.pinned ? `取消置顶 ${profile.name}` : `置顶 ${profile.name}`}
                          >
                            {profile.pinned ? "已置顶" : "置顶"}
                          </button>
                          <button
                            className="ghost-button small profile-delete-button"
                            disabled={isConnecting}
                            onClick={() => onDeleteProfile(profile.id)}
                            title={`删除配置 ${profile.name}`}
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="empty-state compact-empty-state">
                      <strong>没有匹配的配置</strong>
                      <p>换个关键词试试，或者先保存一个新的连接配置。</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="empty-state compact-empty-state">
                  <strong>还没有保存的配置</strong>
                  <p>连接成功后会自动保留，或者先点“保存当前”。</p>
                </div>
              )}
            </div>
          </aside>
        </div>

        <div className="action-row connect-action-row">
          <button className="primary-button" disabled={isConnecting} onClick={onConnect}>
            {isConnecting ? "连接中..." : "建立 SSH 会话"}
          </button>
          <button className="ghost-button" disabled={isConnecting} onClick={onReset}>
            重置
          </button>
          <button className="ghost-button" disabled={!hasConnection || isConnecting} onClick={onDisconnect}>
            断开
          </button>
          <button className="ghost-button" onClick={onClose}>
            关闭
          </button>
        </div>
      </section>
    </div>
  );
}
