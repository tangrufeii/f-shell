import { useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import HostDetailPanel from "./HostDetailPanel";
import ServerMetricsPanel from "./ServerMetricsPanel";
import { isLikelyRuntimeDisconnectMessage } from "../lib/runtimeConnection";
import type { ConnectionSummary, RemoteSystemSnapshot } from "../types";

type HostRuntimeSectionProps = {
  connection: ConnectionSummary;
  connectionHostText: string;
  basicLatencyLabel: string;
  pollIntervalMs?: number;
  onConnectionIssue?: (message: string) => void;
  children: (content: { detailButton: ReactNode; metricsPanel: ReactNode }) => ReactNode;
};

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

function formatRuntimeDuration(seconds: number): string {
  if (!seconds || seconds < 0) {
    return "--";
  }

  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);

  if (days > 0) {
    return `${days} 天 ${hours} 小时`;
  }

  if (hours > 0) {
    return `${hours} 小时 ${minutes} 分`;
  }

  return `${Math.max(minutes, 1)} 分钟`;
}

function formatMetricPercent(value: number): string {
  if (Number.isNaN(value)) {
    return "--";
  }

  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)}%`;
}

export default function HostRuntimeSection({
  connection,
  connectionHostText,
  basicLatencyLabel,
  pollIntervalMs = 1000,
  onConnectionIssue,
  children
}: HostRuntimeSectionProps) {
  const [systemSnapshot, setSystemSnapshot] = useState<RemoteSystemSnapshot | null>(null);
  const [systemSnapshotError, setSystemSnapshotError] = useState("");
  const failedPollCountRef = useRef(0);
  const reportedConnectionIssueRef = useRef(false);
  const onConnectionIssueRef = useRef(onConnectionIssue);

  useEffect(() => {
    onConnectionIssueRef.current = onConnectionIssue;
  }, [onConnectionIssue]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    const poll = async () => {
      try {
        const snapshot = await invoke<RemoteSystemSnapshot>("get_remote_system_snapshot");
        if (cancelled) {
          return;
        }
        setSystemSnapshot(snapshot);
        setSystemSnapshotError("");
        failedPollCountRef.current = 0;
        reportedConnectionIssueRef.current = false;
      } catch (error) {
        if (cancelled) {
          return;
        }
        const message = String(error);
        console.error(error);
        setSystemSnapshotError(message);
        failedPollCountRef.current += 1;
        if (
          onConnectionIssueRef.current &&
          !reportedConnectionIssueRef.current &&
          failedPollCountRef.current >= 2 &&
          isLikelyRuntimeDisconnectMessage(message)
        ) {
          reportedConnectionIssueRef.current = true;
          onConnectionIssueRef.current(message);
        }
      } finally {
        if (!cancelled) {
          timer = window.setTimeout(() => {
            void poll();
          }, pollIntervalMs);
        }
      }
    };

    void poll();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [connection.id, pollIntervalMs]);

  const cpuUsageLabel = systemSnapshot ? formatMetricPercent(systemSnapshot.cpuPercent) : "--";
  const memoryUsageLabel = systemSnapshot
    ? `${formatBytes(systemSnapshot.memoryUsedBytes)} / ${formatBytes(systemSnapshot.memoryTotalBytes)}`
    : "--";
  const memoryUsagePercentLabel = systemSnapshot ? formatMetricPercent(systemSnapshot.memoryUsagePercent) : "--";
  const loadAverageLabel = systemSnapshot ? systemSnapshot.loadAverage.map((value) => value.toFixed(2)).join(" / ") : "--";
  const uptimeLabel = systemSnapshot ? formatRuntimeDuration(systemSnapshot.uptimeSeconds) : "--";
  const rootUsageLabel = systemSnapshot
    ? `${formatBytes(systemSnapshot.rootUsedBytes)} / ${formatBytes(systemSnapshot.rootTotalBytes)}`
    : "--";
  const rootUsagePercentLabel = systemSnapshot ? formatMetricPercent(systemSnapshot.rootUsagePercent) : "--";
  const networkRxLabel = systemSnapshot ? `${formatBytes(systemSnapshot.networkRxBytesPerSec)}/s` : "--";
  const networkTxLabel = systemSnapshot ? `${formatBytes(systemSnapshot.networkTxBytesPerSec)}/s` : "--";
  const cpuCoreLabel = systemSnapshot?.cpuCoreCount ? `${systemSnapshot.cpuCoreCount} 核心` : "--";
  const memoryTotalLabel = systemSnapshot ? formatBytes(systemSnapshot.memoryTotalBytes) : "--";
  const rootTotalLabel = systemSnapshot ? formatBytes(systemSnapshot.rootTotalBytes) : "--";
  const topProcessLabel = systemSnapshot?.topProcesses[0]
    ? `${systemSnapshot.topProcesses[0].command} · CPU ${systemSnapshot.topProcesses[0].cpuPercent.toFixed(1)}%`
    : "暂时没拿到高占用进程";

  return children({
    detailButton: (
      <div className="detail-hover sidebar-detail-hover">
        <button className="ghost-button small">主机详情</button>
        <HostDetailPanel
          connection={connection}
          connectionHostText={connectionHostText}
          basicLatencyLabel={basicLatencyLabel}
          systemSnapshotError={systemSnapshotError}
          memoryUsageLabel={memoryUsageLabel}
          rootUsageLabel={rootUsageLabel}
          cpuCoreLabel={cpuCoreLabel}
          memoryTotalLabel={memoryTotalLabel}
          rootTotalLabel={rootTotalLabel}
          loadAverageLabel={loadAverageLabel}
          uptimeLabel={uptimeLabel}
          topProcessLabel={topProcessLabel}
        />
      </div>
    ),
    metricsPanel: (
      <ServerMetricsPanel
        systemSnapshot={systemSnapshot}
        cpuUsageLabel={cpuUsageLabel}
        memoryUsageLabel={memoryUsageLabel}
        memoryUsagePercentLabel={memoryUsagePercentLabel}
        loadAverageLabel={loadAverageLabel}
        rootUsageLabel={rootUsageLabel}
        rootUsagePercentLabel={rootUsagePercentLabel}
        networkRxLabel={networkRxLabel}
        networkTxLabel={networkTxLabel}
      />
    )
  });
}
