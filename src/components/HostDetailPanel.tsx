import type { ConnectionSummary } from "../types";

type HostDetailPanelProps = {
  connection: ConnectionSummary;
  connectionHostText: string;
  basicLatencyLabel: string;
  systemSnapshotError: string;
  memoryUsageLabel: string;
  rootUsageLabel: string;
  cpuCoreLabel: string;
  memoryTotalLabel: string;
  rootTotalLabel: string;
  loadAverageLabel: string;
  uptimeLabel: string;
  topProcessLabel: string;
};

export default function HostDetailPanel({
  connection,
  connectionHostText,
  basicLatencyLabel,
  systemSnapshotError,
  memoryUsageLabel,
  rootUsageLabel,
  cpuCoreLabel,
  memoryTotalLabel,
  rootTotalLabel,
  loadAverageLabel,
  uptimeLabel,
  topProcessLabel
}: HostDetailPanelProps) {
  return (
    <div className="detail-card floating-overlay-panel">
      <div className="detail-card-header">
        <div className="detail-card-header-copy">
          <strong>主机详情</strong>
          <span>连接信息和远端资源概览</span>
        </div>
        <span className={`detail-card-badge ${systemSnapshotError ? "error" : "live"}`}>{systemSnapshotError ? "采样失败" : "主机在线"}</span>
      </div>
      <div className="detail-card-grid detail-card-summary">
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
          <span>内存占用</span>
          <strong>{memoryUsageLabel}</strong>
        </div>
        <div className="detail-item">
          <span>根分区占用</span>
          <strong>{rootUsageLabel}</strong>
        </div>
        <div className="detail-item">
          <span>CPU 核心数</span>
          <strong>{cpuCoreLabel}</strong>
        </div>
        <div className="detail-item">
          <span>总内存 / 总硬盘</span>
          <strong>{`${memoryTotalLabel} / ${rootTotalLabel}`}</strong>
        </div>
      </div>
      <div className="detail-card-grid detail-card-meta">
        <div className="detail-item">
          <span>负载</span>
          <strong>{loadAverageLabel}</strong>
        </div>
        <div className="detail-item">
          <span>运行时长</span>
          <strong>{uptimeLabel}</strong>
        </div>
        <div className="detail-item">
          <span>当前状态</span>
          <strong>{connection.status}</strong>
        </div>
        <div className="detail-item">
          <span>当前 Top 进程</span>
          <strong>{topProcessLabel}</strong>
        </div>
      </div>
      {systemSnapshotError ? <small className="detail-card-error">{systemSnapshotError}</small> : null}
    </div>
  );
}
