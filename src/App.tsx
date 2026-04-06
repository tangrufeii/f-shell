import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent
} from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { editor as MonacoEditor } from "monaco-editor";
import {
  buildConnectionProfile,
  initialConnectionForm,
  persistActiveProfileId,
  persistConnectionDraft,
  persistConnectionProfiles,
  profileMatchesForm,
  readStoredActiveProfileId,
  readStoredConnectionProfiles,
  resolveInitialConnectForm,
  sortConnectionProfiles,
  toFormFromProfile,
  upsertConnectionProfile,
  type ConnectionForm,
  type ConnectionProfile
} from "./lib/connectionProfiles";
import PreviewWorkspace, { PreviewWorkspaceActions } from "./components/PreviewWorkspace";
import FileActionDialog from "./components/FileActionDialog";
import AboutUpdateDialog from "./components/AboutUpdateDialog";
import ConnectDialog from "./components/ConnectDialog";
import RemoteFileTree from "./components/RemoteFileTree";
import TerminalToolbar from "./components/TerminalToolbar";
import TopToolbar from "./components/TopToolbar";
import TreeContextMenu from "./components/TreeContextMenu";
import type {
  AppUpdateFeedInfo,
  AppUpdateInfo,
  AppUpdateInstallResponse,
  AppUpdateProgress,
  CommandHistoryItem,
  ConnectionProgress,
  ConnectionSummary,
  DownloadResponse,
  FileActionResponse,
  FilePreview,
  RemoteEntry,
  SaveResponse,
  ShellOverview,
  TerminalChunk,
  TerminalStatus,
  UploadResponse
} from "./types";

type EntryMap = Record<string, RemoteEntry[]>;
type ResizeDirection = "East" | "North" | "NorthEast" | "NorthWest" | "South" | "SouthEast" | "SouthWest" | "West";
type TerminalSearchMatch = { row: number; col: number; length: number };
type TextSearchMatch = { start: number; end: number };
type ConnectFieldErrors = Partial<Record<keyof ConnectionForm, string>>;
type FileActionMode = "new-file" | "new-directory" | "rename" | "delete";
type FileActionErrors = {
  name?: string;
};
type TreeContextMenuState = {
  x: number;
  y: number;
  entry: RemoteEntry | null;
  targetDir: string;
  targetLabel: string;
};
type FileActionDialogState = {
  mode: FileActionMode;
  targetDir: string;
  entry: RemoteEntry | null;
  name: string;
  errors: FileActionErrors;
  busy: boolean;
  dangerText: string;
};
type UpdateNoticeKind = "available" | "progress" | "latest" | "error";
type UpdateNoticeTone = "info" | "success" | "warning" | "error";
type UpdateNoticeState = {
  kind: UpdateNoticeKind;
  tone: UpdateNoticeTone;
  title: string;
  message: string;
  detail?: string;
  version?: string | null;
  sticky?: boolean;
};
type UpdatePreferences = {
  autoCheckOnStartup: boolean;
  showAvailableNoticeOnStartup: boolean;
};
type UpdateCheckRecord = {
  checkedAt: string;
  outcome: "available" | "latest" | "error";
  version?: string | null;
  message: string;
};
type SaveFeedbackState = {
  tone: "success" | "error";
  message: string;
};
type EntryAccessState = "writable" | "readonly" | "blocked";
type ConnectIssueState = {
  title: string;
  summary: string;
  tips: string[];
  rawMessage: string;
};

const COMMAND_HISTORY_STORAGE_KEY = "fshell-command-history";
const SIDEBAR_WIDTH_STORAGE_KEY = "fshell-sidebar-width";
const UPDATE_DISMISSED_VERSION_STORAGE_KEY = "fshell-update-dismissed-version";
const UPDATE_PREFERENCES_STORAGE_KEY = "fshell-update-preferences";
const UPDATE_LAST_CHECK_STORAGE_KEY = "fshell-update-last-check";
const COMMAND_HISTORY_LIMIT = 40;
const DEFAULT_SIDEBAR_WIDTH = 460;
const MIN_SIDEBAR_WIDTH = 360;
const MAX_SIDEBAR_WIDTH = 760;
const NARROW_LAYOUT_BREAKPOINT = 1320;
const GITHUB_RELEASES_PAGE_URL = "https://github.com/tangrufeii/f-shell/releases";
const GITHUB_LATEST_JSON_URL = `${GITHUB_RELEASES_PAGE_URL}/latest/download/latest.json`;
const WINDOW_RESIZE_DIRECTIONS: ResizeDirection[] = [
  "North",
  "South",
  "East",
  "West",
  "NorthEast",
  "NorthWest",
  "SouthEast",
  "SouthWest"
];

const defaultUpdatePreferences: UpdatePreferences = {
  autoCheckOnStartup: true,
  showAvailableNoticeOnStartup: true
};

function clampSidebarWidth(width: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)));
}

function readStoredSidebarWidth(): number {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_SIDEBAR_WIDTH;
    }

    const value = Number(raw);
    return Number.isFinite(value) ? clampSidebarWidth(value) : DEFAULT_SIDEBAR_WIDTH;
  } catch (error) {
    console.error(error);
    return DEFAULT_SIDEBAR_WIDTH;
  }
}

function resolveEditorLanguage(language: string | null | undefined): string {
  switch (language) {
    case "typescript":
    case "javascript":
    case "html":
    case "css":
    case "xml":
    case "json":
    case "yaml":
    case "markdown":
    case "rust":
    case "shell":
      return language;
    case "toml":
      return "ini";
    case "dotenv":
      return "shell";
    default:
      return "plaintext";
  }
}

function parentRemotePath(path: string): string {
  const segments = path.split("/").filter(Boolean);
  if (segments.length <= 1) {
    return "/";
  }

  return `/${segments.slice(0, -1).join("/")}`;
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

function formatModifiedAt(timestamp: number | null): string {
  if (!timestamp) {
    return "时间未知";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp * 1000));
}

function formatUpdatePubDate(value: string | null): string {
  if (!value) {
    return "时间未知";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(parsed);
}

function formatUpdateCheckTime(value: string | null | undefined): string {
  if (!value) {
    return "尚未检查";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(parsed);
}

function formatUpdateDuration(durationMs: number | null): string {
  if (!durationMs || durationMs <= 0) {
    return "--";
  }

  if (durationMs < 1000) {
    return `${Math.round(durationMs)} ms`;
  }

  return `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)} s`;
}

function clampPercent(value: number | null | undefined): number {
  if (value == null || Number.isNaN(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, value));
}

function isUpdateProgressStageActive(stage: string | null | undefined): boolean {
  return stage === "preparing" || stage === "downloading" || stage === "installing" || stage === "completed";
}

function readStoredUpdatePreferences(): UpdatePreferences {
  try {
    const raw = window.localStorage.getItem(UPDATE_PREFERENCES_STORAGE_KEY);
    if (!raw) {
      return defaultUpdatePreferences;
    }

    const parsed = JSON.parse(raw) as Partial<UpdatePreferences>;
    return {
      autoCheckOnStartup: parsed.autoCheckOnStartup ?? defaultUpdatePreferences.autoCheckOnStartup,
      showAvailableNoticeOnStartup:
        parsed.showAvailableNoticeOnStartup ?? defaultUpdatePreferences.showAvailableNoticeOnStartup
    };
  } catch (error) {
    console.error(error);
    return defaultUpdatePreferences;
  }
}

function readStoredUpdateCheckRecord(): UpdateCheckRecord | null {
  try {
    const raw = window.localStorage.getItem(UPDATE_LAST_CHECK_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as UpdateCheckRecord;
    if (!parsed.checkedAt || !parsed.outcome || !parsed.message) {
      return null;
    }

    return parsed;
  } catch (error) {
    console.error(error);
    return null;
  }
}

function releaseNotesToList(notes: string | null | undefined): string[] {
  if (!notes) {
    return [];
  }

  return notes
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s*/, ""))
    .filter(Boolean);
}

function formatPermissions(permissions: number | null): string {
  if (permissions == null) {
    return "----";
  }

  return permissions.toString(8).slice(-4);
}

function canOpenDirectory(entry: RemoteEntry): boolean {
  return entry.canRead && entry.canEnter;
}

function canPreviewEntry(entry: RemoteEntry): boolean {
  return entry.canRead;
}

function getEntryAccessState(entry: RemoteEntry): EntryAccessState {
  if (entry.isDir) {
    if (!entry.canRead || !entry.canEnter) {
      return "blocked";
    }

    return entry.canWrite ? "writable" : "readonly";
  }

  if (!entry.canRead) {
    return "blocked";
  }

  return entry.canWrite ? "writable" : "readonly";
}

function entryAccessLabel(entry: RemoteEntry): string {
  if (entry.isDir) {
    if (!entry.canRead && !entry.canEnter) {
      return "不可读取/进入";
    }
    if (!entry.canRead) {
      return "不可读取";
    }
    if (!entry.canEnter) {
      return "不可进入";
    }
    return entry.canWrite ? "可读写" : "只读目录";
  }

  if (!canPreviewEntry(entry)) {
    return "不可读取";
  }

  return entry.canWrite ? "可读写" : "只读文件";
}

function entryAccessBadgeLabel(entry: RemoteEntry): string {
  const state = getEntryAccessState(entry);
  if (state === "blocked") {
    return entry.isDir ? "受限" : "不可读";
  }

  return state === "readonly" ? "只读" : "可写";
}

function entryAccessHint(entry: RemoteEntry): string {
  if (entry.isDir) {
    if (!entry.canRead && !entry.canEnter) {
      return "当前账号既不能读取目录内容，也不能进入该目录。";
    }
    if (!entry.canRead) {
      return "当前账号不能读取这个目录下的内容。";
    }
    if (!entry.canEnter) {
      return "当前账号不能进入该目录。";
    }
    if (!entry.canWrite) {
      return "当前账号可以浏览目录，但没有写入权限。";
    }
    return "当前账号可以进入、读取并写入这个目录。";
  }

  if (!entry.canRead) {
    return "当前账号不能读取这个文件。";
  }

  if (!entry.canWrite) {
    return "当前账号可以查看这个文件，但不能覆盖保存。";
  }

  return "当前账号可以读取并修改这个文件。";
}

function resolveUploadTargetDir(entry: RemoteEntry | null, fallbackPath: string): string {
  if (!entry) {
    return fallbackPath || "/";
  }

  return entry.isDir ? entry.path : parentRemotePath(entry.path);
}

function canUploadToEntry(entry: RemoteEntry | null): boolean {
  if (!entry) {
    return true;
  }

  return entry.isDir ? entry.canEnter : true;
}

function canDownloadEntry(entry: RemoteEntry | null, targetDir: string): boolean {
  if (entry) {
    return entry.isDir ? canOpenDirectory(entry) : canPreviewEntry(entry);
  }

  return Boolean(targetDir);
}

function canManageEntry(entry: RemoteEntry | null): boolean {
  return Boolean(entry);
}

function remotePathBaseName(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? "root";
}

function resolveDownloadTarget(entry: RemoteEntry | null, targetDir: string) {
  if (entry) {
    return {
      remotePath: entry.path,
      suggestedName: entry.name || remotePathBaseName(entry.path),
      isDir: entry.isDir
    };
  }

  return {
    remotePath: targetDir,
    suggestedName: remotePathBaseName(targetDir),
    isDir: true
  };
}

function summarizeConnectError(rawMessage: string, form: ConnectionForm): ConnectIssueState {
  const message = rawMessage.trim();
  const lower = message.toLowerCase();
  const host = form.host.trim() || "目标主机";
  const port = form.port.trim() || "22";
  const username = form.username.trim() || "当前用户";

  const rawLine = message.includes("原始错误：") ? message : `原始信息：${message}`;

  if (message.includes("解析主机") || message.includes("没解析出可用地址")) {
    return {
      title: "主机地址解析失败",
      summary: `系统没法把 ${host} 解析成可连接地址，当前连 TCP 都还没开始。`,
      tips: ["检查主机名是不是写错了", "如果是内网机器，确认 DNS / hosts / VPN 已经生效", "也可以直接改填 IP 再试一次"],
      rawMessage: rawLine
    };
  }

  if (message.includes("被拒绝")) {
    return {
      title: "端口能到，但 SSH 服务没接住",
      summary: `${host}:${port} 已经有响应，但服务端直接拒绝了这次 TCP 连接。`,
      tips: ["检查端口是不是填错了", "确认服务器 SSH 服务已启动", "如果机器在线但端口不对，换成真实 SSH 端口再试"],
      rawMessage: rawLine
    };
  }

  if (message.includes("TCP 连接") && message.includes("超时")) {
    return {
      title: "TCP 连接超时",
      summary: `客户端在限定时间内没连上 ${host}:${port}，通常是网络、防火墙或目标主机不可达。`,
      tips: ["先 ping 或 telnet 目标主机和端口", "检查安全组、防火墙、端口映射", "如果是公司网络，确认代理 / VPN 没拦住这条链路"],
      rawMessage: rawLine
    };
  }

  if (message.includes("banner") || message.includes("不是 SSH")) {
    return {
      title: "目标端口不像 SSH",
      summary: `${host}:${port} 有服务在响应，但它返回的协议内容不像 SSH。`,
      tips: ["确认端口不是 HTTP、数据库或别的服务", "检查服务器 SSH 监听端口", "如果走了跳板或反代，确认链路没配错"],
      rawMessage: rawLine
    };
  }

  if (message.includes("SSH 握手") && (message.includes("超时") || lower.includes("timeout"))) {
    return {
      title: "SSH 握手超时",
      summary: `TCP 已经接通，但 SSH 协议握手没在时限内完成，服务端或链路状态不太对劲。`,
      tips: ["稍后重试，排除服务端瞬时负载过高", "检查是否有安全设备在拦截 SSH 握手", "确认目标主机不是卡在登录前脚本或速率限制"],
      rawMessage: rawLine
    };
  }

  if (message.includes("账号或密码不对") || lower.includes("authentication failed")) {
    return {
      title: "账号或密码不对",
      summary: `SSH 服务已经通了，但用户 ${username} 的认证没通过。`,
      tips: ["重新确认用户名和密码大小写", "检查该账号是否被禁用或锁定", "如果服务器禁止密码登录，就得换成它允许的登录方式"],
      rawMessage: rawLine
    };
  }

  if (message.includes("鉴权超时")) {
    return {
      title: "登录认证超时",
      summary: `用户 ${username} 的认证请求没能在限定时间内完成，通常是网络慢或服务端负载高。`,
      tips: ["先重试一次，排除临时抖动", "检查服务端是否有 MFA / PAM / 安全策略拖慢登录", "如果跨境或跨地域连接，先确认网络链路质量"],
      rawMessage: rawLine
    };
  }

  if (message.includes("SSH 鉴权失败")) {
    return {
      title: "SSH 认证没通过",
      summary: `目标主机拒绝了用户 ${username} 的登录请求。`,
      tips: ["先确认用户名和密码", "检查账号是否允许 SSH 登录", "如果服务端限制了认证方式，需要改成服务端支持的方案"],
      rawMessage: rawLine
    };
  }

  return {
    title: "连接失败",
    summary: "连接链路某一步挂了，但不是最常见那几类错误。先看下面原始信息，再按网络、端口、认证顺序排查。",
    tips: ["先确认主机和端口", "再确认账号密码", "最后检查目标机器 SSH 服务和网络策略"],
    rawMessage: rawLine
  };
}

function isImagePreviewPath(path: string): boolean {
  return /\.(png|jpe?g|gif|bmp|svg|webp)$/i.test(path);
}

function extensionFromMime(type: string): string {
  if (type === "image/png") {
    return "png";
  }
  if (type === "image/jpeg") {
    return "jpg";
  }
  if (type === "image/gif") {
    return "gif";
  }
  if (type === "image/bmp") {
    return "bmp";
  }
  if (type === "image/svg+xml") {
    return "svg";
  }
  if (type === "image/webp") {
    return "webp";
  }

  return "bin";
}

function buildClipboardFileName(file: File, index: number): string {
  if (file.name.trim()) {
    return file.name.trim();
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `clipboard-${stamp}-${index + 1}.${extensionFromMime(file.type)}`;
}

function shellEscapePath(path: string): string {
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

function buildCdCommand(path: string): string {
  if (path === "/") {
    return "cd /\r";
  }

  if (/^[A-Za-z0-9_./-]+$/.test(path) && !path.startsWith("-")) {
    return `cd ${path}\r`;
  }

  return `cd ${shellEscapePath(path)}\r`;
}

function transferHasFiles(data: DataTransfer | null): boolean {
  if (!data) {
    return false;
  }

  return (
    data.files.length > 0 ||
    Array.from(data.items).some((item) => item.kind === "file") ||
    Array.from(data.types).includes("Files")
  );
}

function extractTransferFiles(data: DataTransfer | null): File[] {
  if (!data) {
    return [];
  }

  if (data.files.length > 0) {
    return Array.from(data.files);
  }

  return Array.from(data.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
}

function readFileAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("本地文件读取结果异常，请重试。"));
        return;
      }

      const [, base64 = ""] = reader.result.split(",", 2);
      if (!base64) {
        reject(new Error("本地文件编码失败，未读取到有效数据。"));
        return;
      }

      resolve(base64);
    };

    reader.onerror = () => {
      reject(reader.error ?? new Error("本地文件读取失败。"));
    };

    reader.readAsDataURL(file);
  });
}

function isTextEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function isTerminalInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(target.closest(".terminal-host, .xterm"));
}

function isWindowDragBlockedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    target.closest(
      "button, input, textarea, select, a, .detail-card, .history-menu, .tree-context-menu, .terminal-host, .xterm"
    )
  );
}

function sanitizeCommandHistoryItem(value: unknown): CommandHistoryItem | null {
  if (typeof value === "string") {
    const command = value.trim();
    if (!command) {
      return null;
    }

    return {
      command,
      cwd: "/",
      updatedAt: ""
    };
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<CommandHistoryItem>;
  if (typeof candidate.command !== "string") {
    return null;
  }

  const command = candidate.command.trim();
  if (!command) {
    return null;
  }

  return {
    command,
    cwd: typeof candidate.cwd === "string" && candidate.cwd.trim() ? candidate.cwd.trim() : "/",
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : ""
  };
}

function sortCommandHistory(history: CommandHistoryItem[]): CommandHistoryItem[] {
  return [...history].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function readStoredHistory(): CommandHistoryItem[] {
  try {
    const raw = window.localStorage.getItem(COMMAND_HISTORY_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return sortCommandHistory(
      parsed
        .map((item) => sanitizeCommandHistoryItem(item))
        .filter((item): item is CommandHistoryItem => Boolean(item))
    ).slice(0, COMMAND_HISTORY_LIMIT);
  } catch (error) {
    console.error(error);
    return [];
  }
}

function readDismissedUpdateVersion(): string {
  try {
    return window.localStorage.getItem(UPDATE_DISMISSED_VERSION_STORAGE_KEY) ?? "";
  } catch (error) {
    console.error(error);
    return "";
  }
}

function pushCommandHistory(history: CommandHistoryItem[], command: string, cwd: string): CommandHistoryItem[] {
  const normalized = command.trim();
  if (!normalized) {
    return history;
  }

  const normalizedCwd = cwd.trim() || "/";
  const nextItem: CommandHistoryItem = {
    command: normalized,
    cwd: normalizedCwd,
    updatedAt: new Date().toISOString()
  };

  return sortCommandHistory(
    [nextItem, ...history.filter((item) => !(item.command === normalized && item.cwd === normalizedCwd))]
  ).slice(0, COMMAND_HISTORY_LIMIT);
}

function collectTextMatches(content: string, query: string): TextSearchMatch[] {
  if (!query) {
    return [];
  }

  const source = content.toLocaleLowerCase();
  const target = query.toLocaleLowerCase();
  const matches: TextSearchMatch[] = [];
  let startIndex = 0;

  while (startIndex < source.length) {
    const index = source.indexOf(target, startIndex);
    if (index === -1) {
      break;
    }

    matches.push({
      start: index,
      end: index + query.length
    });
    startIndex = index + Math.max(query.length, 1);
  }

  return matches;
}

function collectTerminalMatches(terminal: Terminal | null, query: string): TerminalSearchMatch[] {
  if (!terminal || !query) {
    return [];
  }

  const buffer = terminal.buffer.active;
  const target = query.toLocaleLowerCase();
  const matches: TerminalSearchMatch[] = [];

  for (let row = 0; row < buffer.length; row += 1) {
    const text = buffer.getLine(row)?.translateToString(true) ?? "";
    if (!text) {
      continue;
    }

    const source = text.toLocaleLowerCase();
    let startIndex = 0;

    while (startIndex < source.length) {
      const index = source.indexOf(target, startIndex);
      if (index === -1) {
        break;
      }

      matches.push({
        row,
        col: index,
        length: query.length
      });
      startIndex = index + Math.max(query.length, 1);
    }
  }

  return matches;
}

function extractCommandFromPromptLine(line: string): string | null {
  const promptPatterns = [
    /^[^\r\n]*@[^:\r\n]+:[^\r\n]*[#$]\s?(.*)$/,
    /^[^\r\n]*\[[^\]]+@[^\]]+\][#$]\s?(.*)$/,
    /^[^\r\n]*[#$]\s?(.*)$/
  ];

  for (const pattern of promptPatterns) {
    const matched = line.match(pattern);
    if (matched) {
      return matched[1] ?? "";
    }
  }

  return null;
}

function isReasonableCommandText(command: string): boolean {
  if (!command) {
    return true;
  }

  if (command.length > 240) {
    return false;
  }

  return /^[\x20-\x7e\u4e00-\u9fff]*$/.test(command);
}

function validateConnectForm(form: ConnectionForm): ConnectFieldErrors {
  const errors: ConnectFieldErrors = {};
  const host = form.host.trim();
  const username = form.username.trim();
  const password = form.password;
  const portText = form.port.trim();
  const port = Number(portText);

  if (!host) {
    errors.host = "主机地址不能为空。";
  } else if (/\s/.test(host)) {
    errors.host = "主机地址不能包含空格。";
  }

  if (!portText) {
    errors.port = "端口不能为空。";
  } else if (!/^\d+$/.test(portText)) {
    errors.port = "端口必须是数字。";
  } else if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.port = "端口范围必须在 1 到 65535。";
  }

  if (!username) {
    errors.username = "用户名不能为空。";
  } else if (/\s/.test(username)) {
    errors.username = "用户名不能包含空格。";
  }

  if (!password) {
    errors.password = "密码不能为空。";
  }

  return errors;
}

function validateFileActionName(name: string): FileActionErrors {
  const trimmed = name.trim();
  const errors: FileActionErrors = {};

  if (!trimmed) {
    errors.name = "名称不能为空。";
  } else if (trimmed === "." || trimmed === "..") {
    errors.name = "名称不能是 `.` 或 `..`。";
  } else if (/[\\/]/.test(trimmed)) {
    errors.name = "名称里不能带 `/` 或 `\\`。";
  }

  return errors;
}

function fileActionTitle(mode: FileActionMode): string {
  if (mode === "new-file") {
    return "新建文件";
  }
  if (mode === "new-directory") {
    return "新建目录";
  }
  if (mode === "rename") {
    return "重命名";
  }
  return "删除确认";
}

function fileActionConfirmLabel(mode: FileActionMode, busy: boolean): string {
  if (busy) {
    return "处理中...";
  }
  if (mode === "new-file") {
    return "创建文件";
  }
  if (mode === "new-directory") {
    return "创建目录";
  }
  if (mode === "rename") {
    return "确认重命名";
  }
  return "确认删除";
}

function formatConnectionStage(stage: string | null | undefined): string {
  switch (stage) {
    case "pending":
      return "准备连接";
    case "tcp":
      return "TCP 连接";
    case "handshake":
      return "SSH 握手";
    case "auth":
      return "身份验证";
    case "prepare":
      return "初始化远端";
    case "terminal":
      return "启动终端";
    case "ready":
      return "连接完成";
    case "error":
      return "连接失败";
    default:
      return "等待连接";
  }
}

function BrandLogo({ className = "" }: { className?: string }) {
  return (
    <div className={`brand-mark brand-logo ${className}`.trim()} aria-hidden="true">
      <svg viewBox="0 0 96 96" role="presentation" focusable="false">
        <defs>
          <linearGradient id="brand-shell-bg" x1="16" y1="12" x2="82" y2="84" gradientUnits="userSpaceOnUse">
            <stop stopColor="#1C2756" />
            <stop offset="0.58" stopColor="#2B225A" />
            <stop offset="1" stopColor="#171233" />
          </linearGradient>
          <linearGradient id="brand-shell-frame" x1="18" y1="14" x2="78" y2="80" gradientUnits="userSpaceOnUse">
            <stop stopColor="rgba(152,248,255,0.95)" />
            <stop offset="1" stopColor="rgba(255,186,122,0.92)" />
          </linearGradient>
          <linearGradient id="brand-shell-pane" x1="26" y1="24" x2="70" y2="70" gradientUnits="userSpaceOnUse">
            <stop stopColor="#253674" />
            <stop offset="1" stopColor="#1A1742" />
          </linearGradient>
          <linearGradient id="brand-shell-accent" x1="40" y1="38" x2="66" y2="66" gradientUnits="userSpaceOnUse">
            <stop stopColor="#7AF5FF" />
            <stop offset="1" stopColor="#FFB669" />
          </linearGradient>
        </defs>

        <rect x="10" y="10" width="76" height="76" rx="22" fill="url(#brand-shell-bg)" />
        <rect x="12" y="12" width="72" height="72" rx="20" stroke="url(#brand-shell-frame)" strokeWidth="2.4" />
        <rect x="20" y="22" width="56" height="50" rx="13" fill="url(#brand-shell-pane)" />

        <rect x="24" y="26" width="48" height="6" rx="3" fill="rgba(255,255,255,0.12)" />
        <circle cx="30" cy="29" r="1.4" fill="#7EF6FF" />
        <circle cx="35" cy="29" r="1.4" fill="#9FB2FF" />
        <circle cx="40" cy="29" r="1.4" fill="#FFC07F" />

        <rect x="26" y="37" width="9" height="24" rx="4.5" fill="rgba(255,255,255,0.08)" />
        <rect x="28.5" y="42" width="4" height="1.8" rx="0.9" fill="#8BDFFF" />
        <rect x="28.5" y="47" width="4" height="1.8" rx="0.9" fill="rgba(255,255,255,0.55)" />
        <rect x="28.5" y="52" width="4" height="1.8" rx="0.9" fill="rgba(255,255,255,0.36)" />

        <path
          d="M44 42.5L54 49.5L44 56.5"
          fill="none"
          stroke="url(#brand-shell-accent)"
          strokeWidth="4.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M58 60H66"
          fill="none"
          stroke="url(#brand-shell-accent)"
          strokeWidth="4.6"
          strokeLinecap="round"
        />
        <path
          d="M25 70C29.5 66.5 35.6 64.8 42 64.8H73C74.7 64.8 76 66.1 76 67.8V69.8C76 71.5 74.7 72.8 73 72.8H43.5C37.8 72.8 32.7 75.2 29 79.6L25 70Z"
          fill="#FFB46B"
          fillOpacity="0.95"
        />
      </svg>
    </div>
  );
}

function App() {
  const appWindowRef = useRef(getCurrentWindow());
  const [form, setForm] = useState<ConnectionForm>(() => resolveInitialConnectForm());
  const [connectionProfiles, setConnectionProfiles] = useState<ConnectionProfile[]>(() => readStoredConnectionProfiles());
  const [activeProfileId, setActiveProfileId] = useState(() => readStoredActiveProfileId());
  const [profileSearchQuery, setProfileSearchQuery] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(() => readStoredSidebarWidth());
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const [overview, setOverview] = useState<ShellOverview | null>(null);
  const [connection, setConnection] = useState<ConnectionSummary | null>(null);
  const [currentPath, setCurrentPath] = useState("");
  const [entriesByPath, setEntriesByPath] = useState<EntryMap>({});
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [editorContent, setEditorContent] = useState("");
  const [selectedEntry, setSelectedEntry] = useState<RemoteEntry | null>(null);
  const [statusLine, setStatusLine] = useState("等待连接");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isListing, setIsListing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [dragTargetPath, setDragTargetPath] = useState("");
  const [activeWorkspace, setActiveWorkspace] = useState<"terminal" | "preview">("terminal");
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [isAboutDialogOpen, setIsAboutDialogOpen] = useState(false);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [isWindowFullscreen, setIsWindowFullscreen] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [updateFeedInfo, setUpdateFeedInfo] = useState<AppUpdateFeedInfo | null>(null);
  const [updateProgress, setUpdateProgress] = useState<AppUpdateProgress | null>(null);
  const [updateNotice, setUpdateNotice] = useState<UpdateNoticeState | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);
  const [updateCheckDurationMs, setUpdateCheckDurationMs] = useState<number | null>(null);
  const [updatePreferences, setUpdatePreferences] = useState<UpdatePreferences>(() => readStoredUpdatePreferences());
  const [lastUpdateCheck, setLastUpdateCheck] = useState<UpdateCheckRecord | null>(() => readStoredUpdateCheckRecord());
  const [connectError, setConnectError] = useState("");
  const [connectionProgress, setConnectionProgress] = useState<ConnectionProgress | null>(null);
  const [connectFieldErrors, setConnectFieldErrors] = useState<ConnectFieldErrors>({});
  const [saveFeedback, setSaveFeedback] = useState<SaveFeedbackState | null>(null);
  const [treeContextMenu, setTreeContextMenu] = useState<TreeContextMenuState | null>(null);
  const [fileActionDialog, setFileActionDialog] = useState<FileActionDialogState | null>(null);
  const [commandHistory, setCommandHistory] = useState<CommandHistoryItem[]>(() => readStoredHistory());
  const [historySelection, setHistorySelection] = useState("");
  const [commandDraft, setCommandDraft] = useState("");
  const [isHistoryMenuOpen, setIsHistoryMenuOpen] = useState(false);
  const [isSavedProfilesMenuOpen, setIsSavedProfilesMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResultCount, setSearchResultCount] = useState(0);
  const [searchActiveIndex, setSearchActiveIndex] = useState(0);
  const [terminalContentVersion, setTerminalContentVersion] = useState(0);
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const hasConnectionRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const historyMenuRef = useRef<HTMLDivElement | null>(null);
  const savedProfilesMenuRef = useRef<HTMLDivElement | null>(null);
  const treeContextMenuRef = useRef<HTMLDivElement | null>(null);
  const fileActionInputRef = useRef<HTMLInputElement | null>(null);
  const sidebarResizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const currentInputBufferRef = useRef("");
  const terminalSearchMatchesRef = useRef<TerminalSearchMatch[]>([]);
  const previewSearchMatchesRef = useRef<TextSearchMatch[]>([]);
  const pendingTerminalDraftSyncRef = useRef(false);
  const hasAutoUpdateCheckRef = useRef(false);
  const isNarrowWorkbench = viewportWidth <= NARROW_LAYOUT_BREAKPOINT;

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    hasConnectionRef.current = Boolean(connection);
  }, [connection]);

  useEffect(() => {
    void (async () => {
      try {
        setIsWindowMaximized(await appWindowRef.current.isMaximized());
        setIsWindowFullscreen(await appWindowRef.current.isFullscreen());
      } catch (error) {
        console.error(error);
      }
    })();
  }, []);

  useEffect(() => {
    let unlistenResize: (() => void) | undefined;

    void (async () => {
      unlistenResize = await appWindowRef.current.onResized(async () => {
        try {
          setIsWindowMaximized(await appWindowRef.current.isMaximized());
          setIsWindowFullscreen(await appWindowRef.current.isFullscreen());
        } catch (error) {
          console.error(error);
        }
      });
    })();

    return () => {
      unlistenResize?.();
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(COMMAND_HISTORY_STORAGE_KEY, JSON.stringify(commandHistory));
    } catch (error) {
      console.error(error);
    }
  }, [commandHistory]);

  useEffect(() => {
    persistConnectionDraft(form);
  }, [form]);

  useEffect(() => {
    persistConnectionProfiles(connectionProfiles);
  }, [connectionProfiles]);

  useEffect(() => {
    persistActiveProfileId(activeProfileId);
  }, [activeProfileId]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
    } catch (error) {
      console.error(error);
    }
  }, [sidebarWidth]);

  useEffect(() => {
    const handleResize = () => {
      setViewportWidth(window.innerWidth);
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    if (!isSidebarResizing) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const resizeState = sidebarResizeStateRef.current;
      if (!resizeState) {
        return;
      }

      setSidebarWidth(clampSidebarWidth(resizeState.startWidth + event.clientX - resizeState.startX));
    };

    const stopSidebarResize = () => {
      sidebarResizeStateRef.current = null;
      setIsSidebarResizing(false);
      document.body.classList.remove("sidebar-resizing");
    };

    document.body.classList.add("sidebar-resizing");
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopSidebarResize);
    window.addEventListener("blur", stopSidebarResize);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopSidebarResize);
      window.removeEventListener("blur", stopSidebarResize);
      document.body.classList.remove("sidebar-resizing");
    };
  }, [isSidebarResizing]);

  useEffect(() => {
    if (!isNarrowWorkbench) {
      return;
    }

    sidebarResizeStateRef.current = null;
    setIsSidebarResizing(false);
    document.body.classList.remove("sidebar-resizing");
  }, [isNarrowWorkbench]);

  useEffect(() => {
    if (!saveFeedback) {
      return;
    }

    const timer = window.setTimeout(() => {
      setSaveFeedback((previous) => (previous === saveFeedback ? null : previous));
    }, 2600);

    return () => {
      window.clearTimeout(timer);
    };
  }, [saveFeedback]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (historyMenuRef.current && historyMenuRef.current.contains(event.target as Node)) {
        return;
      }

      if (savedProfilesMenuRef.current && savedProfilesMenuRef.current.contains(event.target as Node)) {
        return;
      }

      if (treeContextMenuRef.current && treeContextMenuRef.current.contains(event.target as Node)) {
        return;
      }

      setIsHistoryMenuOpen(false);
      setIsSavedProfilesMenuOpen(false);
      setTreeContextMenu(null);
    };

    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, []);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTreeContextMenu(null);
        setFileActionDialog(null);
        setIsAboutDialogOpen(false);
        setIsSavedProfilesMenuOpen(false);
        if (updateNotice?.kind !== "progress") {
          setUpdateNotice(null);
        }
      }
    };

    const closeMenu = () => {
      setTreeContextMenu(null);
    };

    window.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);

    return () => {
      window.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [updateNotice?.kind]);

  useEffect(() => {
    if (!isAboutDialogOpen || updateInfo || isCheckingUpdate) {
      return;
    }

    void checkAppUpdate({ reason: "manual", silentNoUpdate: true });
  }, [isAboutDialogOpen, isCheckingUpdate, updateInfo]);

  useEffect(() => {
    if (!isAboutDialogOpen) {
      return;
    }

    let cancelled = false;
    void invoke<AppUpdateFeedInfo>("inspect_update_feed", {
      endpoint: GITHUB_LATEST_JSON_URL
    })
      .then((result) => {
        if (!cancelled) {
          setUpdateFeedInfo(result);
        }
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) {
          setUpdateFeedInfo({
            endpoint: GITHUB_LATEST_JSON_URL,
            version: null,
            pubDate: null,
            downloadUrl: null,
            message: `更新源诊断失败: ${String(error)}`
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isAboutDialogOpen]);

  useEffect(() => {
    if (!updateNotice || updateNotice.sticky) {
      return;
    }

    const timer = window.setTimeout(() => {
      setUpdateNotice((previous) => (previous === updateNotice ? null : previous));
    }, 5200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [updateNotice]);

  useEffect(() => {
    try {
      window.localStorage.setItem(UPDATE_PREFERENCES_STORAGE_KEY, JSON.stringify(updatePreferences));
    } catch (error) {
      console.error(error);
    }
  }, [updatePreferences]);

  useEffect(() => {
    if (!lastUpdateCheck) {
      return;
    }

    try {
      window.localStorage.setItem(UPDATE_LAST_CHECK_STORAGE_KEY, JSON.stringify(lastUpdateCheck));
    } catch (error) {
      console.error(error);
    }
  }, [lastUpdateCheck]);

  useEffect(() => {
    let unlistenUpdateProgress: (() => void) | undefined;

    void listen<AppUpdateProgress>("update-progress", (event) => {
      const payload = event.payload;
      setUpdateProgress(payload);
      setStatusLine(payload.message);

      if (payload.stage === "downloading" || payload.stage === "installing" || payload.stage === "preparing") {
        setUpdateNotice({
          kind: "progress",
          tone: "info",
          title:
            payload.stage === "installing"
              ? `正在安装 ${payload.version ?? "更新"}`
              : payload.stage === "preparing"
                ? "正在准备更新"
                : `正在下载 ${payload.version ?? "更新"}`,
          message: payload.message,
          detail:
            payload.totalBytes && payload.downloadedBytes != null
              ? `${formatBytes(payload.downloadedBytes)} / ${formatBytes(payload.totalBytes)}`
              : "GitHub Releases 直连、代理和签名校验都会影响速度。",
          version: payload.version,
          sticky: true
        });
        return;
      }

      if (payload.stage === "completed") {
        setUpdateNotice({
          kind: "progress",
          tone: "success",
          title: `更新 ${payload.version ?? ""} 已安装`,
          message: payload.message,
          detail: "应用即将自动重启。",
          version: payload.version,
          sticky: true
        });
        return;
      }

      if (payload.stage === "idle") {
        setUpdateNotice({
          kind: "latest",
          tone: "success",
          title: "当前已经是最新版本",
          message: payload.message,
          detail: "本次没有检测到更高版本。",
          version: payload.version,
          sticky: false
        });
      }
    }).then((fn) => {
      unlistenUpdateProgress = fn;
    });

    return () => {
      unlistenUpdateProgress?.();
    };
  }, []);

  useEffect(() => {
    let unlistenConnectionProgress: (() => void) | undefined;

    void listen<ConnectionProgress>("connection-progress", (event) => {
      const payload = event.payload;
      setConnectionProgress(payload);
      setStatusLine(payload.detail || payload.message);
      if (payload.isError) {
        setConnectError(payload.detail || payload.message);
      } else if (payload.stage === "ready") {
        setConnectError("");
      }
    }).then((fn) => {
      unlistenConnectionProgress = fn;
    });

    return () => {
      unlistenConnectionProgress?.();
    };
  }, []);

  useEffect(() => {
    if (!appVersion || hasAutoUpdateCheckRef.current || !updatePreferences.autoCheckOnStartup) {
      return;
    }

    hasAutoUpdateCheckRef.current = true;
    const timer = window.setTimeout(() => {
      void checkAppUpdate({ reason: "startup", silentNoUpdate: true });
    }, 1100);

    return () => {
      window.clearTimeout(timer);
    };
  }, [appVersion, updatePreferences.autoCheckOnStartup]);

  useEffect(() => {
    if (activeWorkspace !== "terminal") {
      return;
    }

    const timer = window.setTimeout(() => {
      fitAddonRef.current?.fit();
      if (connection && terminalRef.current) {
        void invoke("resize_terminal", {
          cols: terminalRef.current.cols,
          rows: terminalRef.current.rows
        }).catch((error) => {
          console.error(error);
        });
        terminalRef.current.focus();
      }
    }, 60);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activeWorkspace, connection]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (
        event.key === "Tab" &&
        activeWorkspace === "terminal" &&
        connection &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !isTextEditableTarget(event.target) &&
        !isTerminalInputTarget(event.target)
      ) {
        event.preventDefault();
        setIsHistoryMenuOpen(false);
        void requestTabCompletion();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeWorkspace, connection]);

  useEffect(() => {
    if (!fileActionDialog || fileActionDialog.mode === "delete") {
      return;
    }

    const timer = window.setTimeout(() => {
      fileActionInputRef.current?.focus();
      fileActionInputRef.current?.select();
    }, 30);

    return () => {
      window.clearTimeout(timer);
    };
  }, [fileActionDialog]);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (!connection) {
        return;
      }

      const clipboardData = event.clipboardData;
      const files = extractTransferFiles(clipboardData);
      const text = clipboardData?.getData("text/plain") ?? "";
      const targetDir = currentPath || connection.homePath || "/";
      const terminalTarget = isTerminalInputTarget(event.target);

      if (!files.length) {
        if (terminalTarget && text) {
          event.preventDefault();
          void pasteTextToTerminal(text);
          return;
        }

        if (!text && !isTextEditableTarget(event.target)) {
          event.preventDefault();
          void uploadWindowsClipboardFiles(targetDir, { fillTerminalPaths: terminalTarget });
        }
        return;
      }

      event.preventDefault();
      void uploadFiles(files, targetDir, "剪贴板");
    };

    window.addEventListener("paste", handlePaste);
    return () => {
      window.removeEventListener("paste", handlePaste);
    };
  }, [connection, currentPath]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      terminalSearchMatchesRef.current = [];
      previewSearchMatchesRef.current = [];
      setSearchResultCount(0);
      setSearchActiveIndex(0);
      terminalRef.current?.clearSelection();
      return;
    }

    if (activeWorkspace === "terminal") {
      const matches = collectTerminalMatches(terminalRef.current, query);
      terminalSearchMatchesRef.current = matches;
      previewSearchMatchesRef.current = [];
      setSearchResultCount(matches.length);
      setSearchActiveIndex((previous) => (matches.length ? Math.min(previous, matches.length - 1) : 0));
      if (!matches.length) {
        terminalRef.current?.clearSelection();
      }
      return;
    }

    if (preview?.kind === "Text") {
      const matches = collectTextMatches(editorContent, query);
      previewSearchMatchesRef.current = matches;
      terminalSearchMatchesRef.current = [];
      terminalRef.current?.clearSelection();
      setSearchResultCount(matches.length);
      setSearchActiveIndex((previous) => (matches.length ? Math.min(previous, matches.length - 1) : 0));
      return;
    }

    terminalSearchMatchesRef.current = [];
    previewSearchMatchesRef.current = [];
    terminalRef.current?.clearSelection();
    setSearchResultCount(0);
    setSearchActiveIndex(0);
  }, [activeWorkspace, editorContent, preview?.kind, searchQuery, terminalContentVersion]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      return;
    }

    if (activeWorkspace === "terminal") {
      focusTerminalSearchMatch(searchActiveIndex);
      return;
    }

    if (preview?.kind === "Text") {
      focusPreviewSearchMatch(searchActiveIndex);
    }
  }, [activeWorkspace, preview?.kind, searchActiveIndex, searchQuery]);

  useEffect(() => {
    if (!terminalHostRef.current) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: '"SF Mono", "JetBrains Mono", Consolas, monospace',
      fontSize: 14,
      lineHeight: 1.1,
      theme: {
        background: "rgba(10, 18, 35, 0.02)",
        foreground: "#f7fbff",
        cursor: "#ffffff",
        selectionBackground: "rgba(255,255,255,0.18)"
      }
    });
    const fitAddon = new FitAddon();

    terminal.loadAddon(fitAddon);
    terminal.open(terminalHostRef.current);
    terminal.attachCustomKeyEventHandler((event) => {
      if (
        event.key === "Tab" &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        event.preventDefault();
      }

      return true;
    });
    fitAddon.fit();
    terminal.writeln("FShell Terminal Ready");
    terminal.writeln("连接成功后，这里会接到真实 SSH Shell。");

    const resizeTerminal = () => {
      fitAddon.fit();
      if (hasConnectionRef.current) {
        void invoke("resize_terminal", { cols: terminal.cols, rows: terminal.rows });
      }
    };

    const dataDisposable = terminal.onData((data) => {
      if (!hasConnectionRef.current) {
        return;
      }
      trackTerminalInput(data);
      void invoke("send_terminal_input", { data }).catch((error) => {
        console.error(error);
      });
    });

    let unlistenChunk: (() => void) | undefined;
    let unlistenStatus: (() => void) | undefined;

    void listen<TerminalChunk>("terminal-chunk", (event) => {
      terminal.write(event.payload.data);
      if (pendingTerminalDraftSyncRef.current) {
        syncDraftFromTerminalBuffer(terminal);
      }
      setTerminalContentVersion((previous) => previous + 1);
    }).then((fn) => {
      unlistenChunk = fn;
    });

    void listen<TerminalStatus>("terminal-status", (event) => {
      setStatusLine(event.payload.message);
      if (event.payload.kind === "closed") {
        setConnection(null);
        clearRemoteBrowserState();
      }
    }).then((fn) => {
      unlistenStatus = fn;
    });

    window.addEventListener("resize", resizeTerminal);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    return () => {
      dataDisposable.dispose();
      window.removeEventListener("resize", resizeTerminal);
      unlistenChunk?.();
      unlistenStatus?.();
      terminal.dispose();
    };
  }, []);

  async function bootstrap() {
    try {
      setAppVersion(await getVersion());
    } catch (error) {
      console.error(error);
    }

    const data = await invoke<ShellOverview>("get_shell_overview");
    setOverview(data);
    setConnection(data.connection);
    if (data.connection?.homePath) {
      setCurrentPath("/");
      setIsConnectModalOpen(false);
      await loadDirectory("/", { expand: false });
    } else {
      setIsConnectModalOpen(true);
    }
  }

  function updateConnectField<Key extends keyof ConnectionForm>(field: Key, value: ConnectionForm[Key]) {
    setForm((previous) => ({ ...previous, [field]: value }));
    setConnectError("");
    setConnectFieldErrors((previous) => ({ ...previous, [field]: undefined }));
  }

  function resolveCurrentProfileId() {
    if (activeProfileId) {
      return activeProfileId;
    }

    return connectionProfiles.find((item) => profileMatchesForm(item, form))?.id ?? "";
  }

  function saveCurrentConnectionProfile(options?: {
    silent?: boolean;
    formOverride?: ConnectionForm;
    profileIdOverride?: string;
  }) {
    const sourceForm = options?.formOverride ?? form;
    const errors = validateConnectForm(sourceForm);
    setConnectFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      if (!options?.silent) {
        setStatusLine("请先补全后再保存配置。");
      }
      return "";
    }

    const currentProfileId = options?.profileIdOverride ?? resolveCurrentProfileId();
    const existingProfile = connectionProfiles.find((item) => item.id === currentProfileId);
    const profile = {
      ...buildConnectionProfile(sourceForm, currentProfileId || undefined),
      pinned: existingProfile?.pinned ?? false,
      lastUsedAt: existingProfile?.lastUsedAt ?? null
    };
    setConnectionProfiles((previous) => upsertConnectionProfile(previous, profile));
    setActiveProfileId(profile.id);
    if (options?.formOverride) {
      setForm(toFormFromProfile(profile, sourceForm.password));
    }
    if (!options?.silent) {
      setStatusLine(`已保存配置：${profile.name}`);
    }
    return profile.id;
  }

  function applyConnectionProfile(profile: ConnectionProfile) {
    setForm(toFormFromProfile(profile));
    setActiveProfileId(profile.id);
    setConnectError("");
    setConnectFieldErrors({});
    setConnectionProgress(null);
    setStatusLine(`已载入配置：${profile.name}`);
  }

  function removeConnectionProfile(profileId: string) {
    const profile = connectionProfiles.find((item) => item.id === profileId);
    const remaining = connectionProfiles.filter((item) => item.id !== profileId);
    setConnectionProfiles(remaining);

    if (activeProfileId === profileId) {
      setActiveProfileId(remaining[0]?.id ?? "");
      if (remaining[0]) {
        setForm(toFormFromProfile(remaining[0]));
      }
    }

    setStatusLine(profile ? `已删除配置：${profile.name}` : "已删除配置。");
  }

  function markConnectionProfileUsed(profileId: string) {
    const usedAt = new Date().toISOString();
    setConnectionProfiles((previous) =>
      sortConnectionProfiles(
        previous.map((item) =>
          item.id === profileId
            ? {
                ...item,
                lastUsedAt: usedAt,
                updatedAt: usedAt
              }
            : item
        )
      )
    );
  }

  function toggleConnectionProfilePin(profileId: string) {
    setConnectionProfiles((previous) =>
      sortConnectionProfiles(
        previous.map((item) =>
          item.id === profileId
            ? {
                ...item,
                pinned: !item.pinned
              }
            : item
        )
      )
    );
  }

  async function connect(options?: { formOverride?: ConnectionForm; profileIdOverride?: string }) {
    const sourceForm = options?.formOverride ?? form;
    const errors = validateConnectForm(sourceForm);
    setConnectFieldErrors(errors);
    setConnectError("");

    if (Object.keys(errors).length > 0) {
      setStatusLine("请先修正连接信息。");
      return;
    }

    setConnectionProgress({
      stage: "pending",
      message: "正在提交连接请求...",
      detail: "马上开始建立 TCP 连接。",
      currentStep: 0,
      totalSteps: 5,
      isError: false
    });
    setIsConnecting(true);
    try {
      terminalRef.current?.clear();
      terminalRef.current?.writeln(`Connecting to ${sourceForm.username}@${sourceForm.host}:${sourceForm.port} ...`);

      const result = await invoke<ConnectionSummary>("connect_ssh", {
        request: {
          name: sourceForm.name.trim() || undefined,
          host: sourceForm.host.trim(),
          port: Number(sourceForm.port),
          username: sourceForm.username.trim(),
          password: sourceForm.password,
          cols: terminalRef.current?.cols ?? 120,
          rows: terminalRef.current?.rows ?? 32
        }
      });

      setConnection(result);
      setForm(sourceForm);
      clearRemoteBrowserState();
      currentInputBufferRef.current = "";
      setCommandDraft("");
      setHistorySelection("");
      setCurrentPath("/");
      setStatusLine(`已连接 ${result.host}`);
      setActiveWorkspace("terminal");
      setIsConnectModalOpen(false);
      setIsSavedProfilesMenuOpen(false);
      setConnectError("");
      setConnectFieldErrors({});
      const savedProfileId = saveCurrentConnectionProfile({
        silent: true,
        formOverride: sourceForm,
        profileIdOverride: options?.profileIdOverride
      });
      if (savedProfileId) {
        markConnectionProfileUsed(savedProfileId);
      }
      setConnectionProgress((previous) =>
        previous
          ? {
              ...previous,
              stage: "ready",
              message: `已连接到 ${result.host}`,
              detail: previous.detail || "连接链路已经准备好。",
              currentStep: previous.totalSteps || 5,
              isError: false
            }
          : previous
      );
      await loadDirectory("/");
      fitAddonRef.current?.fit();
      if (terminalRef.current) {
        await invoke("resize_terminal", {
          cols: terminalRef.current.cols,
          rows: terminalRef.current.rows
        });
        terminalRef.current.focus();
      }
      const refreshed = await invoke<ShellOverview>("get_shell_overview");
      setOverview(refreshed);
    } catch (error) {
      console.error(error);
      const message = String(error);
      setConnection(null);
      clearRemoteBrowserState();
      setStatusLine(message);
      setConnectError(message);
      setConnectionProgress((previous) => ({
        stage: "error",
        message: "SSH 连接失败",
        detail: previous?.detail && previous.detail !== message ? `${previous.detail}\n${message}` : message,
        currentStep: previous?.currentStep ?? 0,
        totalSteps: previous?.totalSteps ?? 5,
        isError: true
      }));
      terminalRef.current?.writeln(`\r\n[connect error] ${message}`);
      const refreshed = await invoke<ShellOverview>("get_shell_overview");
      setOverview(refreshed);
    } finally {
      setIsConnecting(false);
    }
  }

  async function connectWithProfile(profile: ConnectionProfile) {
    await connect({
      formOverride: toFormFromProfile(profile),
      profileIdOverride: profile.id
    });
  }

  async function disconnect() {
    await invoke("disconnect_ssh");
    setConnection(null);
    setConnectionProgress(null);
    clearRemoteBrowserState();
    currentInputBufferRef.current = "";
    setCommandDraft("");
    setHistorySelection("");
    setIsHistoryMenuOpen(false);
    setStatusLine("SSH 会话已关闭");
    terminalRef.current?.writeln("\r\n[session closed]\r\n");
    const refreshed = await invoke<ShellOverview>("get_shell_overview");
    setOverview(refreshed);
  }

  async function loadDirectory(path: string, options?: { expand?: boolean }) {
    setIsListing(true);
    try {
      const data = await invoke<RemoteEntry[]>("read_remote_dir", { path });
      setEntriesByPath((previous) => ({
        ...previous,
        [path]: data
      }));
      if (options?.expand !== false) {
        setExpandedPaths((previous) => ({
          ...previous,
          [path]: true
        }));
      }
      setCurrentPath(path);
      setStatusLine(`目录已加载: ${path}`);
    } catch (error) {
      console.error(error);
      setStatusLine(String(error));
    } finally {
      setIsListing(false);
    }
  }

  async function openEntry(entry: RemoteEntry) {
    setSelectedEntry(entry);

    if (entry.isDir) {
      if (!canOpenDirectory(entry)) {
        setStatusLine(`目录 ${entry.path} 权限不足，当前用户不能进入。`);
        return;
      }

      if (expandedPaths[entry.path]) {
        setExpandedPaths((previous) => ({
          ...previous,
          [entry.path]: false
        }));
        setCurrentPath(entry.path);
        return;
      }

      if (entriesByPath[entry.path]) {
        setExpandedPaths((previous) => ({
          ...previous,
          [entry.path]: true
        }));
        setCurrentPath(entry.path);
        return;
      }

      await loadDirectory(entry.path);
      return;
    }

    if (!canPreviewEntry(entry)) {
      setPreview(null);
      setPreviewError(`无法预览 ${entry.path}：当前 SSH 用户没有读取权限。`);
      setStatusLine(`文件 ${entry.path} 没有读取权限。`);
      setActiveWorkspace("preview");
      return;
    }

    await openPreview(entry.path);
  }

  async function openPreview(path: string) {
    try {
      const file = await invoke<FilePreview>("preview_remote_file", { path });
      setPreview(file);
      setPreviewError("");
      setEditorContent(file.content ?? "");
      setActiveWorkspace("preview");
      setStatusLine(`已预览: ${path}`);
      const refreshed = await invoke<ShellOverview>("get_shell_overview");
      setOverview(refreshed);
    } catch (error) {
      console.error(error);
      setPreview(null);
      setPreviewError(`无法预览 ${path}: ${String(error)}`);
      setStatusLine(String(error));
    }
  }

  function focusTerminal() {
    if (activeWorkspace === "terminal") {
      terminalRef.current?.focus();
    }
  }

  function rememberCommand(command: string) {
    const cwd = currentPath || connection?.homePath || "/";
    setCommandHistory((previous) => pushCommandHistory(previous, command, cwd));
    setHistorySelection(command.trim());
  }

  function syncCommandDraft(next: string) {
    currentInputBufferRef.current = next;
    setCommandDraft(next);
    if (next.trim() !== historySelection) {
      setHistorySelection("");
    }
  }

  function clearRemoteBrowserState() {
    setEntriesByPath({});
    setExpandedPaths({});
    setPreview(null);
    setPreviewError("");
    setEditorContent("");
    editorRef.current = null;
    setSelectedEntry(null);
    setCurrentPath("");
    setDragTargetPath("");
  }

  function trackTerminalInput(data: string) {
    if (data.includes("\u001b")) {
      return;
    }

    let next = currentInputBufferRef.current;

    for (const char of data) {
      if (char === "\r") {
        const committed = next.trim();
        if (committed) {
          rememberCommand(committed);
        }
        next = "";
        continue;
      }

      if (char === "\u007f") {
        next = next.slice(0, -1);
        continue;
      }

      if (char === "\u0003" || char === "\u0015") {
        next = "";
        continue;
      }

      if (char === "\n") {
        continue;
      }

      if (char >= " ") {
        next += char;
      }
    }

    syncCommandDraft(next);
  }

  function syncDraftFromTerminalBuffer(terminal: Terminal | null) {
    if (!terminal) {
      return;
    }

    const buffer = terminal.buffer.active;
    const currentRow = buffer.baseY + buffer.cursorY;
    const line = buffer.getLine(currentRow)?.translateToString(true) ?? "";
    const parsed = extractCommandFromPromptLine(line);

    if (parsed == null) {
      return;
    }

    if (!isReasonableCommandText(parsed)) {
      pendingTerminalDraftSyncRef.current = false;
      return;
    }

    syncCommandDraft(parsed);
    pendingTerminalDraftSyncRef.current = false;
  }

  function focusTerminalSearchMatch(index: number) {
    const terminal = terminalRef.current;
    const match = terminalSearchMatchesRef.current[index];
    if (!terminal || !match) {
      return;
    }

    terminal.select(match.col, match.row, match.length);
    terminal.scrollToLine(match.row);
  }

  function focusPreviewSearchMatch(index: number) {
    const editor = editorRef.current;
    const match = previewSearchMatchesRef.current[index];
    const model = editor?.getModel();
    if (!editor || !model || !match) {
      return;
    }

    const start = model.getPositionAt(match.start);
    const end = model.getPositionAt(match.end);
    editor.setSelection({
      startLineNumber: start.lineNumber,
      startColumn: start.column,
      endLineNumber: end.lineNumber,
      endColumn: end.column
    });
    editor.revealRangeInCenter({
      startLineNumber: start.lineNumber,
      startColumn: start.column,
      endLineNumber: end.lineNumber,
      endColumn: end.column
    });
    editor.focus();
  }

  function handleEditorMount(editor: MonacoEditor.IStandaloneCodeEditor) {
    editorRef.current = editor;
    if (searchQuery.trim() && preview?.kind === "Text" && previewSearchMatchesRef.current.length) {
      focusPreviewSearchMatch(searchActiveIndex);
    }
  }

  function jumpSearch(step: number) {
    const matches =
      activeWorkspace === "terminal" ? terminalSearchMatchesRef.current : previewSearchMatchesRef.current;

    if (!matches.length) {
      return;
    }

    setSearchActiveIndex((previous) => (previous + step + matches.length) % matches.length);
  }

  async function fillTerminalCommand(command: string) {
    if (!connection) {
      setStatusLine("请先连接 SSH。");
      return;
    }

    const normalized = command.replace(/\r?\n/g, " ").trim();
    if (!normalized) {
      setStatusLine("请输入要执行的命令。");
      return;
    }

    try {
      await invoke("send_terminal_input", {
        data: `\u0015${normalized}`
      });
      setHistorySelection(normalized);
      syncCommandDraft(normalized);
      setStatusLine(`已填入命令行: ${normalized}`);
      setActiveWorkspace("terminal");
      terminalRef.current?.focus();
    } catch (error) {
      console.error(error);
      setStatusLine(`命令发送失败: ${String(error)}`);
    }
  }

  async function executeTerminalCommand() {
    if (!connection) {
      setStatusLine("请先连接 SSH。");
      return;
    }

    const currentLine = currentInputBufferRef.current.trim();
    if (!currentLine) {
      setStatusLine("当前终端输入是空的。");
      return;
    }

    try {
      await invoke("send_terminal_input", { data: "\r" });
      rememberCommand(currentLine);
      syncCommandDraft("");
      setStatusLine(`已执行命令: ${currentLine}`);
      terminalRef.current?.focus();
    } catch (error) {
      console.error(error);
      setStatusLine(`执行失败: ${String(error)}`);
    }
  }

  async function clearCurrentCommand() {
    if (!connection) {
      setStatusLine("请先连接 SSH。");
      return;
    }

    try {
      await invoke("send_terminal_input", { data: "\u0015" });
      syncCommandDraft("");
      setHistorySelection("");
      setStatusLine("当前命令行已清空");
      terminalRef.current?.focus();
    } catch (error) {
      console.error(error);
      setStatusLine(`清空当前行失败: ${String(error)}`);
    }
  }

  async function requestTabCompletion() {
    if (!connection) {
      setStatusLine("请先连接 SSH。");
      return;
    }

    try {
      pendingTerminalDraftSyncRef.current = true;
      await invoke("send_terminal_input", { data: "\t" });
      setStatusLine("已触发 Tab 补全");
      terminalRef.current?.focus();
    } catch (error) {
      pendingTerminalDraftSyncRef.current = false;
      console.error(error);
      setStatusLine(`Tab 补全失败: ${String(error)}`);
    }
  }

  async function clearTerminal() {
    if (!connection) {
      setStatusLine("请先连接 SSH。");
      return;
    }

    terminalRef.current?.clear();
    syncCommandDraft("");

    try {
      await invoke("send_terminal_input", { data: "clear\r" });
      setStatusLine("终端已清屏");
      setTerminalContentVersion((previous) => previous + 1);
      terminalRef.current?.focus();
    } catch (error) {
      console.error(error);
      setStatusLine(`清屏失败: ${String(error)}`);
    }
  }

  function clearSearch() {
    setSearchQuery("");
    setSearchResultCount(0);
    setSearchActiveIndex(0);
    terminalSearchMatchesRef.current = [];
    previewSearchMatchesRef.current = [];
    terminalRef.current?.clearSelection();
    const editor = editorRef.current;
    const position = editor?.getPosition();
    if (editor && position) {
      editor.setSelection({
        startLineNumber: position.lineNumber,
        startColumn: position.column,
        endLineNumber: position.lineNumber,
        endColumn: position.column
      });
    }
  }

  async function minimizeWindow() {
    try {
      await appWindowRef.current.minimize();
    } catch (error) {
      console.error(error);
      setStatusLine(`最小化失败: ${String(error)}`);
    }
  }

  async function toggleWindowMaximize() {
    try {
      await appWindowRef.current.toggleMaximize();
      setIsWindowMaximized(await appWindowRef.current.isMaximized());
    } catch (error) {
      console.error(error);
      setStatusLine(`窗口缩放失败: ${String(error)}`);
    }
  }

  async function toggleWindowFullscreen() {
    try {
      const next = !isWindowFullscreen;
      await appWindowRef.current.setFullscreen(next);
      setIsWindowFullscreen(next);
    } catch (error) {
      console.error(error);
      setStatusLine(`切换全屏失败: ${String(error)}`);
    }
  }

  async function closeWindow() {
    try {
      await appWindowRef.current.close();
    } catch (error) {
      console.error(error);
      setStatusLine(`关闭窗口失败: ${String(error)}`);
    }
  }

  function rememberUpdateLater(version: string | null | undefined) {
    if (!version) {
      setUpdateNotice(null);
      return;
    }

    try {
      window.localStorage.setItem(UPDATE_DISMISSED_VERSION_STORAGE_KEY, version);
    } catch (error) {
      console.error(error);
    }
    setUpdateNotice(null);
  }

  function clearDismissedUpdateVersion() {
    try {
      window.localStorage.removeItem(UPDATE_DISMISSED_VERSION_STORAGE_KEY);
      setStatusLine("已清除“下次再说”的忽略版本记录");
    } catch (error) {
      console.error(error);
      setStatusLine(`清除忽略版本失败: ${String(error)}`);
    }
  }

  function updatePreference<K extends keyof UpdatePreferences>(key: K, value: UpdatePreferences[K]) {
    setUpdatePreferences((previous) => ({
      ...previous,
      [key]: value
    }));
  }

  function recordUpdateCheck(outcome: UpdateCheckRecord["outcome"], message: string, version?: string | null) {
    setLastUpdateCheck({
      checkedAt: new Date().toISOString(),
      outcome,
      version: version ?? null,
      message
    });
  }

  function openUpdateNotice(result: AppUpdateInfo, reason: "startup" | "manual") {
    const dismissedVersion = readDismissedUpdateVersion();
    if (reason === "startup" && dismissedVersion && dismissedVersion === result.version) {
      return;
    }

    if (reason === "startup" && !updatePreferences.showAvailableNoticeOnStartup) {
      return;
    }

    setUpdateNotice({
      kind: "available",
      tone: "warning",
      title: `发现新版本 v${result.version}`,
      message: result.message,
      detail: result.notes?.trim() || "这次 Release 没额外写说明，但安装包和签名已经就位。",
      version: result.version,
      sticky: true
    });
  }

  async function checkAppUpdate(options?: { reason?: "startup" | "manual"; silentNoUpdate?: boolean }) {
    if (isCheckingUpdate) {
      return;
    }

    const reason = options?.reason ?? "manual";
    const startedAt = window.performance.now();
    setIsCheckingUpdate(true);
    if (reason === "manual") {
      setStatusLine("正在检查更新...");
    }
    try {
      const result = await invoke<AppUpdateInfo>("check_app_update");
      setUpdateCheckDurationMs(window.performance.now() - startedAt);
      setUpdateInfo(result);
      setAppVersion(result.currentVersion);
      if (reason === "manual") {
        setStatusLine(result.message);
      }
      if (result.available && result.version) {
        setUpdateProgress(null);
        recordUpdateCheck("available", result.message, result.version);
        openUpdateNotice(result, reason);
        return;
      }

      recordUpdateCheck("latest", result.message, result.currentVersion);
      if (!options?.silentNoUpdate) {
        setUpdateNotice({
          kind: "latest",
          tone: "success",
          title: "当前已经是最新版本",
          message: result.message,
          detail: "这次检查没有发现更高版本。",
          version: result.currentVersion,
          sticky: false
        });
      }
    } catch (error) {
      console.error(error);
      const message = `检查更新失败: ${String(error)}`;
      setUpdateCheckDurationMs(window.performance.now() - startedAt);
      recordUpdateCheck("error", message, updateInfo?.version ?? appVersion ?? null);
      if (reason === "manual") {
        setStatusLine(message);
      }
      if (reason !== "startup") {
        setUpdateNotice({
          kind: "error",
          tone: "error",
          title: "检查更新失败",
          message,
          detail: "GitHub 访问、代理状态和签名校验都会影响更新检查。",
          sticky: false
        });
      }
    } finally {
      setIsCheckingUpdate(false);
    }
  }

  async function installAppUpdate() {
    if (isInstallingUpdate) {
      return;
    }

    setIsInstallingUpdate(true);
    setUpdateProgress({
      stage: "preparing",
      message: "正在确认远端版本、签名和下载地址...",
      version: updateInfo?.version ?? null,
      downloadedBytes: null,
      totalBytes: null,
      progressPercent: null
    });
    setUpdateNotice({
      kind: "progress",
      tone: "info",
      title: "正在准备安装更新",
      message: "先确认远端版本和安装包签名，稍等一下。",
      detail: "更新包来自 GitHub Releases。",
      version: updateInfo?.version ?? null,
      sticky: true
    });
    try {
      const result = await invoke<AppUpdateInstallResponse>("install_app_update");
      setStatusLine(result.message);
      setUpdateNotice({
        kind: "progress",
        tone: "success",
        title: `更新 ${result.version} 已安装`,
        message: result.message,
        detail: "应用会自动重启，重启后就是新版本。",
        version: result.version,
        sticky: true
      });
    } catch (error) {
      console.error(error);
      const message = `安装更新失败: ${String(error)}`;
      setStatusLine(message);
      setUpdateProgress({
        stage: "idle",
        message,
        version: updateInfo?.version ?? null,
        downloadedBytes: null,
        totalBytes: null,
        progressPercent: null
      });
      setUpdateNotice({
        kind: "error",
        tone: "error",
        title: "安装更新失败",
        message,
        detail: "可以稍后重试，或者去 GitHub Release 页面手动下载安装包。",
        version: updateInfo?.version ?? null,
        sticky: true
      });
    } finally {
      setIsInstallingUpdate(false);
    }
  }

  function openAboutDialog() {
    setIsAboutDialogOpen(true);
  }

  function closeAboutDialog() {
    setIsAboutDialogOpen(false);
  }

  async function startWindowDragging(event: ReactMouseEvent<HTMLElement>) {
    if (event.button !== 0 || isWindowFullscreen || isWindowDragBlockedTarget(event.target)) {
      return;
    }

    try {
      await appWindowRef.current.startDragging();
    } catch (error) {
      console.error(error);
      setStatusLine(`窗口拖动失败: ${String(error)}`);
    }
  }

  async function startWindowResize(direction: ResizeDirection) {
    if (isWindowFullscreen || isWindowMaximized) {
      return;
    }

    try {
      await appWindowRef.current.startResizeDragging(direction);
    } catch (error) {
      console.error(error);
      setStatusLine(`窗口缩放失败: ${String(error)}`);
    }
  }

  async function savePreview() {
    if (!preview || preview.kind !== "Text" || isSaving) {
      return;
    }

    if (preview.readonly) {
      setStatusLine(`文件 ${preview.path} 当前为只读，不能保存覆盖。`);
      return;
    }

    setIsSaving(true);
    try {
      const result = await invoke<SaveResponse>("save_remote_file", {
        path: preview.path,
        content: editorContent
      });
      setStatusLine(result.message);
      setSaveFeedback({
        tone: "success",
        message: `已保存 ${new Date().toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        })}`
      });
      const refreshed = await invoke<ShellOverview>("get_shell_overview");
      setOverview(refreshed);
    } catch (error) {
      console.error(error);
      const message = String(error);
      setStatusLine(message);
      setSaveFeedback({
        tone: "error",
        message: "保存失败"
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function uploadFiles(files: File[], targetDir: string, source: string) {
    if (!connection) {
      setStatusLine("请先连接 SSH。");
      return;
    }

    if (!files.length) {
      return;
    }

    setIsUploading(true);
    setPreviewError("");

    let firstImagePath = "";

    try {
      for (const [index, file] of files.entries()) {
        const filename = buildClipboardFileName(file, index);
        setStatusLine(`正在通过${source}上传 ${filename} -> ${targetDir}`);
        const base64Data = await readFileAsBase64(file);
        const result = await invoke<UploadResponse>("upload_remote_file", {
          remoteDir: targetDir,
          filename,
          base64Data
        });

        if (!firstImagePath && isImagePreviewPath(result.path)) {
          firstImagePath = result.path;
        }

        setStatusLine(result.message);
      }

      await loadDirectory(targetDir);
      if (firstImagePath) {
        await openPreview(firstImagePath);
      } else {
        const refreshed = await invoke<ShellOverview>("get_shell_overview");
        setOverview(refreshed);
      }
    } catch (error) {
      console.error(error);
      setStatusLine(`上传失败: ${String(error)}`);
    } finally {
      setIsUploading(false);
      setDragTargetPath("");
    }
  }

  async function uploadWindowsClipboardFiles(targetDir: string, options?: { fillTerminalPaths?: boolean }) {
    if (!connection) {
      return;
    }

    setIsUploading(true);
    setPreviewError("");

    try {
      setStatusLine(`正在读取 Windows 剪贴板并上传到 ${targetDir}`);
      const results = await invoke<UploadResponse[]>("upload_windows_clipboard_files", {
        remoteDir: targetDir
      });

      if (!results.length) {
        setStatusLine("剪贴板中没有可上传的文件或图片。");
        return;
      }

      const firstImagePath = results.find((item) => isImagePreviewPath(item.path))?.path ?? "";
      await loadDirectory(targetDir);

      if (options?.fillTerminalPaths) {
        const pastedPaths = results.map((item) => shellEscapePath(item.path)).join(" ");
        if (pastedPaths) {
          await invoke("send_terminal_input", { data: pastedPaths });
          trackTerminalInput(pastedPaths);
          setActiveWorkspace("terminal");
          terminalRef.current?.focus();
          setStatusLine(`已上传剪贴板内容到 ${targetDir}，并填入终端路径`);
          return;
        }
      }

      setStatusLine(results[results.length - 1]?.message ?? `已上传到 ${targetDir}`);

      if (firstImagePath) {
        await openPreview(firstImagePath);
      } else {
        const refreshed = await invoke<ShellOverview>("get_shell_overview");
        setOverview(refreshed);
      }
    } catch (error) {
      console.error(error);
      setStatusLine(`剪贴板上传失败: ${String(error)}`);
    } finally {
      setIsUploading(false);
      setDragTargetPath("");
    }
  }

  async function pasteTextToTerminal(text: string) {
    if (!connection) {
      setStatusLine("请先连接 SSH。");
      return;
    }

    if (!text) {
      setStatusLine("剪贴板里没有可粘贴的文本。");
      return;
    }

    try {
      await invoke("send_terminal_input", { data: text });
      trackTerminalInput(text);
      setActiveWorkspace("terminal");
      setStatusLine("已粘贴剪贴板内容到终端");
      terminalRef.current?.focus();
    } catch (error) {
      console.error(error);
      setStatusLine(`终端粘贴失败: ${String(error)}`);
    }
  }

  async function pasteClipboard() {
    if (!preview || preview.kind !== "Text") {
      setStatusLine("当前区域不支持文本粘贴。");
      return;
    }

    try {
      const text = await navigator.clipboard.readText();
      setEditorContent((previous) => previous + (previous ? "\n" : "") + text);
      setStatusLine("剪贴板内容已插入编辑器");
    } catch (error) {
      console.error(error);
      setStatusLine("当前环境不允许直接读取剪贴板");
    }
  }

  function closeTreeContextMenu() {
    setTreeContextMenu(null);
  }

  function closeFileActionDialog() {
    setFileActionDialog(null);
  }

  function findEntryByPath(path: string): RemoteEntry | null {
    for (const entries of Object.values(entriesByPath)) {
      const matched = entries.find((entry) => entry.path === path);
      if (matched) {
        return matched;
      }
    }

    return null;
  }

  function canCreateInDirectory(targetDir: string): boolean {
    if (!connection) {
      return false;
    }

    const targetEntry = findEntryByPath(targetDir);
    if (!targetEntry) {
      return true;
    }

    return targetEntry.isDir && targetEntry.canEnter;
  }

  function openFileActionDialogForTarget(mode: FileActionMode, targetDir: string, entry: RemoteEntry | null) {
    const initialName = mode === "rename" ? entry?.name ?? "" : "";
    const dangerText =
      mode === "delete"
        ? entry?.isDir
          ? "会递归删除整个目录，里面的文件也一起没了。"
          : "删除后无法恢复，请确认。"
        : "";

    setFileActionDialog({
      mode,
      targetDir,
      entry,
      name: initialName,
      errors: {},
      busy: false,
      dangerText
    });
    closeTreeContextMenu();
  }

  function openFileActionDialog(mode: FileActionMode) {
    if (!treeContextMenu) {
      return;
    }

    openFileActionDialogForTarget(mode, treeContextMenu.targetDir, treeContextMenu.entry);
  }

  async function refreshTreeAfterMutation(targetPath: string, parentDir: string) {
    const affected = new Set<string>([parentDir]);

    if (currentPath === targetPath) {
      setCurrentPath(parentDir);
    }

    if (preview?.path === targetPath || selectedEntry?.path === targetPath) {
      setPreview(null);
      setPreviewError("");
      setEditorContent("");
      setSelectedEntry(null);
      setActiveWorkspace("terminal");
    }

    Object.keys(entriesByPath).forEach((path) => {
      if (path === targetPath || path.startsWith(`${targetPath}/`)) {
        affected.add(path);
      }
    });

    setEntriesByPath((previous) => {
      const next = { ...previous };
      for (const path of affected) {
        delete next[path];
      }
      return next;
    });

    setExpandedPaths((previous) => {
      const next = { ...previous };
      for (const path of affected) {
        if (path !== parentDir) {
          delete next[path];
        }
      }
      return next;
    });

    await loadDirectory(parentDir);
  }

  async function submitFileActionDialog() {
    if (!connection || !fileActionDialog) {
      return;
    }

    const { mode, entry, name, targetDir } = fileActionDialog;
    const normalizedName = name.trim();

    if (mode !== "delete") {
      const errors = validateFileActionName(normalizedName);
      if (Object.keys(errors).length > 0) {
        setFileActionDialog((previous) => (previous ? { ...previous, errors } : previous));
        return;
      }
    }

    setFileActionDialog((previous) => (previous ? { ...previous, busy: true, errors: {} } : previous));

    try {
      let result: FileActionResponse;
      let parentDir = targetDir;
      let stalePath = targetDir;

      if (mode === "new-file") {
        result = await invoke<FileActionResponse>("create_remote_file", {
          parentDir: targetDir,
          name: normalizedName
        });
        stalePath = targetDir;
      } else if (mode === "new-directory") {
        result = await invoke<FileActionResponse>("create_remote_directory", {
          parentDir: targetDir,
          name: normalizedName
        });
        stalePath = targetDir;
      } else if (mode === "rename" && entry) {
        parentDir = parentRemotePath(entry.path);
        result = await invoke<FileActionResponse>("rename_remote_entry", {
          path: entry.path,
          newName: normalizedName
        });
        stalePath = entry.path;
      } else if (mode === "delete" && entry) {
        parentDir = parentRemotePath(entry.path);
        result = await invoke<FileActionResponse>("delete_remote_entry", {
          path: entry.path,
          isDir: entry.isDir
        });
        stalePath = entry.path;
      } else {
        throw new Error("当前操作缺少目标路径。");
      }

      await refreshTreeAfterMutation(stalePath, parentDir);
      setStatusLine(result.message);
      closeFileActionDialog();
    } catch (error) {
      console.error(error);
      const message = String(error);
      setFileActionDialog((previous) =>
        previous
          ? {
              ...previous,
              busy: false,
              errors:
                previous.mode === "delete"
                  ? previous.errors
                  : {
                      ...previous.errors,
                      name: message
                    }
            }
          : previous
      );
      setStatusLine(message);
      return;
    }

    setFileActionDialog(null);
  }

  function openTreeContextMenu(
    event: ReactMouseEvent<HTMLElement>,
    entry: RemoteEntry | null,
    targetDir: string,
    targetLabel: string
  ) {
    if (!connection) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setIsHistoryMenuOpen(false);

    const menuWidth = 240;
    const menuHeight = 460;
    const x = Math.max(16, Math.min(event.clientX, window.innerWidth - menuWidth - 16));
    const y = Math.max(16, Math.min(event.clientY, window.innerHeight - menuHeight - 16));

    setTreeContextMenu({
      x,
      y,
      entry,
      targetDir,
      targetLabel
    });
  }

  async function copyTextToClipboard(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setStatusLine(`${label}已复制到剪贴板`);
      closeTreeContextMenu();
    } catch (error) {
      console.error(error);
      setStatusLine(`复制失败：未能写入${label}。`);
    }
  }

  async function jumpTerminalToPath(targetDir: string) {
    if (!connection) {
      return;
    }

    try {
      await invoke("send_terminal_input", {
        data: buildCdCommand(targetDir)
      });
      syncCommandDraft("");
      setActiveWorkspace("terminal");
      setStatusLine(`已发送切换目录命令: ${targetDir}`);
      closeTreeContextMenu();
      terminalRef.current?.focus();
    } catch (error) {
      console.error(error);
      setStatusLine(`终端切换目录失败: ${String(error)}`);
    }
  }

  async function pasteClipboardToTarget(targetDir: string) {
    closeTreeContextMenu();
    await uploadWindowsClipboardFiles(targetDir);
  }

  async function downloadRemoteTarget(
    remotePath: string,
    suggestedName: string,
    isDir: boolean
  ) {
    if (!connection) {
      return;
    }

    try {
      closeTreeContextMenu();
      setStatusLine(`开始下载 ${remotePath}`);
      const result = await invoke<DownloadResponse>("download_remote_entry", {
        remotePath,
        suggestedName,
        isDir
      });
      setStatusLine(result.message);
    } catch (error) {
      console.error(error);
      setStatusLine(`下载失败: ${String(error)}`);
    }
  }

  function goParent() {
    if (!currentPath || currentPath === "/") {
      return;
    }

    const parent = currentPath.split("/").slice(0, -1).join("/") || "/";
    void loadDirectory(parent);
  }

  function handleTreeDragOver(event: ReactDragEvent<HTMLElement>, targetDir: string) {
    if (!connection || !transferHasFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setDragTargetPath(targetDir);
  }

  function handleTreeDragLeave(event: ReactDragEvent<HTMLElement>, targetDir: string) {
    event.preventDefault();
    event.stopPropagation();

    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }

    setDragTargetPath((previous) => (previous === targetDir ? "" : previous));
  }

  async function handleTreeDrop(event: ReactDragEvent<HTMLElement>, entry: RemoteEntry | null) {
    const targetDir = resolveUploadTargetDir(entry, currentPath || connection?.homePath || "/");
    if (!connection) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (!canUploadToEntry(entry)) {
      setDragTargetPath("");
      setStatusLine(`目标目录 ${targetDir} 不可写，无法上传。`);
      return;
    }

    const files = extractTransferFiles(event.dataTransfer);
    if (!files.length) {
      setDragTargetPath("");
      setStatusLine("未检测到可上传文件。");
      return;
    }

    await uploadFiles(files, targetDir, "拖拽");
  }

  function renderTree(path: string, level = 0): JSX.Element[] {
    const entries = entriesByPath[path] ?? [];
    return entries.flatMap((entry) => {
      const expanded = Boolean(expandedPaths[entry.path]);
      const dropTargetDir = resolveUploadTargetDir(entry, currentPath || "/");
      const accessState = getEntryAccessState(entry);
      const accessLabel = entryAccessLabel(entry);
      const accessBadge = entryAccessBadgeLabel(entry);
      const accessHint = entryAccessHint(entry);
      const children = entry.isDir && expanded ? renderTree(entry.path, level + 1) : [];

      return [
        <button
          className={`tree-row ${currentPath === entry.path ? "active" : ""} ${dragTargetPath === dropTargetDir ? "drag-over" : ""} access-${accessState}`}
          key={entry.path}
          onClick={() => void openEntry(entry)}
          onContextMenu={(event) =>
            openTreeContextMenu(
              event,
              entry,
              dropTargetDir,
              entry.isDir ? entry.path : entry.name
            )
          }
          onDragOver={(event) => handleTreeDragOver(event, dropTargetDir)}
          onDragLeave={(event) => handleTreeDragLeave(event, dropTargetDir)}
          onDrop={(event) => void handleTreeDrop(event, entry)}
          style={{ paddingLeft: `${16 + level * 18}px` }}
          title={`${entry.isDir ? `拖文件到这里，上传到 ${entry.path}` : `拖文件到这里，上传到 ${dropTargetDir}`} · ${accessLabel} · ${accessHint} · 权限 ${formatPermissions(entry.permissions)}`}
        >
          <span className="tree-toggle">{entry.isDir ? (expanded ? "▾" : "▸") : ""}</span>
          <span className={`file-icon ${entry.isDir ? "dir" : "file"} ${accessState}`} aria-hidden="true" />
          <span className="tree-main">
            <span className="tree-main-head">
              <span className="tree-name">{entry.name}</span>
              <span className={`entry-access-badge ${accessState}`}>{accessBadge}</span>
            </span>
            <span className="tree-submeta">
              {entry.isDir ? "目录" : "文件"} · {accessLabel} · {formatModifiedAt(entry.modifiedAt)}
            </span>
          </span>
          <span className="file-meta">{entry.isDir ? formatPermissions(entry.permissions) : `${formatBytes(entry.size)} · ${formatPermissions(entry.permissions)}`}</span>
        </button>,
        ...children
      ];
    });
  }

  const connectionHostText = connection?.host ?? "未连接";
  const currentWorkspaceTitle =
    activeWorkspace === "terminal"
      ? connection
        ? `${connection.name} 终端`
        : "终端未连接"
      : preview?.path ?? (previewError ? "预览失败" : "还没选择文件");
  const currentWorkspaceSubtitle =
    activeWorkspace === "terminal"
      ? statusLine
      : preview
        ? `${preview.kind} · ${formatBytes(preview.size)}`
        : previewError || "点文件树里的文件就会在这里预览";
  const selectionPath = selectedEntry?.path ?? preview?.path ?? currentPath ?? "/";
  const basicStatusLabel = connection ? "已连接" : "未连接";
  const basicLatencyLabel = connection ? `${connection.latencyMs}ms` : "--";
  const terminalStatusLabel = connection ? "终端在线" : "终端离线";
  const versionLabel = appVersion ? `v${appVersion}` : "版本读取中";
  const updateButtonLabel = updateInfo?.available && updateInfo.version ? `有新版本 ${updateInfo.version}` : "关于 / 更新";
  const updateButtonTitle = updateInfo?.available
    ? [updateInfo.message, updateInfo.notes].filter(Boolean).join("\n\n")
    : `当前版本 ${appVersion || "--"}`;
  const updateProgressPercent = clampPercent(updateProgress?.progressPercent);
  const updateProgressStage = updateProgress?.stage ?? null;
  const isUpdateProgressActive = isUpdateProgressStageActive(updateProgressStage);
  const isUpdateProgressIndeterminate =
    updateProgressStage === "preparing" || updateProgressStage === "installing";
  const updateProgressValueLabel =
    updateProgressStage === "completed"
      ? "100%"
      : isUpdateProgressIndeterminate
        ? "处理中"
        : `${Math.round(updateProgressPercent)}%`;
  const releasePageUrl = updateInfo?.version
    ? `${GITHUB_RELEASES_PAGE_URL}/tag/v${updateInfo.version}`
    : GITHUB_RELEASES_PAGE_URL;
  const updateStatusLabel = updateInfo
    ? updateInfo.available
      ? `发现新版本 ${updateInfo.version}`
      : "当前已是最新版本"
    : "尚未检查更新";
  const aboutPrimaryLabel = isInstallingUpdate
    ? "安装更新中..."
    : isCheckingUpdate
      ? "检查更新中..."
      : updateInfo?.available && updateInfo.version
        ? `安装 ${updateInfo.version}`
        : "检查更新";
  const updateLatencyLabel = isCheckingUpdate ? "检查中..." : formatUpdateDuration(updateCheckDurationMs);
  const updateProgressStatusLabel =
    isCheckingUpdate
      ? "正在检查更新"
      : updateProgress?.stage === "installing"
      ? "正在安装更新"
      : updateProgress?.stage === "completed"
        ? "更新已就绪"
        : updateProgress?.stage === "preparing"
          ? "准备更新"
          : updateProgress?.stage === "downloading"
            ? "正在下载更新"
            : "等待更新操作";
  const updateProgressDetailLabel =
    updateProgress?.totalBytes && updateProgress.downloadedBytes != null
      ? `${formatBytes(updateProgress.downloadedBytes)} / ${formatBytes(updateProgress.totalBytes)}`
      : updateProgressStage === "preparing"
        ? "正在向 GitHub Releases 确认版本、签名和安装包信息。"
        : updateProgressStage === "installing"
          ? "安装包已经下载完成，系统安装器正在接管后续步骤。"
          : updateInfo?.available
          ? "发现新版本后，这里会显示下载进度、安装阶段和传输详情。"
            : "还没有开始下载安装，发现新版本后这里会显示实时进度。";
  const updateCheckOutcomeLabel =
    lastUpdateCheck?.outcome === "available"
      ? `发现新版本 ${lastUpdateCheck.version ?? ""}`.trim()
      : lastUpdateCheck?.outcome === "latest"
        ? "已经同步到最新版本"
        : lastUpdateCheck?.outcome === "error"
          ? "上次检查失败"
          : "尚未检查";
  const releaseNotesList = releaseNotesToList(updateInfo?.notes);
  const dismissedUpdateVersion = readDismissedUpdateVersion();
  const updatePublishedAtLabel = formatUpdatePubDate(updateInfo?.pubDate ?? null);
  const updateFeedPublishedAtLabel = formatUpdatePubDate(updateFeedInfo?.pubDate ?? null);
  const lastUpdateCheckLabel = formatUpdateCheckTime(lastUpdateCheck?.checkedAt);
  const updateFeedLagNotice =
    appVersion &&
    updateFeedInfo?.version &&
    updateFeedInfo.version !== appVersion &&
    !updateInfo?.available
      ? `应用当前是 v${appVersion}，但更新源 latest.json 还停在 v${updateFeedInfo.version}。这通常不是客户端检查坏了，而是 GitHub Release 流水线还没把最新版本产物和清单切过去。`
      : "";
  const updateNoticeClass = updateNotice ? `update-notice ${updateNotice.tone}` : "update-notice";
  const currentEntries = currentPath ? entriesByPath[currentPath] ?? [] : entriesByPath["/"] ?? [];
  const currentDirCount = currentEntries.filter((entry) => entry.isDir).length;
  const currentFileCount = currentEntries.filter((entry) => !entry.isDir).length;
  const activeConnectionProfile = connectionProfiles.find((item) => item.id === activeProfileId) ?? null;
  const matchedConnectionProfile =
    connectionProfiles.find((item) => profileMatchesForm(item, form)) ?? null;
  const normalizedProfileSearchQuery = profileSearchQuery.trim().toLocaleLowerCase();
  const visibleConnectionProfiles = connectionProfiles.filter((profile) => {
    if (!normalizedProfileSearchQuery) {
      return true;
    }

    const haystack = [profile.name, profile.host, profile.port, profile.username].join(" ").toLocaleLowerCase();
    return haystack.includes(normalizedProfileSearchQuery);
  });
  const recentConnectionProfiles = connectionProfiles.filter((item) => item.lastUsedAt).slice(0, 4);
  const pinnedConnectionProfiles = connectionProfiles.filter((item) => item.pinned).length;
  const connectedProfileId = connection ? activeProfileId : "";
  const connectionStageLabel = formatConnectionStage(connectionProgress?.stage);
  const connectionProgressPercent = connectionProgress
    ? clampPercent((connectionProgress.currentStep / Math.max(connectionProgress.totalSteps || 1, 1)) * 100)
    : 0;
  const connectionProgressDetail =
    connectionProgress?.detail ??
    (connection
      ? `当前会话已连接到 ${connection.host}，主目录 ${connection.homePath}。`
      : "支持密码登录，连接超时后会及时返回。");
  const connectionActionLabel = connection ? "更新连接配置" : "新建连接";
  const connectionConfigLabel = connectionProfiles.length
    ? `连接配置 · ${connectionProfiles.length}`
    : connectionActionLabel;
  const savedProfilesLabel = connectionProfiles.length
    ? `已保存连接 · ${connectionProfiles.length}`
    : "已保存连接";
  const connectionUserLabel = connection?.name.includes("@")
    ? connection.name.split("@")[0]
    : form.username.trim() || "--";
  const sidebarPathLabel = currentPath || connection?.homePath || "/";
  const sidebarSummaryLabel = connection ? `${currentDirCount} 个目录 · ${currentFileCount} 个文件` : "未连接";
  const previewEditorLanguage = resolveEditorLanguage(preview?.language);
  const searchCounterLabel = searchResultCount ? `${searchActiveIndex + 1} / ${searchResultCount}` : "0 / 0";
  const currentDirectoryPath = currentPath || connection?.homePath || "/";
  const scopedCommandHistory = commandHistory.filter((item) => item.cwd === currentDirectoryPath);
  const connectIssue = connectError ? summarizeConnectError(connectError, form) : null;
  const previewAccessNotice =
    preview && selectedEntry && preview.path === selectedEntry.path && !selectedEntry.canWrite
      ? {
          tone: "warning" as const,
          title: "当前文件是只读预览",
          message: "这个 SSH 账号可以查看内容，但没有写入权限，保存和粘贴修改都已禁用。"
        }
      : null;
  const historyTriggerSummary = commandHistory.length
    ? scopedCommandHistory.length
      ? `最近命令 ${scopedCommandHistory.length}/${commandHistory.length}`
      : `最近命令 (${commandHistory.length})`
    : "最近命令";
  const workbenchStyle = isNarrowWorkbench
    ? undefined
    : {
        gridTemplateColumns: `${sidebarWidth}px 14px minmax(0, 1fr)`
      };

  const startSidebarResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (isNarrowWorkbench) {
      return;
    }

    event.preventDefault();
    sidebarResizeStateRef.current = {
      startX: event.clientX,
      startWidth: sidebarWidth
    };
    setIsSidebarResizing(true);
  };

  const resetSidebarWidth = () => {
    setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
  };

  return (
    <div className="shell-app">
      {!isWindowFullscreen && !isWindowMaximized
        ? WINDOW_RESIZE_DIRECTIONS.map((direction) => (
            <div
              key={direction}
              className={`window-resize-handle resize-${direction.toLowerCase()}`}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void startWindowResize(direction);
              }}
            />
          ))
        : null}

      <div className="aurora aurora-one" />
      <div className="aurora aurora-two" />
      <div className="aurora aurora-three" />

      {updateNotice ? (
        <aside className={updateNoticeClass}>
          <div className="update-notice-head">
            <span className={`update-notice-badge ${updateNotice.tone}`}>{updateNotice.kind === "available" ? "新版本" : updateNotice.kind === "progress" ? "更新中" : updateNotice.kind === "error" ? "失败" : "已检查"}</span>
            <button
              className="ghost-button small update-notice-close"
              disabled={updateNotice.kind === "progress" && isInstallingUpdate}
              onClick={() => {
                if (updateNotice.kind === "progress" && isInstallingUpdate) {
                  return;
                }
                setUpdateNotice(null);
              }}
            >
              关闭
            </button>
          </div>
          <div className="update-notice-copy">
            <strong>{updateNotice.title}</strong>
            <p>{updateNotice.message}</p>
            {updateNotice.detail ? <small>{updateNotice.detail}</small> : null}
          </div>

          {updateNotice.kind === "progress" ? (
            <div className="update-progress-block">
              <div className="update-progress-meta">
                <span>{updateProgressStatusLabel}</span>
                <strong>{updateProgressValueLabel}</strong>
              </div>
              <div className="update-progress-track">
                <div
                  className={`update-progress-fill ${isUpdateProgressIndeterminate ? "indeterminate" : ""}`}
                  style={isUpdateProgressIndeterminate ? undefined : { width: `${updateProgressPercent}%` }}
                />
              </div>
              <div className="update-progress-detail-row">
                <span>{updateProgress?.message ?? "正在等待更新任务启动..."}</span>
                <strong>{updateProgressDetailLabel}</strong>
              </div>
            </div>
          ) : null}

          <div className="update-notice-actions">
            {updateNotice.kind === "available" ? (
              <>
                <button
                  className="primary-button small-primary"
                  disabled={isInstallingUpdate}
                  onClick={() => void installAppUpdate()}
                >
                  现在更新
                </button>
                <button
                  className="ghost-button small"
                  onClick={() => rememberUpdateLater(updateNotice.version)}
                >
                  下次再说
                </button>
                <button
                  className="ghost-button small"
                  onClick={() => {
                    setIsAboutDialogOpen(true);
                    setUpdateNotice(null);
                  }}
                >
                  查看详情
                </button>
              </>
            ) : updateNotice.kind === "error" ? (
              <>
                <button className="primary-button small-primary" onClick={() => void checkAppUpdate({ reason: "manual" })}>
                  重新检查
                </button>
                <button className="ghost-button small" onClick={() => setIsAboutDialogOpen(true)}>
                  打开更新面板
                </button>
              </>
            ) : updateNotice.kind === "latest" ? (
              <button className="ghost-button small" onClick={() => setIsAboutDialogOpen(true)}>
                查看版本详情
              </button>
            ) : (
              <button className="ghost-button small" onClick={() => setIsAboutDialogOpen(true)}>
                打开更新面板
              </button>
            )}
          </div>
        </aside>
      ) : null}

      <TopToolbar
        savedProfilesMenuRef={savedProfilesMenuRef}
        connection={connection}
        connectionHostText={connectionHostText}
        basicStatusLabel={basicStatusLabel}
        basicLatencyLabel={basicLatencyLabel}
        versionLabel={versionLabel}
        statusLine={statusLine}
        savedProfilesLabel={savedProfilesLabel}
        connectionConfigLabel={connectionConfigLabel}
        currentPath={currentPath}
        isConnecting={isConnecting}
        isListing={isListing}
        isWindowFullscreen={isWindowFullscreen}
        isWindowMaximized={isWindowMaximized}
        updateInfo={updateInfo}
        updateButtonLabel={updateButtonLabel}
        updateButtonTitle={updateButtonTitle}
        activeProfileId={activeProfileId}
        connectedProfileId={connectedProfileId}
        connectionProfiles={connectionProfiles}
        recentConnectionProfiles={recentConnectionProfiles}
        isSavedProfilesMenuOpen={isSavedProfilesMenuOpen}
        onWindowMouseDown={(event) => {
          void startWindowDragging(event);
        }}
        onWindowDoubleClick={(event) => {
          if (isWindowDragBlockedTarget(event.target) || isWindowFullscreen) {
            return;
          }
          void toggleWindowMaximize();
        }}
        onToggleSavedProfilesMenu={() => setIsSavedProfilesMenuOpen((previous) => !previous)}
        onSaveCurrentProfile={() => {
          saveCurrentConnectionProfile();
        }}
        onOpenConnectModal={() => setIsConnectModalOpen(true)}
        onConnectWithProfile={(profile) => {
          void connectWithProfile(profile);
        }}
        onDisconnect={() => {
          void disconnect();
        }}
        onUploadClipboardFiles={() => {
          void uploadWindowsClipboardFiles(currentPath || connection?.homePath || "/");
        }}
        onGoParent={() => {
          void goParent();
        }}
        onRefreshDirectory={() => {
          void loadDirectory(currentPath);
        }}
        onOpenAbout={openAboutDialog}
        onToggleFullscreen={() => {
          void toggleWindowFullscreen();
        }}
        onMinimize={() => {
          void minimizeWindow();
        }}
        onToggleMaximize={() => {
          void toggleWindowMaximize();
        }}
        onCloseWindow={() => {
          void closeWindow();
        }}
        formatTime={formatUpdateCheckTime}
      />

      <div className="workbench" style={workbenchStyle}>
        <aside className="navigator-panel glass-panel">
          <section className="navigator-toolbar">
            <div className="navigator-toolbar-main">
              <BrandLogo className="mini-sidebar-logo" />
              <div className="navigator-toolbar-meta">
                <strong>{sidebarPathLabel}</strong>
                <span>{connection ? `${connectionUserLabel} @ ${connectionHostText}` : "未连接"}</span>
              </div>
              <span className={`status-pill ${connection ? "live" : connectionProgress?.isError ? "" : "progress-pill"}`}>
                {connectionStageLabel}
              </span>
            </div>

            <div className={`connect-progress-card compact ${connectionProgress?.isError ? "error" : connection ? "connected" : ""}`}>
              <div className="connect-progress-head">
                <strong>{connectionProgress?.message ?? sidebarSummaryLabel}</strong>
                <span>{connectionProgress ? `${Math.round(connectionProgressPercent)}%` : connection ? "100%" : "--"}</span>
              </div>
              <div className="update-progress-track connect-progress-track">
                <div className="update-progress-fill" style={{ width: `${connection ? 100 : connectionProgressPercent}%` }} />
              </div>
              <p>{connectionProgressDetail}</p>
            </div>

            <div className="navigator-toolbar-actions">
              <button className="primary-button small-primary" disabled={isConnecting} onClick={() => setIsConnectModalOpen(true)}>
                {isConnecting ? "连接中..." : connectionConfigLabel}
              </button>
              <button className="ghost-button small" disabled={!connection || isConnecting} onClick={() => void disconnect()}>
                断开
              </button>
              <button
                className="ghost-button small"
                disabled={!connection || !currentPath || isListing}
                onClick={() => void loadDirectory(currentPath || "/")}
              >
                {isListing ? "刷新中..." : "刷新"}
              </button>
            </div>
          </section>

          <RemoteFileTree
            fileListClassName={`file-list ${dragTargetPath === (currentPath || connection?.homePath || "/") ? "drop-ready" : ""}`}
            currentDirectoryPath={currentDirectoryPath}
            summaryLabel={isUploading ? "上传中..." : `${currentDirCount} 个目录 · ${currentFileCount} 个文件`}
            hasConnection={Boolean(connection)}
            hasRootEntries={Boolean(entriesByPath["/"]?.length)}
            legend={
              <>
                <span className="tree-legend-item writable">可写</span>
                <span className="tree-legend-item readonly">只读</span>
                <span className="tree-legend-item blocked">受限</span>
              </>
            }
            treeNodes={renderTree("/")}
            onRootDragOver={(event) => handleTreeDragOver(event, currentPath || connection?.homePath || "/")}
            onRootDragLeave={(event) => handleTreeDragLeave(event, currentPath || connection?.homePath || "/")}
            onRootDrop={(event) => {
              void handleTreeDrop(event, null);
            }}
            onRootContextMenu={(event) =>
              openTreeContextMenu(
                event,
                null,
                currentPath || connection?.homePath || "/",
                currentPath || connection?.homePath || "/"
              )
            }
          />

        </aside>

        {!isNarrowWorkbench ? (
          <div
            className={`workbench-divider ${isSidebarResizing ? "active" : ""}`}
            onMouseDown={startSidebarResize}
            onDoubleClick={resetSidebarWidth}
            role="separator"
            aria-label="调整文件区宽度"
            aria-orientation="vertical"
          />
        ) : null}

        <main className="workspace-panel">
          <section className="glass-panel workspace-card">
            <div className="workspace-tabs">
              <div className="tab-switcher">
                <button
                  className={`tab-button ${activeWorkspace === "terminal" ? "active" : ""}`}
                  onClick={() => setActiveWorkspace("terminal")}
                >
                  终端
                </button>
                <button
                  className={`tab-button ${activeWorkspace === "preview" ? "active" : ""}`}
                  onClick={() => setActiveWorkspace("preview")}
                >
                  预览
                </button>
              </div>
              <div className="mini-actions">
                {activeWorkspace === "preview" ? (
                  <PreviewWorkspaceActions
                    preview={preview}
                    isSaving={isSaving}
                    saveFeedback={saveFeedback}
                    onPasteText={() => {
                      void pasteClipboard();
                    }}
                    onSave={() => {
                      void savePreview();
                    }}
                  />
                ) : (
                  <span className={`status-pill terminal-status ${connection ? "live" : ""}`}>
                    {terminalStatusLabel}
                  </span>
                )}
              </div>
            </div>

            <div className="workspace-meta-bar">
              <div>
                <strong>{currentWorkspaceTitle}</strong>
                <span>{currentWorkspaceSubtitle}</span>
              </div>
              <div className="workspace-meta-side">
                <span>
                  {activeWorkspace === "preview"
                    ? `${preview?.language ?? preview?.kind ?? "无预览"} · ${selectedEntry ? formatPermissions(selectedEntry.permissions) : "--"}${preview?.readonly ? " · 权限提示" : ""}`
                    : "SSH 终端"}
                </span>
                <span>
                  {activeWorkspace === "preview"
                    ? `${selectionPath} · ${selectedEntry ? formatModifiedAt(selectedEntry.modifiedAt) : "等待选择"}`
                    : connection?.homePath ?? "/"}
                </span>
              </div>
            </div>

            <div className="workspace-body">
              <div className={`workspace-pane ${activeWorkspace === "terminal" ? "active" : ""}`}>
                <div className="terminal-surface workspace-terminal" onMouseDown={focusTerminal}>
                  <div className="terminal-host" ref={terminalHostRef} />
                </div>
              </div>

              <div className={`workspace-pane ${activeWorkspace === "preview" ? "active" : ""}`}>
                <PreviewWorkspace
                  preview={preview}
                  previewError={previewError}
                  editorContent={editorContent}
                  editorLanguage={previewEditorLanguage}
                  isActive={activeWorkspace === "preview"}
                  accessNotice={previewAccessNotice}
                  selectedEntry={selectedEntry}
                  selectionPath={selectionPath}
                  onSave={() => {
                    void savePreview();
                  }}
                  onEditorChange={setEditorContent}
                  onEditorMount={handleEditorMount}
                />
              </div>
            </div>

            {activeWorkspace === "terminal" ? (
              <TerminalToolbar
                historyMenuRef={historyMenuRef}
                searchInputRef={searchInputRef}
                isHistoryMenuOpen={isHistoryMenuOpen}
                commandHistory={commandHistory}
                scopedCommandHistory={scopedCommandHistory}
                historySelection={historySelection}
                historyTriggerSummary={historyTriggerSummary}
                currentDirectoryPath={currentDirectoryPath}
                commandDraft={commandDraft}
                searchQuery={searchQuery}
                searchResultCount={searchResultCount}
                searchCounterLabel={searchCounterLabel}
                statusLine={statusLine}
                hasConnection={Boolean(connection)}
                onToggleHistoryMenu={() => setIsHistoryMenuOpen((previous) => !previous)}
                onUseHistoryCommand={(command) => {
                  setIsHistoryMenuOpen(false);
                  void fillTerminalCommand(command);
                }}
                onCopyCommand={(command) => {
                  void copyTextToClipboard(command, "命令");
                }}
                onClearCurrentCommand={() => {
                  void clearCurrentCommand();
                }}
                onRequestTabCompletion={() => {
                  void requestTabCompletion();
                }}
                onExecuteTerminalCommand={() => {
                  void executeTerminalCommand();
                }}
                onSearchQueryChange={setSearchQuery}
                onSearchKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    jumpSearch(event.shiftKey ? -1 : 1);
                    return;
                  }

                  if (event.key === "Escape") {
                    event.preventDefault();
                    clearSearch();
                  }
                }}
                onJumpSearch={jumpSearch}
                onClearSearch={clearSearch}
                onClearTerminal={() => {
                  void clearTerminal();
                }}
                formatHistoryTime={formatUpdateCheckTime}
              />
            ) : null}
          </section>
        </main>
      </div>

      {treeContextMenu ? (
        <TreeContextMenu
          menuRef={treeContextMenuRef}
          menu={treeContextMenu}
          entryAccessLabel={treeContextMenu.entry ? entryAccessLabel(treeContextMenu.entry) : "当前目录"}
          canOpenDirectory={Boolean(treeContextMenu.entry && canOpenDirectory(treeContextMenu.entry))}
          canPreviewEntry={Boolean(treeContextMenu.entry && canPreviewEntry(treeContextMenu.entry))}
          canCreateInDirectory={canCreateInDirectory(treeContextMenu.targetDir)}
          canManageEntry={Boolean(treeContextMenu.entry && canManageEntry(treeContextMenu.entry))}
          canDownloadEntry={canDownloadEntry(treeContextMenu.entry, treeContextMenu.targetDir)}
          canUploadToEntry={canUploadToEntry(treeContextMenu.entry)}
          hasConnection={Boolean(connection)}
          downloadLabel={
            treeContextMenu.entry
              ? treeContextMenu.entry.isDir
                ? "下载目录"
                : "下载文件"
              : "下载当前目录"
          }
          onOpenEntry={() => {
            closeTreeContextMenu();
            if (treeContextMenu.entry) {
              void openEntry(treeContextMenu.entry);
            }
          }}
          onCreateFile={() => openFileActionDialog("new-file")}
          onCreateDirectory={() => openFileActionDialog("new-directory")}
          onRename={() => openFileActionDialog("rename")}
          onDownload={() => {
            const target = resolveDownloadTarget(treeContextMenu.entry, treeContextMenu.targetDir);
            void downloadRemoteTarget(target.remotePath, target.suggestedName, target.isDir);
          }}
          onRefresh={() => {
            closeTreeContextMenu();
            void loadDirectory(treeContextMenu.targetDir);
          }}
          onJumpInTerminal={() => {
            void jumpTerminalToPath(treeContextMenu.targetDir);
          }}
          onPasteFiles={() => {
            void pasteClipboardToTarget(treeContextMenu.targetDir);
          }}
          onCopyPath={() => {
            void copyTextToClipboard(treeContextMenu.targetDir, "路径");
          }}
          onCopyName={() => {
            if (treeContextMenu.entry) {
              void copyTextToClipboard(treeContextMenu.entry.name, "文件名");
            }
          }}
          onDelete={() => openFileActionDialog("delete")}
        />
      ) : null}

      {fileActionDialog ? (
        <FileActionDialog
          inputRef={fileActionInputRef}
          dialog={fileActionDialog}
          title={fileActionTitle(fileActionDialog.mode)}
          confirmLabel={fileActionConfirmLabel(fileActionDialog.mode, fileActionDialog.busy)}
          onNameChange={(value) =>
            setFileActionDialog((previous) =>
              previous
                ? {
                    ...previous,
                    name: value,
                    errors: { ...previous.errors, name: undefined }
                  }
                : previous
            )
          }
          onNameKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submitFileActionDialog();
            }
          }}
          onConfirm={() => {
            void submitFileActionDialog();
          }}
          onCancel={closeFileActionDialog}
        />
      ) : null}

      <AboutUpdateDialog
        isOpen={isAboutDialogOpen}
        appVersion={appVersion}
        updateInfo={updateInfo}
        updateFeedInfo={updateFeedInfo}
        updateProgress={updateProgress}
        updateStatusLabel={updateStatusLabel}
        publishedAtLabel={updatePublishedAtLabel}
        updateLatencyLabel={updateLatencyLabel}
        updateProgressStatusLabel={updateProgressStatusLabel}
        updateProgressDetailLabel={updateProgressDetailLabel}
        updateProgressValueLabel={updateProgressValueLabel}
        updateCheckOutcomeLabel={updateCheckOutcomeLabel}
        updateProgressPercent={updateProgressPercent}
        isUpdateProgressActive={isUpdateProgressActive}
        isUpdateProgressIndeterminate={isUpdateProgressIndeterminate}
        isCheckingUpdate={isCheckingUpdate}
        isInstallingUpdate={isInstallingUpdate}
        aboutPrimaryLabel={aboutPrimaryLabel}
        lastCheckedAtLabel={lastUpdateCheckLabel}
        updateFeedPublishedAtLabel={updateFeedPublishedAtLabel}
        updateFeedLagNotice={updateFeedLagNotice}
        dismissedUpdateVersion={dismissedUpdateVersion}
        releasePageUrl={releasePageUrl}
        latestJsonUrl={GITHUB_LATEST_JSON_URL}
        releaseNotesList={releaseNotesList}
        updatePreferences={updatePreferences}
        onClose={closeAboutDialog}
        onCheckUpdate={() => {
          void checkAppUpdate();
        }}
        onInstallUpdate={() => {
          void installAppUpdate();
        }}
        onCopyReleasePage={() => {
          void copyTextToClipboard(releasePageUrl, "Release 链接");
        }}
        onCopyLatestJson={() => {
          void copyTextToClipboard(GITHUB_LATEST_JSON_URL, "更新源地址");
        }}
        onCopyVersion={() => {
          void copyTextToClipboard(appVersion || "--", "版本号");
        }}
        onUpdatePreference={updatePreference}
        onClearDismissedVersion={clearDismissedUpdateVersion}
      />

      <ConnectDialog
        isOpen={isConnectModalOpen}
        form={form}
        connectFieldErrors={connectFieldErrors}
        connectError={connectError}
        connectIssue={connectIssue}
        connectionProgress={connectionProgress}
        connectionProgressPercent={connectionProgressPercent}
        connectionProgressDetail={connectionProgressDetail}
        connectionStageLabel={connectionStageLabel}
        activeConnectionProfile={activeConnectionProfile}
        matchedConnectionProfile={matchedConnectionProfile}
        connectionProfiles={connectionProfiles}
        visibleConnectionProfiles={visibleConnectionProfiles}
        recentConnectionProfiles={recentConnectionProfiles}
        pinnedConnectionProfiles={pinnedConnectionProfiles}
        activeProfileId={activeProfileId}
        connectedProfileId={connectedProfileId}
        profileSearchQuery={profileSearchQuery}
        isConnecting={isConnecting}
        hasConnection={Boolean(connection)}
        onClose={() => setIsConnectModalOpen(false)}
        onConnect={() => {
          void connect();
        }}
        onReset={() => {
          setForm(initialConnectionForm);
          setActiveProfileId("");
          setConnectError("");
          setConnectFieldErrors({});
          setConnectionProgress(null);
        }}
        onDisconnect={() => {
          void disconnect();
        }}
        onSaveCurrentProfile={() => {
          saveCurrentConnectionProfile();
        }}
        onProfileSearchChange={setProfileSearchQuery}
        onApplyProfile={applyConnectionProfile}
        onTogglePin={toggleConnectionProfilePin}
        onDeleteProfile={removeConnectionProfile}
        onFieldChange={updateConnectField}
        formatTime={formatUpdateCheckTime}
      />
    </div>
  );
}

export default App;
