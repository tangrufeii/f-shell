import { useEffect, useRef, useState, type CSSProperties, type MouseEventHandler } from "react";
import type { AppUpdateInfo, ConnectionSummary } from "../types";

type ThemeModeOption = "system" | "aurora" | "light" | "dark";

type TopToolbarProps = {
  connection: ConnectionSummary | null;
  connectionUserLabel: string;
  connectionAddressLabel: string;
  appVersionLabel: string;
  themeLabel: string;
  themeMode: ThemeModeOption;
  isWindowFullscreen: boolean;
  isWindowMaximized: boolean;
  updateInfo: AppUpdateInfo | null;
  updateButtonLabel: string;
  updateButtonTitle: string;
  installUpdateButtonLabel: string;
  checkUpdateButtonLabel: string;
  isCheckingUpdate: boolean;
  isInstallingUpdate: boolean;
  onWindowMouseDown: MouseEventHandler<HTMLDivElement>;
  onWindowDoubleClick: MouseEventHandler<HTMLDivElement>;
  onCopyAddress: () => void;
  onSelectTheme: (mode: ThemeModeOption) => void;
  onOpenAbout: () => void;
  onCheckUpdate: () => void;
  onInstallUpdate: () => void;
  onToggleFullscreen: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onCloseWindow: () => void;
};

export default function TopToolbar({
  connection,
  connectionUserLabel,
  connectionAddressLabel,
  appVersionLabel,
  themeLabel,
  themeMode,
  isWindowFullscreen,
  isWindowMaximized,
  updateInfo,
  updateButtonLabel,
  updateButtonTitle,
  installUpdateButtonLabel,
  checkUpdateButtonLabel,
  isCheckingUpdate,
  isInstallingUpdate,
  onWindowMouseDown,
  onWindowDoubleClick,
  onCopyAddress,
  onSelectTheme,
  onOpenAbout,
  onCheckUpdate,
  onInstallUpdate,
  onToggleFullscreen,
  onMinimize,
  onToggleMaximize,
  onCloseWindow
}: TopToolbarProps) {
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);
  const [themeMenuStyle, setThemeMenuStyle] = useState<CSSProperties>({});
  const themeMenuRef = useRef<HTMLDivElement | null>(null);
  const themeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const themeOptions: Array<{ mode: ThemeModeOption; label: string; description: string }> = [
    { mode: "system", label: "跟随系统", description: "自动切换浅色或深色" },
    { mode: "aurora", label: "默认炫彩", description: "保留当前高饱和风格" },
    { mode: "light", label: "浅色主题", description: "干净白底，低刺激" },
    { mode: "dark", label: "深色主题", description: "黑底低光，更耐看" }
  ];

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (themeMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      if (themeTriggerRef.current?.contains(event.target as Node)) {
        return;
      }
      setIsThemeMenuOpen(false);
    };

    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, []);

  useEffect(() => {
    if (!isThemeMenuOpen) {
      return;
    }

    const syncThemeMenuPosition = () => {
      const trigger = themeTriggerRef.current;
      if (!trigger) {
        return;
      }

      const rect = trigger.getBoundingClientRect();
      const viewportPadding = 12;
      const desiredWidth = 248;
      const menuWidth = Math.min(desiredWidth, Math.max(220, window.innerWidth - viewportPadding * 2));
      const estimatedHeight = 252;
      const canPlaceAbove = rect.top > estimatedHeight + viewportPadding;
      const shouldPlaceAbove = rect.bottom + estimatedHeight > window.innerHeight - viewportPadding && canPlaceAbove;
      const left = Math.min(
        Math.max(viewportPadding, rect.right - menuWidth),
        Math.max(viewportPadding, window.innerWidth - menuWidth - viewportPadding)
      );
      const top = shouldPlaceAbove ? rect.top - estimatedHeight - 8 : rect.bottom + 10;

      setThemeMenuStyle({
        left,
        top: Math.max(viewportPadding, top),
        width: menuWidth
      });
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsThemeMenuOpen(false);
      }
    };

    syncThemeMenuPosition();
    window.addEventListener("resize", syncThemeMenuPosition);
    window.addEventListener("scroll", syncThemeMenuPosition, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("resize", syncThemeMenuPosition);
      window.removeEventListener("scroll", syncThemeMenuPosition, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isThemeMenuOpen]);

  return (
    <div className="corner-toolbar glass-panel drag-region" onMouseDown={onWindowMouseDown} onDoubleClick={onWindowDoubleClick}>
      <div className="toolbar-identity">
        <span className={`host-status-dot ${connection ? "live" : ""}`} aria-hidden="true" />
        <strong>{connectionUserLabel}</strong>
        <span className="toolbar-identity-divider" aria-hidden="true" />
        <span className="toolbar-identity-address">{connectionAddressLabel}</span>
        <button className="ghost-button small toolbar-copy-button" disabled={!connection} onClick={onCopyAddress}>
          复制地址
        </button>
        <span className="toolbar-identity-divider" aria-hidden="true" />
        <span className="toolbar-identity-version">{appVersionLabel}</span>
      </div>

      <div className="toolbar-system-actions">
        <div className="toolbar-system-main">
          <div className="toolbar-theme-picker" ref={themeMenuRef}>
            <button
              ref={themeTriggerRef}
              className="ghost-button small"
              onClick={() => setIsThemeMenuOpen((previous) => !previous)}
              title="切换主题"
            >
              {themeLabel}
            </button>
            {isThemeMenuOpen ? (
              <div className="toolbar-theme-menu floating-overlay-panel" style={themeMenuStyle}>
                <div className="toolbar-theme-menu-head">
                  <strong>界面主题</strong>
                  <span>切换后会自动保存</span>
                </div>
                <div className="toolbar-theme-options">
                  {themeOptions.map((option) => (
                    <button
                      key={option.mode}
                      className={`toolbar-theme-option ${themeMode === option.mode ? "active" : ""}`}
                      onClick={() => {
                        onSelectTheme(option.mode);
                        setIsThemeMenuOpen(false);
                      }}
                    >
                      <strong>{option.label}</strong>
                      <span>{option.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          {!updateInfo?.available ? (
            <button className="ghost-button small toolbar-check-update-button" disabled={isCheckingUpdate || isInstallingUpdate} onClick={onCheckUpdate}>
              {checkUpdateButtonLabel}
            </button>
          ) : null}
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
        </div>
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
