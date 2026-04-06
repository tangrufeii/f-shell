import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type Ref } from "react";
import type { CommandHistoryItem } from "../types";

type TerminalToolbarProps = {
  historyMenuRef: Ref<HTMLDivElement>;
  searchInputRef: Ref<HTMLInputElement>;
  isHistoryMenuOpen: boolean;
  commandHistory: CommandHistoryItem[];
  scopedCommandHistory: CommandHistoryItem[];
  historySelection: string;
  historyTriggerSummary: string;
  currentDirectoryPath: string;
  commandDraft: string;
  searchQuery: string;
  searchResultCount: number;
  searchCounterLabel: string;
  statusLine: string;
  hasConnection: boolean;
  onToggleHistoryMenu: () => void;
  onUseHistoryCommand: (command: string) => void;
  onCopyCommand: (command: string) => void;
  onClearCurrentCommand: () => void;
  onRequestTabCompletion: () => void;
  onExecuteTerminalCommand: () => void;
  onSearchQueryChange: (value: string) => void;
  onSearchKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onJumpSearch: (step: number) => void;
  onClearSearch: () => void;
  onClearTerminal: () => void;
  formatHistoryTime: (value: string) => string;
};

function HistorySection({
  title,
  items,
  historySelection,
  onUseHistoryCommand,
  onCopyCommand,
  formatHistoryTime
}: {
  title: string;
  items: CommandHistoryItem[];
  historySelection: string;
  onUseHistoryCommand: (command: string) => void;
  onCopyCommand: (command: string) => void;
  formatHistoryTime: (value: string) => string;
}) {
  if (!items.length) {
    return null;
  }

  return (
    <div className="history-section">
      <div className="history-section-label">{title}</div>
      {items.map((item) => (
        <div
          key={`${item.cwd}:${item.command}`}
          className={`history-option-row ${historySelection === item.command ? "active" : ""}`}
        >
          <button
            className="history-option-main"
            onClick={() => onUseHistoryCommand(item.command)}
            title={item.command}
          >
            <span className="history-option-command">{item.command}</span>
            <span className="history-option-meta">
              <span>{item.cwd}</span>
              <span>{formatHistoryTime(item.updatedAt)}</span>
            </span>
          </button>
          <button className="history-option-copy" onClick={() => onCopyCommand(item.command)} title="复制命令">
            复制
          </button>
        </div>
      ))}
    </div>
  );
}

export default function TerminalToolbar({
  historyMenuRef,
  searchInputRef,
  isHistoryMenuOpen,
  commandHistory,
  scopedCommandHistory,
  historySelection,
  historyTriggerSummary,
  currentDirectoryPath,
  commandDraft,
  searchQuery,
  searchResultCount,
  searchCounterLabel,
  statusLine,
  hasConnection,
  onToggleHistoryMenu,
  onUseHistoryCommand,
  onCopyCommand,
  onClearCurrentCommand,
  onRequestTabCompletion,
  onExecuteTerminalCommand,
  onSearchQueryChange,
  onSearchKeyDown,
  onJumpSearch,
  onClearSearch,
  onClearTerminal,
  formatHistoryTime
}: TerminalToolbarProps) {
  const [historyTab, setHistoryTab] = useState<"current" | "all">("current");

  useEffect(() => {
    if (isHistoryMenuOpen) {
      setHistoryTab(scopedCommandHistory.length ? "current" : "all");
    }
  }, [isHistoryMenuOpen, scopedCommandHistory.length]);

  const visibleHistory = historyTab === "current" ? scopedCommandHistory : commandHistory;

  return (
    <div className="bottom-toolbar">
      <div className="toolbar-row toolbar-row-primary">
        <div className="toolbar-group command-group">
          <div className="history-dropdown" ref={historyMenuRef}>
            <button
              className="toolbar-button history-trigger"
              disabled={!commandHistory.length}
              onClick={onToggleHistoryMenu}
              title="最近命令"
            >
              <span className="history-trigger-label">{historyTriggerSummary}</span>
              <span className={`history-caret ${isHistoryMenuOpen ? "open" : ""}`}>▾</span>
            </button>
            {isHistoryMenuOpen && commandHistory.length ? (
              <div className="history-menu glass-panel">
                <div className="history-menu-header">
                  <strong>最近命令</strong>
                  <span>{scopedCommandHistory.length} 条当前目录 / {commandHistory.length} 条全部</span>
                </div>
                <div className="history-tabbar">
                  <button
                    className={`history-tab ${historyTab === "current" ? "active" : ""}`}
                    onClick={() => setHistoryTab("current")}
                  >
                    当前目录
                  </button>
                  <button
                    className={`history-tab ${historyTab === "all" ? "active" : ""}`}
                    onClick={() => setHistoryTab("all")}
                  >
                    全部历史
                  </button>
                </div>
                {visibleHistory.length ? (
                  <HistorySection
                    title={historyTab === "current" ? `当前目录 · ${currentDirectoryPath}` : "历史命令"}
                    items={visibleHistory}
                    historySelection={historySelection}
                    onUseHistoryCommand={onUseHistoryCommand}
                    onCopyCommand={onCopyCommand}
                    formatHistoryTime={formatHistoryTime}
                  />
                ) : (
                  <div className="history-empty-state">
                    <strong>{historyTab === "current" ? "当前目录还没命令记录" : "还没有历史命令"}</strong>
                    <span>{historyTab === "current" ? "先在这个目录执行几条命令，这里才会有内容。" : "执行过的命令会按时间显示在这里。"}</span>
                  </div>
                )}
              </div>
            ) : null}
          </div>
          <button className="toolbar-button" disabled={!hasConnection || !commandDraft.trim()} onClick={onClearCurrentCommand}>
            清空当前行
          </button>
          <button className="toolbar-button" disabled={!hasConnection} onClick={onRequestTabCompletion}>
            Tab 补全
          </button>
          <button className="toolbar-button accent" disabled={!hasConnection || !commandDraft.trim()} onClick={onExecuteTerminalCommand}>
            执行当前行
          </button>
        </div>
      </div>

      <div className="toolbar-row toolbar-row-secondary">
        <div className="toolbar-group search-group">
          <input
            ref={searchInputRef}
            className="toolbar-input search-input"
            placeholder="查找终端输出"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            onKeyDown={onSearchKeyDown}
          />
          <button className="toolbar-button icon-button" disabled={!searchResultCount} onClick={() => onJumpSearch(-1)} title="上一个匹配">
            ↑
          </button>
          <button className="toolbar-button icon-button" disabled={!searchResultCount} onClick={() => onJumpSearch(1)} title="下一个匹配">
            ↓
          </button>
          <span className="toolbar-counter">{searchCounterLabel}</span>
        </div>

        <div className="toolbar-group utility-group">
          <button className="toolbar-button" onClick={onClearSearch}>
            清空查找
          </button>
          <button className="toolbar-button" disabled={!hasConnection} onClick={onClearTerminal}>
            Clear
          </button>
          <span className="toolbar-hint">Ctrl + F</span>
          <span className="toolbar-status" title={statusLine}>
            {statusLine}
          </span>
        </div>
      </div>
    </div>
  );
}
