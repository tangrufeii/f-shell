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
pub struct FilePreview {
    pub path: String,
    pub kind: String,
    pub language: Option<String>,
    pub content: Option<String>,
    pub readonly: bool,
    pub size: usize,
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
pub struct TerminalChunk {
    pub data: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalStatus {
    pub kind: String,
    pub message: String,
}
