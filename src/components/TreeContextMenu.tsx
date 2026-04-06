import type { Ref } from "react";
import type { RemoteEntry } from "../types";

type TreeContextMenuState = {
  x: number;
  y: number;
  entry: RemoteEntry | null;
  targetDir: string;
  targetLabel: string;
};

type TreeContextMenuProps = {
  menuRef: Ref<HTMLDivElement>;
  menu: TreeContextMenuState;
  entryAccessLabel: string;
  canOpenDirectory: boolean;
  canPreviewEntry: boolean;
  canCreateInDirectory: boolean;
  canManageEntry: boolean;
  canDownloadEntry: boolean;
  canUploadToEntry: boolean;
  hasConnection: boolean;
  downloadLabel: string;
  onOpenEntry: () => void;
  onCreateFile: () => void;
  onCreateDirectory: () => void;
  onRename: () => void;
  onDownload: () => void;
  onRefresh: () => void;
  onJumpInTerminal: () => void;
  onPasteFiles: () => void;
  onCopyPath: () => void;
  onCopyName: () => void;
  onDelete: () => void;
};

export default function TreeContextMenu({
  menuRef,
  menu,
  entryAccessLabel,
  canOpenDirectory,
  canPreviewEntry,
  canCreateInDirectory,
  canManageEntry,
  canDownloadEntry,
  canUploadToEntry,
  hasConnection,
  downloadLabel,
  onOpenEntry,
  onCreateFile,
  onCreateDirectory,
  onRename,
  onDownload,
  onRefresh,
  onJumpInTerminal,
  onPasteFiles,
  onCopyPath,
  onCopyName,
  onDelete
}: TreeContextMenuProps) {
  return (
    <div ref={menuRef} className="tree-context-menu glass-panel" style={{ left: menu.x, top: menu.y }}>
      <div className="tree-context-menu-head">
        <strong>{menu.entry?.name ?? menu.targetLabel}</strong>
        <span>{menu.entry ? entryAccessLabel : "当前目录"}</span>
      </div>

      {menu.entry?.isDir ? (
        <button className="context-action" disabled={!canOpenDirectory} onClick={onOpenEntry}>
          打开目录
        </button>
      ) : menu.entry ? (
        <button className="context-action" disabled={!canPreviewEntry} onClick={onOpenEntry}>
          预览文件
        </button>
      ) : null}

      <button className="context-action" disabled={!hasConnection || !canCreateInDirectory} onClick={onCreateFile}>
        新建文件
      </button>

      <button className="context-action" disabled={!hasConnection || !canCreateInDirectory} onClick={onCreateDirectory}>
        新建目录
      </button>

      {menu.entry ? (
        <button className="context-action" disabled={!canManageEntry} onClick={onRename}>
          重命名
        </button>
      ) : null}

      <button className="context-action" disabled={!hasConnection || !canDownloadEntry} onClick={onDownload}>
        {downloadLabel}
      </button>

      <button className="context-action" disabled={!hasConnection} onClick={onRefresh}>
        刷新这里
      </button>

      <button className="context-action" disabled={!hasConnection} onClick={onJumpInTerminal}>
        在终端进入这里
      </button>

      <button className="context-action" disabled={!canUploadToEntry} onClick={onPasteFiles}>
        贴文件到这里
      </button>

      <button className="context-action" onClick={onCopyPath}>
        复制路径
      </button>

      {menu.entry ? (
        <button className="context-action" onClick={onCopyName}>
          复制名称
        </button>
      ) : null}

      {menu.entry ? (
        <button className="context-action danger-action" disabled={!canManageEntry} onClick={onDelete}>
          删除
        </button>
      ) : null}
    </div>
  );
}
