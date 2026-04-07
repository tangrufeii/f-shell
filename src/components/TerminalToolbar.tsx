import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type Ref } from "react";
import type { CommandHistoryItem } from "../types";

type TerminalToolbarProps = {
  historyMenuRef: Ref<HTMLDivElement>;
  searchInputRef: Ref<HTMLInputElement>;
  isHistoryMenuOpen: boolean;
  commandHistory: CommandHistoryItem[];
  scopedCommandHistory: CommandHistoryItem[];
  favoriteCommandHistory: CommandHistoryItem[];
  historySelection: string;
  historyTriggerSummary: string;
  currentDirectoryPath: string;
  hasCommandDraft: boolean;
  searchQuery: string;
  searchResultCount: number;
  searchCounterLabel: string;
  statusLine: string;
  hasConnection: boolean;
  onToggleHistoryMenu: () => void;
  onUseHistoryCommand: (command: string) => void;
  onCopyCommand: (command: string) => void;
  onToggleFavorite: (command: string, cwd: string) => void;
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

function HistoryOptionRow({
  item,
  historySelection,
  onUseHistoryCommand,
  onCopyCommand,
  onToggleFavorite,
  formatHistoryTime
}: {
  item: CommandHistoryItem;
  historySelection: string;
  onUseHistoryCommand: (command: string) => void;
  onCopyCommand: (command: string) => void;
  onToggleFavorite: (command: string, cwd: string) => void;
  formatHistoryTime: (value: string) => string;
}) {
  return (
    <div className={`history-option-row ${historySelection === item.command ? "active" : ""}`}>
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
      <button
        className={`history-option-favorite ${item.favorite ? "active" : ""}`}
        onClick={() => onToggleFavorite(item.command, item.cwd)}
        title={item.favorite ? "取消收藏命令" : "收藏命令"}
      >
        {item.favorite ? "★" : "☆"}
      </button>
    </div>
  );
}

function HistorySection({
  title,
  items,
  historySelection,
  onUseHistoryCommand,
  onCopyCommand,
  onToggleFavorite,
  formatHistoryTime
}: {
  title: string;
  items: CommandHistoryItem[];
  historySelection: string;
  onUseHistoryCommand: (command: string) => void;
  onCopyCommand: (command: string) => void;
  onToggleFavorite: (command: string, cwd: string) => void;
  formatHistoryTime: (value: string) => string;
}) {
  if (!items.length) {
    return null;
  }

  return (
    <div className="history-section">
      <div className="history-section-label">{title}</div>
      <div className="history-list" onWheel={(event) => event.stopPropagation()}>
        {items.map((item) => (
          <HistoryOptionRow
            key={`${item.cwd}:${item.command}`}
            item={item}
            historySelection={historySelection}
            onUseHistoryCommand={onUseHistoryCommand}
            onCopyCommand={onCopyCommand}
            onToggleFavorite={onToggleFavorite}
            formatHistoryTime={formatHistoryTime}
          />
        ))}
      </div>
    </div>
  );
}

export default function TerminalToolbar({
  historyMenuRef,
  searchInputRef,
  isHistoryMenuOpen,
  commandHistory,
  scopedCommandHistory,
  favoriteCommandHistory,
  historySelection,
  historyTriggerSummary,
  currentDirectoryPath,
  hasCommandDraft,
  searchQuery,
  searchResultCount,
  searchCounterLabel,
  statusLine,
  hasConnection,
  onToggleHistoryMenu,
  onUseHistoryCommand,
  onCopyCommand,
  onToggleFavorite,
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
  const [historyTab, setHistoryTab] = useState<"current" | "all" | "favorites">("current");
  const [historyQuery, setHistoryQuery] = useState("");
  const historyQueryInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isHistoryMenuOpen) {
      setHistoryTab(scopedCommandHistory.length ? "current" : "all");
      window.setTimeout(() => {
        historyQueryInputRef.current?.focus();
      }, 0);
    }
  }, [isHistoryMenuOpen, scopedCommandHistory.length]);

  useEffect(() => {
    if (!isHistoryMenuOpen) {
      setHistoryQuery("");
    }
  }, [isHistoryMenuOpen]);

  const tabHistory = useMemo(
    () => (historyTab === "current" ? scopedCommandHistory : historyTab === "favorites" ? favoriteCommandHistory : commandHistory),
    [commandHistory, favoriteCommandHistory, historyTab, scopedCommandHistory]
  );
  const normalizedHistoryQuery = historyQuery.trim().toLocaleLowerCase();
  const visibleHistory = useMemo(
    () =>
      normalizedHistoryQuery
        ? tabHistory.filter((item) => `${item.command} ${item.cwd}`.toLocaleLowerCase().includes(normalizedHistoryQuery))
        : tabHistory,
    [normalizedHistoryQuery, tabHistory]
  );

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
              <div className="history-menu" onWheel={(event) => event.stopPropagation()}>
                <div className="history-menu-header">
                  <strong>最近命令</strong>
                  <span>{favoriteCommandHistory.length} 条收藏 / {commandHistory.length} 条全部</span>
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
                  <button
                    className={`history-tab ${historyTab === "favorites" ? "active" : ""}`}
                    onClick={() => setHistoryTab("favorites")}
                  >
                    收藏命令
                  </button>
                </div>
                <div className="history-filter-row">
                  <input
                    ref={historyQueryInputRef}
                    className="history-filter-input"
                    placeholder="搜索命令 / 目录"
                    value={historyQuery}
                    onChange={(event) => setHistoryQuery(event.target.value)}
                  />
                  <span className="history-filter-meta">{visibleHistory.length} 条</span>
                </div>
                {visibleHistory.length ? (
                  <HistorySection
                    title={
                      historyTab === "current"
                        ? `当前目录 · ${currentDirectoryPath}`
                        : historyTab === "favorites"
                          ? "收藏命令"
                          : "历史命令"
                    }
                    items={visibleHistory}
                    historySelection={historySelection}
                    onUseHistoryCommand={onUseHistoryCommand}
                    onCopyCommand={onCopyCommand}
                    onToggleFavorite={onToggleFavorite}
                    formatHistoryTime={formatHistoryTime}
                  />
                ) : (
                  <div className="history-empty-state">
                    <strong>
                      {historyTab === "current"
                        ? "当前目录还没命令记录"
                        : historyTab === "favorites"
                          ? "还没有收藏命令"
                          : "还没有历史命令"}
                    </strong>
                    <span>
                      {normalizedHistoryQuery
                        ? "搜索词太刁钻了，换个关键词再试。"
                        : historyTab === "current"
                          ? "先在这个目录执行几条命令，这里才会有内容。"
                          : historyTab === "favorites"
                            ? "点右侧星标，把常用命令固定下来。"
                            : "执行过的命令会按时间显示在这里。"}
                    </span>
                  </div>
                )}
              </div>
            ) : null}
          </div>
          <button className="toolbar-button" disabled={!hasConnection || !hasCommandDraft} onClick={onClearCurrentCommand}>
            清空当前行
          </button>
          <button className="toolbar-button" disabled={!hasConnection} onClick={onRequestTabCompletion}>
            Tab 补全
          </button>
          <button className="toolbar-button accent" disabled={!hasConnection || !hasCommandDraft} onClick={onExecuteTerminalCommand}>
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
