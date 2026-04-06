import type { AppUpdateInfo, AppUpdateProgress } from "../types";

type UpdatePreferenceKey = "autoCheckOnStartup" | "showAvailableNoticeOnStartup";

type AboutUpdateDialogProps = {
  isOpen: boolean;
  appVersion: string | null;
  updateInfo: AppUpdateInfo | null;
  updateProgress: AppUpdateProgress | null;
  updateStatusLabel: string;
  publishedAtLabel: string;
  updateLatencyLabel: string;
  updateProgressStatusLabel: string;
  updateProgressDetailLabel: string;
  updateProgressValueLabel: string;
  updateCheckOutcomeLabel: string;
  updateProgressPercent: number;
  isUpdateProgressActive: boolean;
  isUpdateProgressIndeterminate: boolean;
  isCheckingUpdate: boolean;
  isInstallingUpdate: boolean;
  aboutPrimaryLabel: string;
  lastCheckedAtLabel: string;
  dismissedUpdateVersion: string;
  releasePageUrl: string;
  latestJsonUrl: string;
  releaseNotesList: string[];
  updatePreferences: {
    autoCheckOnStartup: boolean;
    showAvailableNoticeOnStartup: boolean;
  };
  onClose: () => void;
  onCheckUpdate: () => void;
  onInstallUpdate: () => void;
  onCopyReleasePage: () => void;
  onCopyLatestJson: () => void;
  onCopyVersion: () => void;
  onUpdatePreference: (key: UpdatePreferenceKey, value: boolean) => void;
  onClearDismissedVersion: () => void;
};

export default function AboutUpdateDialog({
  isOpen,
  appVersion,
  updateInfo,
  updateProgress,
  updateStatusLabel,
  publishedAtLabel,
  updateLatencyLabel,
  updateProgressStatusLabel,
  updateProgressDetailLabel,
  updateProgressValueLabel,
  updateCheckOutcomeLabel,
  updateProgressPercent,
  isUpdateProgressActive,
  isUpdateProgressIndeterminate,
  isCheckingUpdate,
  isInstallingUpdate,
  aboutPrimaryLabel,
  lastCheckedAtLabel,
  dismissedUpdateVersion,
  releasePageUrl,
  latestJsonUrl,
  releaseNotesList,
  updatePreferences,
  onClose,
  onCheckUpdate,
  onInstallUpdate,
  onCopyReleasePage,
  onCopyLatestJson,
  onCopyVersion,
  onUpdatePreference,
  onClearDismissedVersion
}: AboutUpdateDialogProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="glass-panel connect-dialog about-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="section-title">
          <div>
            <p className="eyebrow">应用信息</p>
            <h2>关于 / 更新</h2>
          </div>
          <span className={`status-pill ${updateInfo?.available ? "about-pill-highlight" : "live"}`}>{updateStatusLabel}</span>
        </div>

        {updateInfo?.available ? (
          <div className="form-alert update-alert">
            <strong>发现可安装更新</strong>
            <span>{updateInfo.message}</span>
          </div>
        ) : (
          <div className="form-alert about-alert">
            <strong>当前版本信息</strong>
            <span>{updateInfo?.message ?? "还没查过更新，点下面按钮就会去 GitHub Releases 拉最新状态。"}</span>
          </div>
        )}

        <div className="about-grid">
          <div className="about-card">
            <span>当前版本</span>
            <strong>{appVersion || "--"}</strong>
            <small>当前运行中的桌面版本</small>
          </div>
          <div className="about-card">
            <span>最新版本</span>
            <strong>{updateInfo?.version ?? appVersion ?? "--"}</strong>
            <small>{updateInfo?.available ? "GitHub Releases 已发现更新" : "已同步到最新发布状态"}</small>
          </div>
          <div className="about-card">
            <span>发布时间</span>
            <strong>{publishedAtLabel}</strong>
            <small>来自 updater 返回的发布时间</small>
          </div>
          <div className="about-card">
            <span>更新源</span>
            <strong>GitHub Releases</strong>
            <small>latest.json + installer signatures</small>
          </div>
          <div className="about-card">
            <span>检查耗时</span>
            <strong>{updateLatencyLabel}</strong>
            <small>GitHub 访问、代理状态和签名校验都会拖慢这里。</small>
          </div>
          <div className="about-card">
            <span>当前阶段</span>
            <strong>{updateProgressStatusLabel}</strong>
            <small>{isInstallingUpdate ? "安装进行中，请勿重复点击。" : "启动后会自动后台检查一次。"}</small>
          </div>
          <div className="about-card">
            <span>上次检查</span>
            <strong>{lastCheckedAtLabel}</strong>
            <small>{updateCheckOutcomeLabel}</small>
          </div>
          <div className="about-card">
            <span>忽略版本</span>
            <strong>{dismissedUpdateVersion || "--"}</strong>
            <small>{dismissedUpdateVersion ? "这个版本在启动时不会重复弹提醒。" : "当前没有被忽略的版本。"}</small>
          </div>
        </div>

        <div className="about-progress-block">
          <div className="update-progress-meta">
            <span>{updateProgress?.message ?? "还没有开始下载安装，发现新版本后这里会显示实时进度。"}</span>
            <strong>{updateProgressValueLabel}</strong>
          </div>
          <div className="update-progress-track">
            <div
              className={`update-progress-fill ${isUpdateProgressIndeterminate ? "indeterminate" : ""}`}
              style={isUpdateProgressIndeterminate ? undefined : { width: `${updateProgressPercent}%` }}
            />
          </div>
          <div className="update-progress-detail-row">
            <span>{updateProgressStatusLabel}</span>
            <strong>{updateProgressDetailLabel}</strong>
          </div>
          {isUpdateProgressActive ? (
            <div className="update-progress-facts">
              <div className="update-progress-fact">
                <span>目标版本</span>
                <strong>{updateProgress?.version ?? updateInfo?.version ?? "--"}</strong>
              </div>
              <div className="update-progress-fact">
                <span>当前阶段</span>
                <strong>{updateProgressStatusLabel}</strong>
              </div>
              <div className="update-progress-fact wide">
                <span>传输明细</span>
                <strong>{updateProgressDetailLabel}</strong>
              </div>
            </div>
          ) : null}
        </div>

        <div className="about-settings-block">
          <div className="section-title compact-title">
            <div>
              <p className="eyebrow">更新设置</p>
              <h3>更新偏好</h3>
            </div>
          </div>
          <div className="about-settings-grid">
            <label className="toggle-card">
              <div className="toggle-copy">
                <strong>启动时自动检查更新</strong>
                <span>应用启动后后台拉 GitHub Releases，不打断当前 SSH 会话。</span>
              </div>
              <input
                type="checkbox"
                checked={updatePreferences.autoCheckOnStartup}
                onChange={(event) => onUpdatePreference("autoCheckOnStartup", event.target.checked)}
              />
              <span className={`toggle-switch ${updatePreferences.autoCheckOnStartup ? "on" : ""}`} aria-hidden="true">
                <span />
              </span>
            </label>
            <label className="toggle-card">
              <div className="toggle-copy">
                <strong>启动时发现新版本就提醒</strong>
                <span>保留静默后台检查，但你可以决定要不要自动弹出更新提示。</span>
              </div>
              <input
                type="checkbox"
                checked={updatePreferences.showAvailableNoticeOnStartup}
                onChange={(event) => onUpdatePreference("showAvailableNoticeOnStartup", event.target.checked)}
              />
              <span className={`toggle-switch ${updatePreferences.showAvailableNoticeOnStartup ? "on" : ""}`} aria-hidden="true">
                <span />
              </span>
            </label>
          </div>
          <div className="about-settings-actions">
            <button className="ghost-button small" onClick={onClearDismissedVersion} disabled={!dismissedUpdateVersion}>
              清除忽略版本
            </button>
            <span className="settings-hint">
              当前策略：{updatePreferences.autoCheckOnStartup ? "启动自动检查" : "仅手动检查"} /{" "}
              {updatePreferences.showAvailableNoticeOnStartup ? "自动提醒新版本" : "只在面板里查看"}
            </span>
          </div>
        </div>

        <div className="list-block about-link-list">
          <div className="about-link-row">
            <span>Release 页面</span>
            <div className="about-link-actions">
              <div className="path-chip subtle">{releasePageUrl}</div>
              <button className="ghost-button small" onClick={onCopyReleasePage}>
                复制
              </button>
            </div>
          </div>
          <div className="about-link-row">
            <span>latest.json</span>
            <div className="about-link-actions">
              <div className="path-chip subtle">{latestJsonUrl}</div>
              <button className="ghost-button small" onClick={onCopyLatestJson}>
                复制
              </button>
            </div>
          </div>
        </div>

        <div className="about-notes-block">
          <div className="section-title compact-title">
            <div>
              <p className="eyebrow">更新说明</p>
              <h3>{updateInfo?.version ? `v${updateInfo.version}` : "尚未获取更新说明"}</h3>
            </div>
          </div>
          <div className="about-notes">
            {releaseNotesList.length > 0 ? (
              <ul className="about-notes-list">
                {releaseNotesList.map((note, index) => (
                  <li key={`${note}-${index}`}>{note}</li>
                ))}
              </ul>
            ) : (
              <p>当前没有额外的更新说明。你也可以直接去 GitHub Release 页面查看完整产物和标签。</p>
            )}
          </div>
        </div>

        <div className="action-row about-action-row">
          <button className="primary-button" disabled={isCheckingUpdate || isInstallingUpdate} onClick={updateInfo?.available ? onInstallUpdate : onCheckUpdate}>
            {aboutPrimaryLabel}
          </button>
          <button className="ghost-button" onClick={onCopyVersion}>
            复制版本号
          </button>
          <button className="ghost-button" onClick={onClose}>
            关闭
          </button>
        </div>
      </section>
    </div>
  );
}
