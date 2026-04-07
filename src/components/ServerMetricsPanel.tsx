import type { CSSProperties } from "react";
import type { RemoteSystemSnapshot } from "../types";

function clampGaugePercent(value: number | null | undefined): number {
  if (value == null || Number.isNaN(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, value));
}

function resolveTrafficTone(bytesPerSec: number): "idle" | "low" | "medium" | "high" {
  if (!bytesPerSec || bytesPerSec <= 0) {
    return "idle";
  }

  if (bytesPerSec < 64 * 1024) {
    return "low";
  }

  if (bytesPerSec < 1024 * 1024) {
    return "medium";
  }

  return "high";
}

function formatBytes(size: number): string {
  if (!size) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = size;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function summarizeProcess(process: RemoteSystemSnapshot["topProcesses"][number] | null): string {
  if (!process) {
    return "暂时没拿到高占用进程";
  }

  return `${process.command} · CPU ${process.cpuPercent.toFixed(1)}%`;
}

type ServerMetricsPanelProps = {
  systemSnapshot: RemoteSystemSnapshot | null;
  cpuUsageLabel: string;
  memoryUsageLabel: string;
  memoryUsagePercentLabel: string;
  loadAverageLabel: string;
  rootUsageLabel: string;
  rootUsagePercentLabel: string;
  networkRxLabel: string;
  networkTxLabel: string;
};

export default function ServerMetricsPanel({
  systemSnapshot,
  cpuUsageLabel,
  memoryUsageLabel,
  memoryUsagePercentLabel,
  loadAverageLabel,
  rootUsageLabel,
  rootUsagePercentLabel,
  networkRxLabel,
  networkTxLabel
}: ServerMetricsPanelProps) {
  const topProcess = systemSnapshot?.topProcesses[0] ?? null;
  const cpuCoreLabel = systemSnapshot?.cpuCoreCount ? `${systemSnapshot.cpuCoreCount} 核心` : "核心数未知";
  const memoryAvailableLabel = systemSnapshot ? formatBytes(systemSnapshot.memoryAvailableBytes) : "--";
  const rootMetaLabel = systemSnapshot
    ? [systemSnapshot.rootMountPath || "/", systemSnapshot.rootFileSystemType || "未知文件系统"].join(" · ")
    : "--";
  const inlineMetrics = [
    {
      key: "cpu",
      label: "CPU",
      value: cpuUsageLabel,
      summary: cpuCoreLabel,
      helper: `负载 ${loadAverageLabel}`,
      detailTitle: "CPU 详情",
      detailRows: [
        { label: "CPU 型号", value: systemSnapshot?.cpuModel?.trim() || "未识别 CPU 型号" },
        { label: "总核心数", value: cpuCoreLabel },
        { label: "平均负载", value: loadAverageLabel },
        { label: "当前 Top", value: summarizeProcess(topProcess) }
      ],
      percent: clampGaugePercent(systemSnapshot?.cpuPercent),
      accent: "#ffb55c"
    },
    {
      key: "memory",
      label: "内存",
      value: memoryUsagePercentLabel,
      summary: memoryUsageLabel,
      helper: `可用 ${memoryAvailableLabel}`,
      detailTitle: "内存详情",
      detailRows: [
        { label: "已用内存", value: systemSnapshot ? formatBytes(systemSnapshot.memoryUsedBytes) : "--" },
        { label: "可用内存", value: memoryAvailableLabel },
        { label: "总内存", value: systemSnapshot ? formatBytes(systemSnapshot.memoryTotalBytes) : "--" },
        { label: "占用率", value: memoryUsagePercentLabel }
      ],
      percent: clampGaugePercent(systemSnapshot?.memoryUsagePercent),
      accent: "#67d3ff"
    },
    {
      key: "disk",
      label: "硬盘",
      value: rootUsagePercentLabel,
      summary: rootUsageLabel,
      helper: rootMetaLabel,
      detailTitle: "磁盘详情",
      detailRows: [
        { label: "挂载信息", value: rootMetaLabel },
        { label: "已用空间", value: systemSnapshot ? formatBytes(systemSnapshot.rootUsedBytes) : "--" },
        { label: "可用空间", value: systemSnapshot ? formatBytes(systemSnapshot.rootAvailableBytes) : "--" },
        { label: "总容量", value: systemSnapshot ? formatBytes(systemSnapshot.rootTotalBytes) : "--" }
      ],
      percent: clampGaugePercent(systemSnapshot?.rootUsagePercent),
      accent: "#ffd66e"
    }
  ];
  const networkRxTone = resolveTrafficTone(systemSnapshot?.networkRxBytesPerSec ?? 0);
  const networkTxTone = resolveTrafficTone(systemSnapshot?.networkTxBytesPerSec ?? 0);

  return (
    <div className="server-metrics-panel">
      <div className="server-metrics-grid" aria-label="服务器资源概览">
        {inlineMetrics.map((metric) => (
          <div key={metric.key} className="toolbar-metric-card server-metric-card">
            <div
              className="toolbar-mini-ring"
              style={
                {
                  "--metric-percent": `${metric.percent}%`,
                  "--metric-accent": metric.accent
                } as CSSProperties
              }
            >
              <strong>{metric.value}</strong>
              <span>{metric.label}</span>
            </div>
            <div className="toolbar-metric-copy">
              <span>{metric.label}</span>
              <strong>{metric.summary}</strong>
              <small>{metric.helper}</small>
            </div>
            <div className="toolbar-metric-popover floating-overlay-panel">
              <div className="toolbar-metric-popover-head">
                <strong>{metric.detailTitle}</strong>
                <span>{metric.value}</span>
              </div>
              <div className="toolbar-metric-detail-grid">
                {metric.detailRows.map((row) => (
                  <div key={`${metric.key}-${row.label}`} className="toolbar-metric-detail-row">
                    <span>{row.label}</span>
                    <strong>{row.value}</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
        <div className="server-network-card">
          <div className={`toolbar-network-item ${networkRxTone}`}>
            <span className="toolbar-network-arrow" aria-hidden="true">
              ↓
            </span>
            <div className="toolbar-network-copy">
              <strong>{networkRxLabel}</strong>
              <span>下行</span>
            </div>
          </div>
          <div className={`toolbar-network-item ${networkTxTone}`}>
            <span className="toolbar-network-arrow" aria-hidden="true">
              ↑
            </span>
            <div className="toolbar-network-copy">
              <strong>{networkTxLabel}</strong>
              <span>上行</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
