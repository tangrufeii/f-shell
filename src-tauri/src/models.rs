use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectRequest {
    pub name: Option<String>,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSummary {
    pub id: String,
    pub name: String,
    pub host: String,
    pub protocol: String,
    pub status: String,
    pub latency_ms: u64,
    pub os_label: String,
    pub home_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified_at: Option<u64>,
    pub permissions: Option<u32>,
    pub can_read: bool,
    pub can_write: bool,
    pub can_enter: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellOverview {
    pub connection: Option<ConnectionSummary>,
    pub current_path: Option<String>,
    pub favorites: Vec<String>,
    pub recent_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteProcessStat {
    pub command: String,
    pub cpu_percent: f64,
    pub memory_percent: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSystemSnapshot {
    pub cpu_percent: f64,
    pub cpu_core_count: u32,
    pub cpu_model: String,
    pub load_average: Vec<f64>,
    pub uptime_seconds: u64,
    pub memory_total_bytes: u64,
    pub memory_available_bytes: u64,
    pub memory_used_bytes: u64,
    pub memory_usage_percent: f64,
    pub root_total_bytes: u64,
    pub root_available_bytes: u64,
    pub root_used_bytes: u64,
    pub root_usage_percent: f64,
    pub root_mount_path: String,
    pub root_file_system_type: String,
    pub network_rx_bytes_per_sec: f64,
    pub network_tx_bytes_per_sec: f64,
    pub top_processes: Vec<RemoteProcessStat>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePreview {
    pub path: String,
    pub kind: String,
    pub language: Option<String>,
    pub content: Option<String>,
    pub readonly: bool,
    pub size: usize,
    pub preview_bytes: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResponse {
    pub path: String,
    pub bytes_written: usize,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadResponse {
    pub path: String,
    pub bytes_written: usize,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadResponse {
    pub remote_path: String,
    pub local_path: String,
    pub bytes_written: u64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileActionResponse {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateInfo {
    pub current_version: String,
    pub available: bool,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub pub_date: Option<String>,
    pub target: Option<String>,
    pub download_url: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateInstallResponse {
    pub version: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateFeedInfo {
    pub endpoint: String,
    pub version: Option<String>,
    pub pub_date: Option<String>,
    pub download_url: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateProgress {
    pub stage: String,
    pub message: String,
    pub version: Option<String>,
    pub downloaded_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
    pub progress_percent: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalChunk {
    pub terminal_id: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalStatus {
    pub terminal_id: String,
    pub kind: String,
    pub message: String,
    pub connection_lost: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionSummary {
    pub id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProgress {
    pub stage: String,
    pub message: String,
    pub detail: Option<String>,
    pub current_step: u8,
    pub total_steps: u8,
    pub is_error: bool,
}
