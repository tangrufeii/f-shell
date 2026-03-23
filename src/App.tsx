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
import type {
  AppUpdateInfo,
  AppUpdateInstallResponse,
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
type ConnectFieldErrors = Partial<Record<keyof typeof initialForm, string>>;
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

const COMMAND_HISTORY_STORAGE_KEY = "fshell-command-history";
const COMMAND_HISTORY_LIMIT = 40;
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

const initialForm = {
  name: "我的服务器",
  host: "127.0.0.1",
  port: "22",
  username: "root",
  password: ""
};

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

function entryAccessLabel(entry: RemoteEntry): string {
  if (entry.isDir) {
    if (!canOpenDirectory(entry)) {
      return "无权限";
    }
    if (!entry.canWrite) {
      return "只读目录";
    }
    return "可访问";
  }

  if (!canPreviewEntry(entry)) {
    return "不可读取";
  }
  if (!entry.canWrite) {
    return "只读";
  }

  return "可读写";
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

  if (entry.isDir) {
    return entry.canWrite && entry.canEnter;
  }

  return entry.canWrite;
}

function canDownloadEntry(entry: RemoteEntry | null, targetDir: string): boolean {
  if (entry) {
    return entry.isDir ? canOpenDirectory(entry) : canPreviewEntry(entry);
  }

  return Boolean(targetDir);
}

function canManageEntry(entry: RemoteEntry | null): boolean {
  if (!entry) {
    return false;
  }

  if (entry.isDir) {
    return entry.canWrite && entry.canEnter;
  }

  return entry.canWrite;
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
        reject(new Error("本地文件读取结果不是字符串，WebView 又在发癫。"));
        return;
      }

      const [, base64 = ""] = reader.result.split(",", 2);
      if (!base64) {
        reject(new Error("本地文件转 base64 失败，数据是空的。"));
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

function readStoredHistory(): string[] {
  try {
    const raw = window.localStorage.getItem(COMMAND_HISTORY_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
  } catch (error) {
    console.error(error);
    return [];
  }
}

function pushCommandHistory(history: string[], command: string): string[] {
  const normalized = command.trim();
  if (!normalized) {
    return history;
  }

  return [normalized, ...history.filter((item) => item !== normalized)].slice(0, COMMAND_HISTORY_LIMIT);
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

function validateConnectForm(form: typeof initialForm): ConnectFieldErrors {
  const errors: ConnectFieldErrors = {};
  const host = form.host.trim();
  const username = form.username.trim();
  const password = form.password;
  const portText = form.port.trim();
  const port = Number(portText);

  if (!host) {
    errors.host = "主机地址不能为空。";
  } else if (/\s/.test(host)) {
    errors.host = "主机地址里别掺空格。";
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
    errors.username = "用户名里别塞空格。";
  }

  if (!password) {
    errors.password = "当前只支持密码登录，密码不能为空。";
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
  const [form, setForm] = useState(initialForm);
  const [overview, setOverview] = useState<ShellOverview | null>(null);
  const [connection, setConnection] = useState<ConnectionSummary | null>(null);
  const [currentPath, setCurrentPath] = useState("");
  const [entriesByPath, setEntriesByPath] = useState<EntryMap>({});
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [editorContent, setEditorContent] = useState("");
  const [selectedEntry, setSelectedEntry] = useState<RemoteEntry | null>(null);
  const [statusLine, setStatusLine] = useState("等待建立真实 SSH 会话");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isListing, setIsListing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [dragTargetPath, setDragTargetPath] = useState("");
  const [activeWorkspace, setActiveWorkspace] = useState<"terminal" | "preview">("terminal");
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [isWindowFullscreen, setIsWindowFullscreen] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [connectFieldErrors, setConnectFieldErrors] = useState<ConnectFieldErrors>({});
  const [treeContextMenu, setTreeContextMenu] = useState<TreeContextMenuState | null>(null);
  const [fileActionDialog, setFileActionDialog] = useState<FileActionDialogState | null>(null);
  const [commandHistory, setCommandHistory] = useState<string[]>(() => readStoredHistory());
  const [historySelection, setHistorySelection] = useState("");
  const [commandDraft, setCommandDraft] = useState("");
  const [isHistoryMenuOpen, setIsHistoryMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResultCount, setSearchResultCount] = useState(0);
  const [searchActiveIndex, setSearchActiveIndex] = useState(0);
  const [terminalContentVersion, setTerminalContentVersion] = useState(0);
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const hasConnectionRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const historyMenuRef = useRef<HTMLDivElement | null>(null);
  const treeContextMenuRef = useRef<HTMLDivElement | null>(null);
  const fileActionInputRef = useRef<HTMLInputElement | null>(null);
  const currentInputBufferRef = useRef("");
  const terminalSearchMatchesRef = useRef<TerminalSearchMatch[]>([]);
  const previewSearchMatchesRef = useRef<TextSearchMatch[]>([]);
  const pendingTerminalDraftSyncRef = useRef(false);

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
    const handlePointerDown = (event: MouseEvent) => {
      if (historyMenuRef.current && historyMenuRef.current.contains(event.target as Node)) {
        return;
      }

      if (treeContextMenuRef.current && treeContextMenuRef.current.contains(event.target as Node)) {
        return;
      }

      setIsHistoryMenuOpen(false);
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
  }, []);

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

      const files = extractTransferFiles(event.clipboardData);
      if (!files.length) {
        if (!isTextEditableTarget(event.target)) {
          event.preventDefault();
          const targetDir = currentPath || connection.homePath || "/";
          void uploadWindowsClipboardFiles(targetDir);
        }
        return;
      }

      event.preventDefault();
      const targetDir = currentPath || connection.homePath || "/";
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

  async function connect() {
    const errors = validateConnectForm(form);
    setConnectFieldErrors(errors);
    setConnectError("");

    if (Object.keys(errors).length > 0) {
      setStatusLine("连接信息没填对，先把表单错误修掉。");
      return;
    }

    setIsConnecting(true);
    try {
      terminalRef.current?.clear();
      terminalRef.current?.writeln(`Connecting to ${form.username}@${form.host}:${form.port} ...`);

      const result = await invoke<ConnectionSummary>("connect_ssh", {
        request: {
          name: form.name.trim() || undefined,
          host: form.host.trim(),
          port: Number(form.port),
          username: form.username.trim(),
          password: form.password,
          cols: terminalRef.current?.cols ?? 120,
          rows: terminalRef.current?.rows ?? 32
        }
      });

      setConnection(result);
      clearRemoteBrowserState();
      currentInputBufferRef.current = "";
      setCommandDraft("");
      setHistorySelection("");
      setCurrentPath("/");
      setStatusLine(`已连接 ${result.host}`);
      setActiveWorkspace("terminal");
      setIsConnectModalOpen(false);
      setConnectError("");
      setConnectFieldErrors({});
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
      terminalRef.current?.writeln(`\r\n[connect error] ${message}`);
      const refreshed = await invoke<ShellOverview>("get_shell_overview");
      setOverview(refreshed);
    } finally {
      setIsConnecting(false);
    }
  }

  async function disconnect() {
    await invoke("disconnect_ssh");
    setConnection(null);
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
    setCommandHistory((previous) => pushCommandHistory(previous, command));
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
    const textarea = editorRef.current;
    const match = previewSearchMatchesRef.current[index];
    if (!textarea || !match) {
      return;
    }

    textarea.setSelectionRange(match.start, match.end);
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
      setStatusLine("SSH 都没连上，还发什么命令。");
      return;
    }

    const normalized = command.replace(/\r?\n/g, " ").trim();
    if (!normalized) {
      setStatusLine("命令栏是空的，别让我对空气执行。");
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
      setStatusLine("SSH 都没连上，还执行个鬼。");
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
      setStatusLine("SSH 都没连上，清当前行没意义。");
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
      setStatusLine("SSH 都没连上，补全个锤子。");
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
      setStatusLine("先连上终端，清屏才有意义。");
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

  async function checkAppUpdate() {
    setIsCheckingUpdate(true);
    try {
      const result = await invoke<AppUpdateInfo>("check_app_update");
      setUpdateInfo(result);
      setAppVersion(result.currentVersion);
      setStatusLine(result.message);
    } catch (error) {
      console.error(error);
      setStatusLine(`检查更新失败: ${String(error)}`);
    } finally {
      setIsCheckingUpdate(false);
    }
  }

  async function installAppUpdate() {
    if (isInstallingUpdate) {
      return;
    }

    setIsInstallingUpdate(true);
    try {
      const result = await invoke<AppUpdateInstallResponse>("install_app_update");
      setStatusLine(result.message);
    } catch (error) {
      console.error(error);
      setStatusLine(`安装更新失败: ${String(error)}`);
    } finally {
      setIsInstallingUpdate(false);
    }
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
    if (!preview || preview.kind !== "Text") {
      return;
    }

    setIsSaving(true);
    try {
      const result = await invoke<SaveResponse>("save_remote_file", {
        path: preview.path,
        content: editorContent
      });
      setStatusLine(result.message);
      const refreshed = await invoke<ShellOverview>("get_shell_overview");
      setOverview(refreshed);
    } catch (error) {
      console.error(error);
      setStatusLine(String(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function uploadFiles(files: File[], targetDir: string, source: string) {
    if (!connection) {
      setStatusLine("先连上 SSH，再谈上传。");
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

  async function uploadWindowsClipboardFiles(targetDir: string) {
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
        setStatusLine("剪贴板里没拿到可上传的本地文件。截图粘贴走浏览器通道，Explorer 复制文件走原生通道。");
        return;
      }

      const firstImagePath = results.find((item) => isImagePreviewPath(item.path))?.path ?? "";
      setStatusLine(results[results.length - 1]?.message ?? `已上传到 ${targetDir}`);
      await loadDirectory(targetDir);

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

  async function pasteClipboard() {
    if (!preview || preview.kind !== "Text") {
      setStatusLine("这里现在不是文本编辑器。文件或截图直接 Ctrl+V，会走上传。");
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

    return targetEntry.isDir && targetEntry.canWrite && targetEntry.canEnter;
  }

  function openFileActionDialog(mode: FileActionMode) {
    if (!treeContextMenu) {
      return;
    }

    const initialName = mode === "rename" ? treeContextMenu.entry?.name ?? "" : "";
    const dangerText =
      mode === "delete"
        ? treeContextMenu.entry?.isDir
          ? "会递归删除整个目录，里面的文件也一起没了。"
          : "删除后不会自动回来，别手滑。"
        : "";

    setFileActionDialog({
      mode,
      targetDir: treeContextMenu.targetDir,
      entry: treeContextMenu.entry,
      name: initialName,
      errors: {},
      busy: false,
      dangerText
    });
    closeTreeContextMenu();
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
        throw new Error("当前操作缺少目标，别拿空气走流程。");
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
      setStatusLine(`复制失败：${label}没写进剪贴板。`);
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
      setStatusLine(`目标 ${targetDir} 当前不可写，别往没权限的目录硬怼上传。`);
      return;
    }

    const files = extractTransferFiles(event.dataTransfer);
    if (!files.length) {
      setDragTargetPath("");
      setStatusLine("拖进来的不是文件，别拿空气糊弄上传。");
      return;
    }

    await uploadFiles(files, targetDir, "拖拽");
  }

  function renderTree(path: string, level = 0): JSX.Element[] {
    const entries = entriesByPath[path] ?? [];
    return entries.flatMap((entry) => {
      const expanded = Boolean(expandedPaths[entry.path]);
      const dropTargetDir = resolveUploadTargetDir(entry, currentPath || "/");
      const children = entry.isDir && expanded ? renderTree(entry.path, level + 1) : [];

      return [
        <button
          className={`tree-row ${currentPath === entry.path ? "active" : ""} ${dragTargetPath === dropTargetDir ? "drag-over" : ""} ${(!entry.canRead || (entry.isDir && !entry.canEnter)) ? "restricted" : ""}`}
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
          title={`${entry.isDir ? `拖文件到这里，上传到 ${entry.path}` : `拖文件到这里，上传到 ${dropTargetDir}`} · ${entryAccessLabel(entry)} · 权限 ${formatPermissions(entry.permissions)}`}
        >
          <span className="tree-toggle">{entry.isDir ? (expanded ? "▾" : "▸") : ""}</span>
          <span className={`file-icon ${entry.isDir ? "dir" : "file"}`} aria-hidden="true" />
          <span className="tree-main">
            <span className="tree-name">{entry.name}</span>
            <span className="tree-submeta">
              {entry.isDir ? "目录" : "文件"} · {entryAccessLabel(entry)} · {formatModifiedAt(entry.modifiedAt)}
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
        ? `${connection.name} 的常驻终端`
        : "等待建立 SSH 会话"
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
  const updateButtonLabel = isInstallingUpdate
    ? "更新中..."
    : isCheckingUpdate
      ? "检查中..."
      : updateInfo?.available && updateInfo.version
        ? `升级 ${updateInfo.version}`
        : "检查更新";
  const updateButtonTitle = updateInfo?.available
    ? [updateInfo.message, updateInfo.notes].filter(Boolean).join("\n\n")
    : `当前版本 ${appVersion || "--"}`;
  const currentEntries = currentPath ? entriesByPath[currentPath] ?? [] : entriesByPath["/"] ?? [];
  const currentDirCount = currentEntries.filter((entry) => entry.isDir).length;
  const currentFileCount = currentEntries.filter((entry) => !entry.isDir).length;
  const searchScopeLabel =
    activeWorkspace === "terminal" ? "终端输出" : preview?.kind === "Text" ? "文本预览" : "当前面板";
  const searchCounterLabel = searchResultCount ? `${searchActiveIndex + 1} / ${searchResultCount}` : "0 / 0";
  const historyLabel = historySelection || commandDraft.trim() || commandHistory[0] || "历史命令";

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

      <div
        className="corner-toolbar glass-panel drag-region"
        onMouseDown={(event) => void startWindowDragging(event)}
        onDoubleClick={(event) => {
          if (isWindowDragBlockedTarget(event.target) || isWindowFullscreen) {
            return;
          }
          void toggleWindowMaximize();
        }}
      >
        <div className="toolbar-host">
          <span className={`host-status-dot ${connection ? "live" : ""}`} aria-hidden="true" />
          <div className="toolbar-host-meta">
            <strong>{connection?.name ?? "尚未连接"}</strong>
            <span>{connectionHostText}</span>
          </div>
          <div className="toolbar-host-chips">
            <span className="basic-chip">{basicStatusLabel}</span>
            <span className="basic-chip">{connection?.osLabel ?? "Remote Host"}</span>
            <span className="basic-chip">{basicLatencyLabel}</span>
            <span className={`basic-chip ${updateInfo?.available ? "update-chip-live" : ""}`}>{versionLabel}</span>
            <div className="detail-hover">
              <button className="ghost-button small detail-button" disabled={!connection}>
                主机详情
              </button>
              {connection ? (
                <div className="detail-card">
                  <div className="detail-card-grid">
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
                      <span>CPU / 内存</span>
                      <strong>待接入实时采集</strong>
                    </div>
                    <div className="detail-item">
                      <span>最近状态</span>
                      <strong>{statusLine}</strong>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="corner-actions">
          <button className="ghost-button small" onClick={() => setIsConnectModalOpen(true)}>
            {connection ? "连接配置" : "去连接"}
          </button>
          <button
            className="ghost-button small"
            disabled={!connection}
            onClick={() =>
              void uploadWindowsClipboardFiles(currentPath || connection?.homePath || "/")
            }
          >
            上传
          </button>
          <button className="ghost-button small" disabled={!connection} onClick={() => void goParent()}>
            上一级
          </button>
          <button
            className="ghost-button small"
            disabled={!connection || !currentPath}
            onClick={() => void loadDirectory(currentPath)}
          >
            {isListing ? "刷新中..." : "刷新"}
          </button>
          <button
            className={`ghost-button small update-button ${updateInfo?.available ? "update-ready" : ""}`}
            disabled={isCheckingUpdate || isInstallingUpdate}
            onClick={() => void (updateInfo?.available ? installAppUpdate() : checkAppUpdate())}
            title={updateButtonTitle}
          >
            {updateButtonLabel}
          </button>
          <button
            className="ghost-button small"
            onClick={() => void toggleWindowFullscreen()}
            title={isWindowFullscreen ? "退出全屏" : "全屏"}
          >
            {isWindowFullscreen ? "退出全屏" : "全屏"}
          </button>
          <div className="window-controls">
            <button className="window-button" onClick={() => void minimizeWindow()} title="最小化">
              _
            </button>
            <button
              className="window-button"
              onClick={() => void toggleWindowMaximize()}
              title={isWindowMaximized ? "还原" : "最大化"}
            >
              {isWindowMaximized ? "❐" : "□"}
            </button>
            <button className="window-button danger" onClick={() => void closeWindow()} title="关闭">
              ×
            </button>
          </div>
        </div>
      </div>

      <div className="workbench">
        <aside className="navigator-panel glass-panel">
          <div className="navigator-head">
            <div className="brand-card sidebar-brand compact-brand">
              <BrandLogo />
              <div className="brand-copy">
                <h1>FShell</h1>
                <span>Modern SSH Workspace</span>
              </div>
            </div>
          </div>

          <section className="tree-shell">
            <div
              className={`file-list ${dragTargetPath === (currentPath || connection?.homePath || "/") ? "drop-ready" : ""}`}
              onDragOver={(event) =>
                handleTreeDragOver(event, currentPath || connection?.homePath || "/")
              }
              onDragLeave={(event) =>
                handleTreeDragLeave(event, currentPath || connection?.homePath || "/")
              }
              onDrop={(event) => void handleTreeDrop(event, null)}
              onContextMenu={(event) =>
                openTreeContextMenu(
                  event,
                  null,
                  currentPath || connection?.homePath || "/",
                  currentPath || connection?.homePath || "/"
                )
              }
            >
              {connection && entriesByPath["/"]?.length ? (
                <>
                  <div className="tree-header">
                    <span>{currentPath || "/"}</span>
                    <span>
                      {isUploading ? "上传中..." : `${currentDirCount} 个目录 · ${currentFileCount} 个文件`}
                    </span>
                  </div>
                  <div className="tree-drop-hint">
                    拖到目录节点就上传到对应目录。`Ctrl + V` 能吃截图，Windows 复制文件后也能点“贴文件”。
                  </div>
                  {renderTree("/")}
                </>
              ) : (
                <div className="empty-state tree-empty-state">
                  <strong>{connection ? "当前目录没有内容" : "先连接 SSH"}</strong>
                  <p>
                    {connection
                      ? "可能目录为空，也可能你没权限。拖文件进来或直接粘贴，也会按当前目录上传。"
                      : "连上之后这里就是常驻文件树，不再让连接表单霸着左边。"}
                  </p>
                </div>
              )}
            </div>
          </section>

        </aside>

        <main className="workspace-panel">
          <section className="glass-panel workspace-card">
            <div className="workspace-tabs">
              <div className="tab-switcher">
                <button
                  className={`tab-button ${activeWorkspace === "terminal" ? "active" : ""}`}
                  onClick={() => setActiveWorkspace("terminal")}
                >
                  常驻终端
                </button>
                <button
                  className={`tab-button ${activeWorkspace === "preview" ? "active" : ""}`}
                  onClick={() => setActiveWorkspace("preview")}
                >
                  文件预览
                </button>
              </div>
              <div className="mini-actions">
                {activeWorkspace === "preview" ? (
                  <>
                    <button
                      className="ghost-button small"
                      disabled={!preview || preview.kind !== "Text" || preview.readonly}
                      onClick={() => void pasteClipboard()}
                    >
                      贴文本
                    </button>
                    <button
                      className="primary-button small-primary"
                      disabled={!preview || preview.kind !== "Text" || preview.readonly || isSaving}
                      onClick={() => void savePreview()}
                    >
                      {preview?.readonly ? "只读" : isSaving ? "保存中..." : "保存"}
                    </button>
                  </>
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
                    ? `${preview?.language ?? preview?.kind ?? "无预览"} · ${selectedEntry ? formatPermissions(selectedEntry.permissions) : "--"}${preview?.readonly ? " · 只读" : ""}`
                    : "Interactive Shell"}
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
                {preview?.kind === "Text" ? (
                  <textarea
                    ref={editorRef}
                    className={`editor ${preview.readonly ? "readonly-editor" : ""}`}
                    spellCheck={false}
                    readOnly={preview.readonly}
                    value={editorContent}
                    onChange={(event) => setEditorContent(event.target.value)}
                  />
                ) : preview?.kind === "Image" && preview.content ? (
                  <div className="image-preview-shell">
                    <img className="image-preview" src={preview.content} alt={preview.path} />
                  </div>
                ) : previewError ? (
                  <div className="empty-state preview-state error-state">
                    <strong>无法预览</strong>
                    <p>{previewError}</p>
                  </div>
                ) : (
                  <div className="empty-state preview-state">
                    <strong>{preview?.path ?? "选择一个远端文件"}</strong>
                    <p>
                      {preview
                        ? preview.kind === "Binary"
                          ? "这是二进制文件，不适合直接按文本硬怼。"
                          : `当前文件类型是 ${preview.kind}，后面可以继续接更专门的渲染器。`
                        : "点左边文件树里的文件，这里会切到预览页签并显示真实内容。"}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {activeWorkspace === "terminal" ? (
              <div className="bottom-toolbar">
                <div className="toolbar-group command-group">
                  <div className="history-dropdown" ref={historyMenuRef}>
                    <button
                      className="toolbar-button history-trigger"
                      disabled={!commandHistory.length}
                      onClick={() => setIsHistoryMenuOpen((previous) => !previous)}
                      title={historySelection || "历史命令"}
                    >
                      <span className="history-trigger-text">
                        {historyLabel}
                      </span>
                      <span className={`history-caret ${isHistoryMenuOpen ? "open" : ""}`}>▾</span>
                    </button>
                    {isHistoryMenuOpen && commandHistory.length ? (
                      <div className="history-menu glass-panel">
                        <div className="history-menu-header">
                          <strong>最近命令</strong>
                          <span>{commandHistory.length} 条</span>
                        </div>
                        {commandHistory.map((command) => (
                          <button
                            key={command}
                            className={`history-option ${historySelection === command ? "active" : ""}`}
                            onClick={() => {
                              setIsHistoryMenuOpen(false);
                              void fillTerminalCommand(command);
                            }}
                            title={command}
                          >
                            <span className="history-option-command">{command}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <button
                    className="toolbar-button"
                    disabled={!connection || !commandDraft.trim()}
                    onClick={() => void clearCurrentCommand()}
                  >
                    清空当前行
                  </button>
                  <button
                    className="toolbar-button"
                    disabled={!connection || activeWorkspace !== "terminal"}
                    onClick={() => void requestTabCompletion()}
                  >
                    Tab 补全
                  </button>
                  <button
                    className="toolbar-button accent"
                    disabled={!connection || !commandDraft.trim()}
                    onClick={() => void executeTerminalCommand()}
                  >
                    执行当前行
                  </button>
                </div>

                <div className="toolbar-group search-group">
                  <input
                    ref={searchInputRef}
                    className="toolbar-input search-input"
                    placeholder={`查找${searchScopeLabel}`}
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    onKeyDown={(event) => {
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
                  />
                  <button
                    className="toolbar-button icon-button"
                    disabled={!searchResultCount}
                    onClick={() => jumpSearch(-1)}
                    title="上一个匹配"
                  >
                    ↑
                  </button>
                  <button
                    className="toolbar-button icon-button"
                    disabled={!searchResultCount}
                    onClick={() => jumpSearch(1)}
                    title="下一个匹配"
                  >
                    ↓
                  </button>
                  <span className="toolbar-counter">{searchCounterLabel}</span>
                </div>

                <div className="toolbar-group utility-group">
                  <button className="toolbar-button" onClick={() => clearSearch()}>
                    清空查找
                  </button>
                  <button
                    className="toolbar-button"
                    disabled={!connection || activeWorkspace !== "terminal"}
                    onClick={() => void clearTerminal()}
                  >
                    Clear
                  </button>
                  <span className="toolbar-hint">Ctrl + F</span>
                  <span className="toolbar-status" title={statusLine}>
                    {statusLine}
                  </span>
                </div>
              </div>
            ) : null}
          </section>
        </main>
      </div>

      {treeContextMenu ? (
        <div
          ref={treeContextMenuRef}
          className="tree-context-menu glass-panel"
          style={{ left: treeContextMenu.x, top: treeContextMenu.y }}
        >
          <div className="tree-context-menu-head">
            <strong>{treeContextMenu.entry?.name ?? treeContextMenu.targetLabel}</strong>
            <span>{treeContextMenu.entry ? entryAccessLabel(treeContextMenu.entry) : "当前目录"}</span>
          </div>

          {treeContextMenu.entry?.isDir ? (
            <button
              className="context-action"
              disabled={!canOpenDirectory(treeContextMenu.entry)}
              onClick={() => {
                closeTreeContextMenu();
                void openEntry(treeContextMenu.entry!);
              }}
            >
              打开目录
            </button>
          ) : treeContextMenu.entry ? (
            <button
              className="context-action"
              disabled={!canPreviewEntry(treeContextMenu.entry)}
              onClick={() => {
                closeTreeContextMenu();
                void openEntry(treeContextMenu.entry!);
              }}
            >
              预览文件
            </button>
          ) : null}

          <button
            className="context-action"
            disabled={!connection || !canCreateInDirectory(treeContextMenu.targetDir)}
            onClick={() => openFileActionDialog("new-file")}
          >
            新建文件
          </button>

          <button
            className="context-action"
            disabled={!connection || !canCreateInDirectory(treeContextMenu.targetDir)}
            onClick={() => openFileActionDialog("new-directory")}
          >
            新建目录
          </button>

          {treeContextMenu.entry ? (
            <button
              className="context-action"
              disabled={!canManageEntry(treeContextMenu.entry)}
              onClick={() => openFileActionDialog("rename")}
            >
              重命名
            </button>
          ) : null}

          <button
            className="context-action"
            disabled={!connection || !canDownloadEntry(treeContextMenu.entry, treeContextMenu.targetDir)}
            onClick={() => {
              const target = resolveDownloadTarget(treeContextMenu.entry, treeContextMenu.targetDir);
              void downloadRemoteTarget(target.remotePath, target.suggestedName, target.isDir);
            }}
          >
            {treeContextMenu.entry
              ? treeContextMenu.entry.isDir
                ? "下载目录"
                : "下载文件"
              : "下载当前目录"}
          </button>

          <button
            className="context-action"
            disabled={!connection}
            onClick={() => {
              closeTreeContextMenu();
              void loadDirectory(treeContextMenu.targetDir);
            }}
          >
            刷新这里
          </button>

          <button
            className="context-action"
            disabled={!connection}
            onClick={() => void jumpTerminalToPath(treeContextMenu.targetDir)}
          >
            在终端进入这里
          </button>

          <button
            className="context-action"
            disabled={!canUploadToEntry(treeContextMenu.entry)}
            onClick={() => void pasteClipboardToTarget(treeContextMenu.targetDir)}
          >
            贴文件到这里
          </button>

          <button
            className="context-action"
            onClick={() => void copyTextToClipboard(treeContextMenu.targetDir, "路径")}
          >
            复制路径
          </button>

          {treeContextMenu.entry ? (
            <button
              className="context-action"
              onClick={() => void copyTextToClipboard(treeContextMenu.entry!.name, "文件名")}
            >
              复制名称
            </button>
          ) : null}

          {treeContextMenu.entry ? (
            <button
              className="context-action danger-action"
              disabled={!canManageEntry(treeContextMenu.entry)}
              onClick={() => openFileActionDialog("delete")}
            >
              删除
            </button>
          ) : null}
        </div>
      ) : null}

      {fileActionDialog ? (
        <div className="modal-backdrop">
          <section className="glass-panel connect-dialog action-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="section-title">
              <div>
                <p className="eyebrow">File Action</p>
                <h2>{fileActionTitle(fileActionDialog.mode)}</h2>
              </div>
              <span className={`status-pill ${fileActionDialog.mode === "delete" ? "" : "live"}`}>
                {fileActionDialog.entry ? fileActionDialog.entry.name : fileActionDialog.targetDir}
              </span>
            </div>

            {fileActionDialog.mode === "delete" ? (
              <div className="form-alert error-alert">
                <strong>确认删除</strong>
                <span>
                  即将删除 `{fileActionDialog.entry?.path}`。{fileActionDialog.dangerText}
                </span>
              </div>
            ) : (
              <label className={`field ${fileActionDialog.errors.name ? "has-error" : ""}`}>
                <span>
                  {fileActionDialog.mode === "rename" ? "新的名称" : "名称"}
                </span>
                <input
                  ref={fileActionInputRef}
                  placeholder={fileActionDialog.mode === "new-file" ? "例如 index.html" : "输入名称"}
                  value={fileActionDialog.name}
                  onChange={(event) =>
                    setFileActionDialog((previous) =>
                      previous
                        ? {
                            ...previous,
                            name: event.target.value,
                            errors: { ...previous.errors, name: undefined }
                          }
                        : previous
                    )
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void submitFileActionDialog();
                    }
                  }}
                />
                {fileActionDialog.errors.name ? <small>{fileActionDialog.errors.name}</small> : null}
              </label>
            )}

            <div className="list-block action-dialog-meta">
              <div className="path-chip subtle">{fileActionDialog.targetDir}</div>
              {fileActionDialog.entry ? (
                <div className="path-chip subtle">{fileActionDialog.entry.path}</div>
              ) : null}
            </div>

            <div className="action-row">
              <button
                className={`primary-button ${fileActionDialog.mode === "delete" ? "danger-primary" : ""}`}
                disabled={fileActionDialog.busy}
                onClick={() => void submitFileActionDialog()}
              >
                {fileActionConfirmLabel(fileActionDialog.mode, fileActionDialog.busy)}
              </button>
              <button
                className="ghost-button"
                disabled={fileActionDialog.busy}
                onClick={() => closeFileActionDialog()}
              >
                取消
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {isConnectModalOpen ? (
        <div className="modal-backdrop">
          <section className="glass-panel connect-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="section-title">
              <div>
                <p className="eyebrow">Connection</p>
                <h2>连接配置</h2>
              </div>
              <span className={`status-pill ${connection ? "live" : ""}`}>
                {connection ? "已在线" : "待连接"}
              </span>
            </div>

            {connectError ? (
              <div className="form-alert error-alert">
                <strong>连接失败</strong>
                <span>{connectError}</span>
              </div>
            ) : null}

            <label className={`field ${connectFieldErrors.name ? "has-error" : ""}`}>
              <span>连接名称</span>
              <input
                value={form.name}
                onChange={(event) => {
                  const value = event.target.value;
                  setForm((prev) => ({ ...prev, name: value }));
                  setConnectError("");
                  setConnectFieldErrors((prev) => ({ ...prev, name: undefined }));
                }}
              />
              {connectFieldErrors.name ? <small>{connectFieldErrors.name}</small> : null}
            </label>

            <label className={`field ${connectFieldErrors.host ? "has-error" : ""}`}>
              <span>主机地址</span>
              <input
                placeholder="例如 192.168.1.20 或 example.com"
                value={form.host}
                onChange={(event) => {
                  const value = event.target.value;
                  setForm((prev) => ({ ...prev, host: value }));
                  setConnectError("");
                  setConnectFieldErrors((prev) => ({ ...prev, host: undefined }));
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void connect();
                  }
                }}
              />
              {connectFieldErrors.host ? <small>{connectFieldErrors.host}</small> : null}
            </label>

            <div className="field-row">
              <label className={`field ${connectFieldErrors.port ? "has-error" : ""}`}>
                <span>端口</span>
                <input
                  value={form.port}
                  onChange={(event) => {
                    const value = event.target.value;
                    setForm((prev) => ({ ...prev, port: value }));
                    setConnectError("");
                    setConnectFieldErrors((prev) => ({ ...prev, port: undefined }));
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void connect();
                    }
                  }}
                />
                {connectFieldErrors.port ? <small>{connectFieldErrors.port}</small> : null}
              </label>
              <label className={`field ${connectFieldErrors.username ? "has-error" : ""}`}>
                <span>用户名</span>
                <input
                  value={form.username}
                  onChange={(event) => {
                    const value = event.target.value;
                    setForm((prev) => ({ ...prev, username: value }));
                    setConnectError("");
                    setConnectFieldErrors((prev) => ({ ...prev, username: undefined }));
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void connect();
                    }
                  }}
                />
                {connectFieldErrors.username ? <small>{connectFieldErrors.username}</small> : null}
              </label>
            </div>

            <label className={`field ${connectFieldErrors.password ? "has-error" : ""}`}>
              <span>密码</span>
              <input
                type="password"
                value={form.password}
                onChange={(event) => {
                  const value = event.target.value;
                  setForm((prev) => ({ ...prev, password: value }));
                  setConnectError("");
                  setConnectFieldErrors((prev) => ({ ...prev, password: undefined }));
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void connect();
                  }
                }}
              />
              {connectFieldErrors.password ? <small>{connectFieldErrors.password}</small> : null}
            </label>

            <div className="action-row">
              <button className="primary-button" disabled={isConnecting} onClick={() => void connect()}>
                {isConnecting ? "连接中..." : "建立 SSH 会话"}
              </button>
              <button className="ghost-button" onClick={() => setIsConnectModalOpen(false)}>
                关闭
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default App;
