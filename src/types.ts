export interface ConnectRequest {
  name?: string;
  host: string;
  port: number;
  username: string;
  password: string;
  cols: number;
  rows: number;
}

export interface ConnectionSummary {
  id: string;
  name: string;
  host: string;
  protocol: string;
  status: string;
  latencyMs: number;
  osLabel: string;
  homePath: string;
}

export interface RemoteEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modifiedAt: number | null;
  permissions: number | null;
  canRead: boolean;
  canWrite: boolean;
  canEnter: boolean;
}

export interface FilePreview {
  path: string;
  kind: "Text" | "Image" | "Pdf" | "Binary" | string;
  language: string | null;
  content: string | null;
  readonly: boolean;
  size: number;
  previewBytes: number;
  truncated: boolean;
}

export interface ShellOverview {
  connection: ConnectionSummary | null;
  currentPath: string | null;
  favorites: string[];
  recentFiles: string[];
}

export interface RemoteSystemSnapshot {
  cpuPercent: number;
  cpuCoreCount: number;
  cpuModel: string;
  loadAverage: number[];
  uptimeSeconds: number;
  memoryTotalBytes: number;
  memoryAvailableBytes: number;
  memoryUsedBytes: number;
  memoryUsagePercent: number;
  rootTotalBytes: number;
  rootAvailableBytes: number;
  rootUsedBytes: number;
  rootUsagePercent: number;
  rootMountPath: string;
  rootFileSystemType: string;
  networkRxBytesPerSec: number;
  networkTxBytesPerSec: number;
  topProcesses: RemoteProcessStat[];
}

export interface RemoteProcessStat {
  command: string;
  cpuPercent: number;
  memoryPercent: number;
}

export interface SaveResponse {
  path: string;
  bytesWritten: number;
  message: string;
}

export interface UploadResponse {
  path: string;
  bytesWritten: number;
  message: string;
}

export interface DownloadResponse {
  remotePath: string;
  localPath: string;
  bytesWritten: number;
  message: string;
}

export interface FileActionResponse {
  path: string;
  message: string;
}

export interface AppUpdateInfo {
  currentVersion: string;
  available: boolean;
  version: string | null;
  notes: string | null;
  pubDate: string | null;
  target: string | null;
  downloadUrl: string | null;
  message: string;
}

export interface AppUpdateInstallResponse {
  version: string;
  message: string;
}

export interface AppUpdateFeedInfo {
  endpoint: string;
  version: string | null;
  pubDate: string | null;
  downloadUrl: string | null;
  message: string;
}

export interface AppUpdateProgress {
  stage: string;
  message: string;
  version: string | null;
  downloadedBytes: number | null;
  totalBytes: number | null;
  progressPercent: number | null;
}

export interface TerminalChunk {
  terminalId: string;
  data: string;
}

export interface TerminalStatus {
  terminalId: string;
  kind: string;
  message: string;
  connectionLost: boolean;
}

export interface TerminalSessionSummary {
  id: string;
  title: string;
}

export interface ConnectionProgress {
  stage: string;
  message: string;
  detail?: string | null;
  currentStep: number;
  totalSteps: number;
  isError: boolean;
}

export interface CommandHistoryItem {
  command: string;
  cwd: string;
  updatedAt: string;
  favorite: boolean;
}
