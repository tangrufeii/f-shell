import { useEffect, useRef, useState, type MouseEventHandler, type Ref } from "react";
import type { AppUpdateInfo, ConnectionSummary } from "../types";
import type { ConnectionProfile } from "../lib/connectionProfiles";

type TopToolbarProps = {
  savedProfilesMenuRef: Ref<HTMLDivElement>;
  connection: ConnectionSummary | null;
  connectionHostText: string;
  basicStatusLabel: string;
  basicLatencyLabel: string;
  versionLabel: string;
  statusLine: string;
  savedProfilesLabel: string;
  connectionConfigLabel: string;
  currentPath: string;
  isConnecting: boolean;
  isListing: boolean;
  isWindowFullscreen: boolean;
  isWindowMaximized: boolean;
  updateInfo: AppUpdateInfo | null;
  updateButtonLabel: string;
  updateButtonTitle: string;
  installUpdateButtonLabel: string;
  isInstallingUpdate: boolean;
  activeProfileId: string;
  connectedProfileId: string;
  connectionProfiles: ConnectionProfile[];
  recentConnectionProfiles: ConnectionProfile[];
  failedConnectionProfiles: number;
  isSavedProfilesMenuOpen: boolean;
  onWindowMouseDown: MouseEventHandler<HTMLDivElement>;
  onWindowDoubleClick: MouseEventHandler<HTMLDivElement>;
  onToggleSavedProfilesMenu: () => void;
  onSaveCurrentProfile: () => void;
  onOpenConnectModal: () => void;
  onConnectWithProfile: (profile: ConnectionProfile) => void;
  onDisconnect: () => void;
  onUploadClipboardFiles: () => void;
  onGoParent: () => void;
  onRefreshDirectory: () => void;
  onOpenAbout: () => void;
  onInstallUpdate: () => void;
  onToggleFullscreen: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onCloseWindow: () => void;
  formatTime: (value: string) => string;
};

export default function TopToolbar({
  savedProfilesMenuRef,
  connection,
  connectionHostText,
  basicStatusLabel,
  basicLatencyLabel,
  versionLabel,
  statusLine,
  savedProfilesLabel,
  connectionConfigLabel,
  currentPath,
  isConnecting,
  isListing,
  isWindowFullscreen,
  isWindowMaximized,
  updateInfo,
  updateButtonLabel,
  updateButtonTitle,
  installUpdateButtonLabel,
  isInstallingUpdate,
  activeProfileId,
  connectedProfileId,
  connectionProfiles,
  recentConnectionProfiles,
  failedConnectionProfiles,
  isSavedProfilesMenuOpen,
  onWindowMouseDown,
  onWindowDoubleClick,
  onToggleSavedProfilesMenu,
  onSaveCurrentProfile,
  onOpenConnectModal,
  onConnectWithProfile,
  onDisconnect,
  onUploadClipboardFiles,
  onGoParent,
  onRefreshDirectory,
  onOpenAbout,
  onInstallUpdate,
  onToggleFullscreen,
  onMinimize,
  onToggleMaximize,
  onCloseWindow,
  formatTime
}: TopToolbarProps) {
  const [profileMenuQuery, setProfileMenuQuery] = useState("");
  const profileMenuInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isSavedProfilesMenuOpen) {
      setProfileMenuQuery("");
      return;
    }

    window.setTimeout(() => {
      profileMenuInputRef.current?.focus();
    }, 0);
  }, [isSavedProfilesMenuOpen]);

  const normalizedProfileMenuQuery = profileMenuQuery.trim().toLocaleLowerCase();
  const visibleSavedProfiles = normalizedProfileMenuQuery
    ? connectionProfiles.filter((profile) =>
        [profile.name, profile.host, profile.port, profile.username, profile.lastConnectionMessage]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase()
          .includes(normalizedProfileMenuQuery)
      )
    : connectionProfiles;

  return (
    <div className="corner-toolbar glass-panel drag-region" onMouseDown={onWindowMouseDown} onDoubleClick={onWindowDoubleClick}>
      <div className="toolbar-host">
        <span className={`host-status-dot ${connection ? "live" : ""}`} aria-hidden="true" />
        <div className="toolbar-host-meta">
          <strong>{connection?.name ?? "尚未连接"}</strong>
          <span>{connectionHostText}</span>
        </div>
        <div className="toolbar-host-chips">
          <span className="basic-chip">{basicStatusLabel}</span>
          <span className="basic-chip">{connection?.osLabel ?? "远端主机"}</span>
          <span className="basic-chip">{basicLatencyLabel}</span>
          <span className={`basic-chip ${updateInfo?.available ? "update-chip-live" : ""}`}>{versionLabel}</span>
          <div className="detail-hover">
            <button className="ghost-button small detail-button" disabled={!connection}>
              主机详情
            </button>
            {connection ? (
              <div className="detail-card floating-overlay-panel">
                <div className="detail-card-grid">
                  <div className="detail-item">
                    <span>主机</span>
                    <strong>{connectionHostText}</strong>
                  </div>
                  <div className="detail-item">
                    <span>协议</span>
                    <strong>{connection.protocol}</strong>
                  </div>
                  <div className="detail-item">
                    <span>主目录</span>
                    <strong>{connection.homePath}</strong>
                  </div>
                  <div className="detail-item">
                    <span>延迟</span>
                    <strong>{basicLatencyLabel}</strong>
                  </div>
                  <div className="detail-item">
                    <span>CPU / 内存</span>
                    <strong>暂未提供</strong>
                  </div>
                  <div className="detail-item">
                    <span>最近状态</span>
                    <strong>{statusLine}</strong>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="corner-actions">
        <div className="saved-profiles-dropdown" ref={savedProfilesMenuRef}>
          <button className="ghost-button small" onClick={onToggleSavedProfilesMenu}>
            {savedProfilesLabel}
          </button>
          {isSavedProfilesMenuOpen ? (
            <div className="saved-profiles-menu floating-overlay-panel">
              <div className="saved-profiles-menu-head">
                <strong>快速切换连接</strong>
                <span>{failedConnectionProfiles} 条最近失败 / {connectionProfiles.length} 项</span>
              </div>
              <div className="saved-profiles-search-row">
                <input
                  ref={profileMenuInputRef}
                  className="toolbar-input saved-profile-search-input"
                  placeholder="搜索名称、主机、账号或状态"
                  value={profileMenuQuery}
                  onChange={(event) => setProfileMenuQuery(event.target.value)}
                />
                <span className="toolbar-hint">{visibleSavedProfiles.length} 条可见</span>
              </div>
              {recentConnectionProfiles.length ? (
                <div className="saved-profiles-recent">
                  {recentConnectionProfiles.map((profile) => (
                    <button
                      key={profile.id}
                      className={`saved-recent-chip ${connectedProfileId === profile.id ? "connected" : activeProfileId === profile.id ? "active" : ""}`}
                      disabled={isConnecting}
                      onClick={() => onConnectWithProfile(profile)}
                      title={`快速重连 ${profile.username}@${profile.host}:${profile.port}`}
                    >
                      <strong>{profile.name}</strong>
                      <small>
                        {profile.lastConnectionOutcome === "error"
                          ? "上次连接失败"
                          : profile.lastUsedAt
                            ? formatTime(profile.lastUsedAt)
                            : "未使用"}
                      </small>
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="saved-profiles-menu-actions">
                <button className="ghost-button small" disabled={isConnecting} onClick={onSaveCurrentProfile}>
                  保存当前
                </button>
                <button className="ghost-button small" onClick={onOpenConnectModal}>
                  打开配置
                </button>
              </div>
              {connectionProfiles.length ? (
                <div className="saved-profiles-list">
                  {visibleSavedProfiles.slice(0, 8).map((profile) => (
                    <button
                      key={profile.id}
                      className={`saved-profile-option ${activeProfileId === profile.id ? "active" : ""}`}
                      disabled={isConnecting}
                      onClick={() => onConnectWithProfile(profile)}
                      title={`连接 ${profile.username}@${profile.host}:${profile.port}`}
                    >
                      <strong>
                        {profile.name}
                        {profile.lastConnectionOutcome === "error" ? <span className="saved-profile-badge error">失败</span> : null}
                        {profile.pinned ? <span className="saved-profile-badge pinned">置顶</span> : null}
                      </strong>
                      <span>{profile.username}@{profile.host}:{profile.port}</span>
                      <small>
                        {connectedProfileId === profile.id
                          ? "当前在线"
                          : profile.lastConnectionOutcome === "error"
                            ? profile.lastConnectionAt
                              ? `上次失败 ${formatTime(profile.lastConnectionAt)}`
                              : profile.lastConnectionMessage || "上次连接失败"
                          : profile.lastUsedAt
                            ? `最近使用 ${formatTime(profile.lastUsedAt)}`
                            : "点击后直接重连"}
                      </small>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="saved-profiles-empty">
                  <strong>还没有保存连接</strong>
                  <span>连接成功后会自动保留，也可以手动保存当前配置。</span>
                </div>
              )}
              {connectionProfiles.length && !visibleSavedProfiles.length ? (
                <div className="saved-profiles-empty compact-saved-profiles-empty">
                  <strong>没有匹配的连接</strong>
                  <span>换个关键词试试，或者直接打开配置面板管理保存项。</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <button className="ghost-button small" onClick={onOpenConnectModal}>
          {connectionConfigLabel}
        </button>
        <button className="ghost-button small" disabled={!connection || isConnecting} onClick={onDisconnect}>
          断开
        </button>
        <button className="ghost-button small" disabled={!connection} onClick={onUploadClipboardFiles}>
          上传
        </button>
        <button className="ghost-button small" disabled={!connection} onClick={onGoParent}>
          上一级
        </button>
        <button className="ghost-button small" disabled={!connection || !currentPath} onClick={onRefreshDirectory}>
          {isListing ? "刷新中..." : "刷新"}
        </button>
        {updateInfo?.available ? (
          <button className="primary-button small-primary toolbar-update-cta" disabled={isInstallingUpdate} onClick={onInstallUpdate}>
            {installUpdateButtonLabel}
          </button>
        ) : null}
        <button
          className={`ghost-button small update-button ${updateInfo?.available ? "update-ready" : ""}`}
          onClick={onOpenAbout}
          title={updateButtonTitle}
        >
          {updateButtonLabel}
        </button>
        <button className="ghost-button small" onClick={onToggleFullscreen} title={isWindowFullscreen ? "退出全屏" : "全屏"}>
          {isWindowFullscreen ? "退出全屏" : "全屏"}
        </button>
        <div className="window-controls">
          <button className="window-button" onClick={onMinimize} title="最小化">
            _
          </button>
          <button className="window-button" onClick={onToggleMaximize} title={isWindowMaximized ? "还原" : "最大化"}>
            {isWindowMaximized ? "❐" : "□"}
          </button>
          <button className="window-button danger" onClick={onCloseWindow} title="关闭">
            ×
          </button>
        </div>
      </div>
    </div>
  );
}
