import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type DragEventHandler,
  type MouseEvent as ReactMouseEvent,
  type MouseEventHandler,
  type ReactNode
} from "react";
import type { RemoteEntry } from "../types";

const TREE_ROW_HEIGHT = 38;
const TREE_OVERSCAN = 10;

export type RemoteFileTreeNode = {
  key: string;
  entry: RemoteEntry;
  level: number;
  accessState: "writable" | "readonly" | "blocked";
  accessLabel: string;
  accessBadge: string;
  accessHint: string;
  dropTargetDir: string;
  targetLabel: string;
  isActive: boolean;
  isExpanded: boolean;
  isDropTarget: boolean;
  isLoading: boolean;
  modifiedAtLabel: string;
  sizeLabel: string;
  permissionsLabel: string;
  title: string;
};

type RemoteFileTreeProps = {
  fileListClassName: string;
  currentDirectoryPath: string;
  summaryLabel: string;
  hasConnection: boolean;
  hasRootEntries: boolean;
  legend?: ReactNode;
  treeNodes: RemoteFileTreeNode[];
  onRootDragOver: DragEventHandler<HTMLDivElement>;
  onRootDragLeave: DragEventHandler<HTMLDivElement>;
  onRootDrop: DragEventHandler<HTMLDivElement>;
  onRootContextMenu: MouseEventHandler<HTMLDivElement>;
  onOpenEntry: (entry: RemoteEntry) => void;
  onOpenContextMenu: (
    event: ReactMouseEvent<HTMLButtonElement>,
    entry: RemoteEntry,
    targetDir: string,
    targetLabel: string
  ) => void;
  onRowDragOver: (event: ReactDragEvent<HTMLButtonElement>, targetDir: string) => void;
  onRowDragLeave: (event: ReactDragEvent<HTMLButtonElement>, targetDir: string) => void;
  onRowDrop: (event: ReactDragEvent<HTMLButtonElement>, entry: RemoteEntry) => void;
};

export default function RemoteFileTree({
  fileListClassName,
  currentDirectoryPath,
  summaryLabel,
  hasConnection,
  hasRootEntries,
  legend,
  treeNodes,
  onRootDragOver,
  onRootDragLeave,
  onRootDrop,
  onRootContextMenu,
  onOpenEntry,
  onOpenContextMenu,
  onRowDragOver,
  onRowDragLeave,
  onRowDrop
}: RemoteFileTreeProps) {
  const scrollBodyRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const container = scrollBodyRef.current;
    if (!container) {
      return;
    }

    const updateMetrics = () => {
      setViewportHeight(container.clientHeight);
      setScrollTop(container.scrollTop);
    };

    updateMetrics();

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            updateMetrics();
          })
        : null;

    resizeObserver?.observe(container);
    window.addEventListener("resize", updateMetrics);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateMetrics);
    };
  }, [hasConnection, hasRootEntries]);

  const totalHeight = treeNodes.length * TREE_ROW_HEIGHT;
  const visibleRange = useMemo(() => {
    if (!viewportHeight || !treeNodes.length) {
      return {
        startIndex: 0,
        endIndex: Math.min(treeNodes.length, TREE_OVERSCAN * 2)
      };
    }

    const startIndex = Math.max(0, Math.floor(scrollTop / TREE_ROW_HEIGHT) - TREE_OVERSCAN);
    const endIndex = Math.min(
      treeNodes.length,
      Math.ceil((scrollTop + viewportHeight) / TREE_ROW_HEIGHT) + TREE_OVERSCAN
    );

    return { startIndex, endIndex };
  }, [scrollTop, treeNodes.length, viewportHeight]);

  const visibleNodes = useMemo(
    () => treeNodes.slice(visibleRange.startIndex, visibleRange.endIndex),
    [treeNodes, visibleRange.endIndex, visibleRange.startIndex]
  );
  const offsetY = visibleRange.startIndex * TREE_ROW_HEIGHT;

  return (
    <section className="tree-shell">
      <div className={fileListClassName}>
        {hasConnection && hasRootEntries ? (
          <>
            <div className="tree-header">
              <span>{currentDirectoryPath}</span>
              <span>{summaryLabel}</span>
            </div>
            <div className="tree-drop-hint">支持拖拽上传、粘贴图片和 Windows 文件粘贴。</div>
            {legend ? <div className="tree-legend">{legend}</div> : null}
            <div
              ref={scrollBodyRef}
              className="tree-scroll-body"
              onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
              onDragOver={onRootDragOver}
              onDragLeave={onRootDragLeave}
              onDrop={onRootDrop}
              onContextMenu={onRootContextMenu}
            >
              <div className="tree-scroll-spacer" style={{ height: `${totalHeight}px` }}>
                <div className="tree-scroll-window" style={{ transform: `translateY(${offsetY}px)` }}>
                  {visibleNodes.map((node) => (
                    <button
                      className={`tree-row ${node.isActive ? "active" : ""} ${node.isDropTarget ? "drag-over" : ""} access-${node.accessState}`}
                      key={node.key}
                      onClick={() => onOpenEntry(node.entry)}
                      onContextMenu={(event) => onOpenContextMenu(event, node.entry, node.dropTargetDir, node.targetLabel)}
                      onDragOver={(event) => onRowDragOver(event, node.dropTargetDir)}
                      onDragLeave={(event) => onRowDragLeave(event, node.dropTargetDir)}
                      onDrop={(event) => onRowDrop(event, node.entry)}
                      style={{ height: `${TREE_ROW_HEIGHT}px`, paddingLeft: `${16 + node.level * 18}px` }}
                      title={node.title}
                    >
                      <span className="tree-toggle">{node.entry.isDir ? (node.isExpanded ? "▾" : "▸") : ""}</span>
                      <span className={`file-icon ${node.entry.isDir ? "dir" : "file"} ${node.accessState}`} aria-hidden="true" />
                      <span className="tree-main">
                        <span className="tree-main-head">
                          <span className="tree-name">{node.entry.name}</span>
                          <span className={`entry-access-badge ${node.isLoading ? "loading" : node.accessState}`}>
                            {node.isLoading ? "加载中" : node.accessBadge}
                          </span>
                        </span>
                        <span className="tree-submeta">
                          {node.isLoading
                            ? "目录 · 正在读取远端内容..."
                            : `${node.entry.isDir ? "目录" : "文件"} · ${node.accessLabel} · ${node.modifiedAtLabel}`}
                        </span>
                      </span>
                      <span className="file-meta">
                        {node.entry.isDir ? node.permissionsLabel : `${node.sizeLabel} · ${node.permissionsLabel}`}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="empty-state tree-empty-state">
            <strong>{hasConnection ? "当前目录没有内容" : "先连接 SSH"}</strong>
            <p>{hasConnection ? "目录可能为空，或当前账号没有访问权限。" : "连接成功后即可浏览远端目录。"}</p>
          </div>
        )}
      </div>
    </section>
  );
}
