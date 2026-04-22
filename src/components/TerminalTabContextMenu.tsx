import type { Ref } from "react";

type TerminalTabContextMenuState = {
  x: number;
  y: number;
  terminalId: string;
};

type TerminalTabContextMenuProps = {
  menuRef: Ref<HTMLDivElement>;
  menu: TerminalTabContextMenuState;
  title: string;
  subtitle: string;
  canCloseCurrent: boolean;
  canCloseLeft: boolean;
  canCloseRight: boolean;
  canCloseOthers: boolean;
  onCloseCurrent: () => void;
  onCloseLeft: () => void;
  onCloseRight: () => void;
  onCloseOthers: () => void;
};

export type { TerminalTabContextMenuState };

export default function TerminalTabContextMenu({
  menuRef,
  menu,
  title,
  subtitle,
  canCloseCurrent,
  canCloseLeft,
  canCloseRight,
  canCloseOthers,
  onCloseCurrent,
  onCloseLeft,
  onCloseRight,
  onCloseOthers
}: TerminalTabContextMenuProps) {
  return (
    <div ref={menuRef} className="tree-context-menu glass-panel terminal-tab-context-menu" style={{ left: menu.x, top: menu.y }}>
      <div className="tree-context-menu-head">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>

      <button className="context-action" disabled={!canCloseCurrent} onClick={onCloseCurrent}>
        关闭当前
      </button>

      <button className="context-action" disabled={!canCloseOthers} onClick={onCloseOthers}>
        关闭其他
      </button>

      <button className="context-action" disabled={!canCloseLeft} onClick={onCloseLeft}>
        关闭左侧
      </button>

      <button className="context-action" disabled={!canCloseRight} onClick={onCloseRight}>
        关闭右侧
      </button>
    </div>
  );
}
