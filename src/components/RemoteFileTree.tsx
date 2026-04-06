import type { DragEventHandler, MouseEventHandler, ReactNode } from "react";

type RemoteFileTreeProps = {
  fileListClassName: string;
  currentDirectoryPath: string;
  summaryLabel: string;
  hasConnection: boolean;
  hasRootEntries: boolean;
  treeNodes: ReactNode;
  onRootDragOver: DragEventHandler<HTMLDivElement>;
  onRootDragLeave: DragEventHandler<HTMLDivElement>;
  onRootDrop: DragEventHandler<HTMLDivElement>;
  onRootContextMenu: MouseEventHandler<HTMLDivElement>;
};

export default function RemoteFileTree({
  fileListClassName,
  currentDirectoryPath,
  summaryLabel,
  hasConnection,
  hasRootEntries,
  treeNodes,
  onRootDragOver,
  onRootDragLeave,
  onRootDrop,
  onRootContextMenu
}: RemoteFileTreeProps) {
  return (
    <section className="tree-shell">
      <div
        className={fileListClassName}
        onDragOver={onRootDragOver}
        onDragLeave={onRootDragLeave}
        onDrop={onRootDrop}
        onContextMenu={onRootContextMenu}
      >
        {hasConnection && hasRootEntries ? (
          <>
            <div className="tree-header">
              <span>{currentDirectoryPath}</span>
              <span>{summaryLabel}</span>
            </div>
            <div className="tree-drop-hint">支持拖拽上传、粘贴图片和 Windows 文件粘贴。</div>
            {treeNodes}
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
