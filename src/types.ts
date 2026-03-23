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
}

export interface ShellOverview {
  connection: ConnectionSummary | null;
  currentPath: string | null;
  favorites: string[];
  recentFiles: string[];
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

export interface TerminalChunk {
  data: string;
}

export interface TerminalStatus {
  kind: string;
  message: string;
}
