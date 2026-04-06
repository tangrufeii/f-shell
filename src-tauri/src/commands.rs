use std::{
    env,
    fs,
    io::{ErrorKind, Read, Write},
    net::{TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    sync::{mpsc, MutexGuard},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use rfd::FileDialog;
use serde::Deserialize;
use ssh2::{FileStat, OpenFlags, OpenType, Session};
use tauri::{AppHandle, Emitter, Manager, State};
#[cfg(desktop)]
use tauri_plugin_updater::UpdaterExt;
use url::Url;

use crate::{
    models::{
        AppUpdateFeedInfo, AppUpdateInfo, AppUpdateInstallResponse, AppUpdateProgress, ConnectRequest,
        ConnectionProgress, ConnectionSummary, DownloadResponse, FileActionResponse, FilePreview,
        RemoteEntry, SaveResponse, ShellOverview, TerminalChunk, TerminalStatus, UploadResponse,
    },
    state::{AppState, StoredConnection, TerminalCommand, TerminalHandle},
};

const TEXT_PREVIEW_LIMIT: u64 = 512 * 1024;
const IMAGE_PREVIEW_LIMIT: u64 = 12 * 1024 * 1024;
const SSH_CONNECT_TIMEOUT: Duration = Duration::from_secs(6);
const SSH_IO_TIMEOUT: Duration = Duration::from_secs(12);
const CONNECT_TOTAL_STEPS: u8 = 5;

#[tauri::command]
pub async fn inspect_update_feed(endpoint: String) -> Result<AppUpdateFeedInfo, String> {
    tauri::async_runtime::spawn_blocking(move || inspect_update_feed_blocking(&endpoint))
        .await
        .map_err(|error| format!("更新源诊断任务被中断了: {error}"))?
}

#[tauri::command]
pub async fn check_app_update(app: AppHandle) -> Result<AppUpdateInfo, String> {
    #[cfg(desktop)]
    {
        let current_version = app.package_info().version.to_string();
        let updater = build_updater(&app)?;
        let update = updater.check().await.map_err(humanize_updater_error)?;

        if let Some(update) = update {
            return Ok(AppUpdateInfo {
                current_version,
                available: true,
                version: Some(update.version.clone()),
                notes: update.body.clone(),
                pub_date: update.date.map(|value| value.to_string()),
                target: None,
                download_url: None,
                message: format!("发现新版本 {}，可以开始安装。", update.version),
            });
        }

        return Ok(AppUpdateInfo {
            current_version: current_version.clone(),
            available: false,
            version: None,
            notes: None,
            pub_date: None,
            target: None,
            download_url: None,
            message: format!("当前已经是最新版本 {current_version}。"),
        });
    }

    #[allow(unreachable_code)]
    Err("当前平台不支持在线更新。".to_string())
}

fn inspect_update_feed_blocking(endpoint: &str) -> Result<AppUpdateFeedInfo, String> {
    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct UpdateFeedPlatform {
        url: Option<String>,
    }

    #[derive(Debug, Deserialize)]
    struct UpdateFeedManifest {
        version: Option<String>,
        pub_date: Option<String>,
        platforms: Option<std::collections::HashMap<String, UpdateFeedPlatform>>,
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|error| format!("更新源诊断客户端初始化失败: {error}"))?;

    let response = client
        .get(endpoint)
        .header(reqwest::header::USER_AGENT, "FShell Update Inspector")
        .send()
        .map_err(humanize_updater_error)?;

    if !response.status().is_success() {
        return Err(format!("更新源返回了异常状态 {}。", response.status()));
    }

    let manifest = response
        .json::<UpdateFeedManifest>()
        .map_err(|error| format!("更新源 latest.json 解析失败: {error}"))?;

    let download_url = manifest
        .platforms
        .as_ref()
        .and_then(|items| items.values().find_map(|item| item.url.clone()));

    Ok(AppUpdateFeedInfo {
        endpoint: endpoint.to_string(),
        version: manifest.version.clone(),
        pub_date: manifest.pub_date.clone(),
        download_url,
        message: manifest
            .version
            .as_ref()
            .map(|version| format!("更新源当前指向 v{version}。"))
            .unwrap_or_else(|| "更新源已响应，但 latest.json 里没带版本号。".to_string()),
    })
}

#[tauri::command]
pub async fn install_app_update(app: AppHandle) -> Result<AppUpdateInstallResponse, String> {
    #[cfg(desktop)]
    {
        emit_update_progress(
            &app,
            AppUpdateProgress {
                stage: "preparing".into(),
                message: "正在确认远端更新信息...".into(),
                version: None,
                downloaded_bytes: Some(0),
                total_bytes: None,
                progress_percent: Some(0.0),
            },
        );
        let updater = build_updater(&app)?;
        let update = updater.check().await.map_err(humanize_updater_error)?;
        let Some(update) = update else {
            let current_version = app.package_info().version.to_string();
            emit_update_progress(
                &app,
                AppUpdateProgress {
                    stage: "idle".into(),
                    message: format!("当前已经是最新版本 {current_version}。"),
                    version: Some(current_version.clone()),
                    downloaded_bytes: Some(0),
                    total_bytes: Some(0),
                    progress_percent: Some(100.0),
                },
            );
            return Ok(AppUpdateInstallResponse {
                version: current_version.clone(),
                message: format!("当前已经是最新版本 {current_version}，不用重复安装。"),
            });
        };

        let target_version = update.version.clone();
        let download_app = app.clone();
        let install_app = app.clone();
        let downloading_version = target_version.clone();
        let installing_version = target_version.clone();
        emit_update_progress(
            &app,
            AppUpdateProgress {
                stage: "downloading".into(),
                message: format!("开始下载更新 {target_version} ..."),
                version: Some(target_version.clone()),
                downloaded_bytes: Some(0),
                total_bytes: None,
                progress_percent: Some(0.0),
            },
        );
        update
            .download_and_install(
                move |downloaded_bytes, total_bytes| {
                    let downloaded_bytes = downloaded_bytes as u64;
                    let progress_percent = total_bytes.and_then(|total| {
                        if total > 0 {
                            Some((downloaded_bytes as f64 / total as f64) * 100.0)
                        } else {
                            None
                        }
                    });
                    let message = if let Some(total) = total_bytes {
                        format!(
                            "正在下载更新 {downloading_version} · {downloaded_bytes}/{total} bytes"
                        )
                    } else {
                        format!("正在下载更新 {downloading_version} ...")
                    };
                    emit_update_progress(
                        &download_app,
                        AppUpdateProgress {
                            stage: "downloading".into(),
                            message,
                            version: Some(downloading_version.clone()),
                            downloaded_bytes: Some(downloaded_bytes),
                            total_bytes,
                            progress_percent,
                        },
                    );
                },
                move || {
                    emit_update_progress(
                        &install_app,
                        AppUpdateProgress {
                            stage: "installing".into(),
                            message: format!("下载完成，正在安装 {installing_version} ..."),
                            version: Some(installing_version.clone()),
                            downloaded_bytes: None,
                            total_bytes: None,
                            progress_percent: Some(100.0),
                        },
                    );
                },
            )
            .await
            .map_err(humanize_updater_error)?;

        emit_update_progress(
            &app,
            AppUpdateProgress {
                stage: "completed".into(),
                message: format!("更新 {target_version} 已安装，应用准备重启。"),
                version: Some(target_version.clone()),
                downloaded_bytes: None,
                total_bytes: None,
                progress_percent: Some(100.0),
            },
        );
        app.request_restart();

        return Ok(AppUpdateInstallResponse {
            version: target_version.clone(),
            message: format!("更新 {target_version} 已安装，应用准备重启。"),
        });
    }

    #[allow(unreachable_code)]
    Err("当前平台不支持在线更新。".to_string())
}

#[tauri::command]
pub fn get_shell_overview(state: State<'_, AppState>) -> Result<ShellOverview, String> {
    let connection = state.connection.lock().map_err(|_| "连接状态锁坏了".to_string())?;
    let current_path = state
        .current_path
        .lock()
        .map_err(|_| "路径状态锁坏了".to_string())?
        .clone();
    let recent_files = state
        .recent_files
        .lock()
        .map_err(|_| "最近文件状态锁坏了".to_string())?
        .clone();

    let favorites = if let Some(active) = connection.as_ref() {
        vec![
            active.home_path.clone(),
            format!("{}/.bashrc", active.home_path),
            format!("{}/.zshrc", active.home_path),
            "/etc/nginx/nginx.conf".into(),
        ]
    } else {
        Vec::new()
    };

    Ok(ShellOverview {
        connection: connection.as_ref().map(|item| item.summary.clone()),
        current_path,
        favorites,
        recent_files,
    })
}

#[tauri::command]
pub async fn connect_ssh(app: AppHandle, request: ConnectRequest) -> Result<ConnectionSummary, String> {
    let blocking_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || connect_ssh_blocking(blocking_app, request))
        .await
        .map_err(|error| format!("连接任务被中断了: {error}"))?
}

#[tauri::command]
pub fn disconnect_ssh(state: State<'_, AppState>) -> Result<(), String> {
    clear_connection_state(&state)?;
    Ok(())
}

fn connect_ssh_blocking(app: AppHandle, request: ConnectRequest) -> Result<ConnectionSummary, String> {
    let state = app.state::<AppState>();
    clear_connection_state(&state)?;
    let result: Result<ConnectionSummary, String> = (|| {
        emit_connection_progress(
            &app,
            ConnectionProgress {
                stage: "tcp".into(),
                message: "正在建立 TCP 连接...".into(),
                detail: Some(format!(
                    "{}:{} · 最多等待 {} 秒",
                    request.host,
                    request.port,
                    SSH_CONNECT_TIMEOUT.as_secs()
                )),
                current_step: 1,
                total_steps: CONNECT_TOTAL_STEPS,
                is_error: false,
            },
        );

        let started_at = Instant::now();
        let session = create_authenticated_session(&app, &request)?;
        emit_connection_progress(
            &app,
            ConnectionProgress {
                stage: "prepare".into(),
                message: "正在读取远端环境信息...".into(),
                detail: Some("获取主目录和权限范围，给文件树与编辑器做初始化。".into()),
                current_step: 4,
                total_steps: CONNECT_TOTAL_STEPS,
                is_error: false,
            },
        );

        let home_path = resolve_home_path(&session)?;
        let (user_uid, group_ids) = resolve_remote_identity(&session).unwrap_or((None, Vec::new()));
        let summary = ConnectionSummary {
            id: format!(
                "ssh-{}",
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map_err(|error| error.to_string())?
                    .as_millis()
            ),
            name: request
                .name
                .clone()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| format!("{}@{}", request.username, request.host)),
            host: format!("{}:{}", request.host, request.port),
            protocol: "SSH + SFTP".into(),
            status: "Connected".into(),
            latency_ms: started_at.elapsed().as_millis() as u64,
            os_label: "Remote Linux".into(),
            home_path: home_path.clone(),
        };

        emit_connection_progress(
            &app,
            ConnectionProgress {
                stage: "terminal".into(),
                message: "正在启动交互终端...".into(),
                detail: Some("PTY 建好后就能开始收发命令。".into()),
                current_step: 5,
                total_steps: CONNECT_TOTAL_STEPS,
                is_error: false,
            },
        );

        let mut channel = session.channel_session().map_err(to_error)?;
        channel
            .request_pty(
                "xterm-256color",
                None,
                Some((u32::from(request.cols), u32::from(request.rows), 0, 0)),
            )
            .map_err(to_error)?;
        channel.shell().map_err(to_error)?;
        session.set_blocking(false);

        let (tx, rx) = mpsc::channel::<TerminalCommand>();
        spawn_terminal_worker(app.clone(), session, channel, rx);

        let stored = StoredConnection {
            host: request.host.clone(),
            port: request.port,
            username: request.username.clone(),
            password: request.password.clone(),
            home_path: home_path.clone(),
            user_uid,
            group_ids,
            summary: summary.clone(),
        };

        *lock_connection(&state)? = Some(stored);
        *state
            .terminal
            .lock()
            .map_err(|_| "终端状态锁坏了".to_string())? = Some(TerminalHandle { sender: tx });
        *state
            .current_path
            .lock()
            .map_err(|_| "路径状态锁坏了".to_string())? = Some(home_path);
        *state
            .recent_files
            .lock()
            .map_err(|_| "最近文件状态锁坏了".to_string())? = Vec::new();

        emit_connection_progress(
            &app,
            ConnectionProgress {
                stage: "ready".into(),
                message: format!("已连接到 {}", summary.host),
                detail: Some(format!(
                    "往返耗时约 {} ms，远端主目录是 {}",
                    summary.latency_ms, summary.home_path
                )),
                current_step: CONNECT_TOTAL_STEPS,
                total_steps: CONNECT_TOTAL_STEPS,
                is_error: false,
            },
        );

        Ok(summary)
    })();

    if let Err(message) = &result {
        emit_connection_progress(
            &app,
            ConnectionProgress {
                stage: "error".into(),
                message: "SSH 连接失败".into(),
                detail: Some(message.clone()),
                current_step: 0,
                total_steps: CONNECT_TOTAL_STEPS,
                is_error: true,
            },
        );
    }

    result
}

fn clear_connection_state(state: &State<'_, AppState>) -> Result<(), String> {
    if let Some(handle) = state
        .terminal
        .lock()
        .map_err(|_| "终端状态锁坏了".to_string())?
        .take()
    {
        let _ = handle.sender.send(TerminalCommand::Close);
    }

    *lock_connection(&state)? = None;
    *state
        .current_path
        .lock()
        .map_err(|_| "路径状态锁坏了".to_string())? = None;
    Ok(())
}

#[tauri::command]
pub fn send_terminal_input(state: State<'_, AppState>, data: String) -> Result<(), String> {
    let terminal = state
        .terminal
        .lock()
        .map_err(|_| "终端状态锁坏了".to_string())?;

    let handle = terminal
        .as_ref()
        .ok_or_else(|| "当前没有活动 SSH 会话。".to_string())?;

    handle
        .sender
        .send(TerminalCommand::Input(data))
        .map_err(|_| "终端会话已经断了。".to_string())
}

#[tauri::command]
pub fn resize_terminal(state: State<'_, AppState>, cols: u16, rows: u16) -> Result<(), String> {
    let terminal = state
        .terminal
        .lock()
        .map_err(|_| "终端状态锁坏了".to_string())?;

    let handle = terminal
        .as_ref()
        .ok_or_else(|| "当前没有活动 SSH 会话。".to_string())?;

    handle
        .sender
        .send(TerminalCommand::Resize { cols, rows })
        .map_err(|_| "终端会话已经断了。".to_string())
}

#[tauri::command]
pub fn read_remote_dir(state: State<'_, AppState>, path: String) -> Result<Vec<RemoteEntry>, String> {
    let connection = active_connection(&state)?;
    let normalized_path = normalize_remote_path(&path);
    let session = connect_from_stored(&connection)?;
    let sftp = session.sftp().map_err(to_error)?;
    let mut entries = sftp
        .readdir(Path::new(&normalized_path))
        .map_err(to_error)?
        .into_iter()
        .filter_map(|(entry_path, stat)| map_entry(&entry_path, &stat, &connection))
        .collect::<Vec<_>>();

    entries.sort_by(|left, right| {
        right
            .is_dir
            .cmp(&left.is_dir)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    *state
        .current_path
        .lock()
        .map_err(|_| "路径状态锁坏了".to_string())? = Some(normalized_path);

    Ok(entries)
}

#[tauri::command]
pub fn preview_remote_file(
    state: State<'_, AppState>,
    path: String,
) -> Result<FilePreview, String> {
    let connection = active_connection(&state)?;
    let session = connect_from_stored(&connection)?;
    let sftp = session.sftp().map_err(to_error)?;
    let stat = sftp.stat(Path::new(&path)).map_err(to_error)?;

    remember_recent_file(&state, &path)?;

    let lower = path.to_lowercase();
    if lower.ends_with(".png")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".gif")
        || lower.ends_with(".bmp")
        || lower.ends_with(".svg")
        || lower.ends_with(".webp")
    {
        let size = stat.size.unwrap_or_default();
        if size > IMAGE_PREVIEW_LIMIT {
            return Err(format!(
                "图片 `{path}` 体积过大（{} bytes），当前预览上限是 {} bytes。",
                size, IMAGE_PREVIEW_LIMIT
            ));
        }

        let file = sftp
            .open(Path::new(&path))
            .map_err(|error| format!("读取图片 `{path}` 失败: {}", to_error(error)))?;
        let mut bytes = Vec::new();
        file.take(IMAGE_PREVIEW_LIMIT)
            .read_to_end(&mut bytes)
            .map_err(|error| format!("读取图片 `{path}` 失败: {error}"))?;

        return Ok(FilePreview {
            path,
            kind: "Image".into(),
            language: None,
            content: Some(format!(
                "data:{};base64,{}",
                image_mime_type(&lower),
                STANDARD.encode(bytes)
            )),
            readonly: true,
            size: size as usize,
        });
    }

    if lower.ends_with(".pdf") {
        return Ok(FilePreview {
            path,
            kind: "Pdf".into(),
            language: None,
            content: None,
            readonly: true,
            size: stat.size.unwrap_or_default() as usize,
        });
    }

    if lower.ends_with(".img")
        || lower.ends_with(".iso")
        || lower.ends_with(".bin")
        || lower.ends_with(".dmg")
        || lower.ends_with(".vmdk")
        || lower.ends_with(".qcow2")
    {
        return Ok(FilePreview {
            path,
            kind: "Binary".into(),
            language: None,
            content: None,
            readonly: true,
            size: stat.size.unwrap_or_default() as usize,
        });
    }

    let file = sftp
        .open(Path::new(&path))
        .map_err(|error| format!("读取 `{path}` 失败: {}。可能是权限不足，或者这不是可直接读取的普通文件。", to_error(error)))?;
    let mut content = Vec::new();
    file.take(TEXT_PREVIEW_LIMIT)
        .read_to_end(&mut content)
        .map_err(|error| error.to_string())?;

    match String::from_utf8(content) {
        Ok(text) => Ok(FilePreview {
            path: path.clone(),
            kind: "Text".into(),
            language: detect_language(&path),
            readonly: !can_write_entry(&stat, &connection),
            size: text.len(),
            content: Some(text),
        }),
        Err(_) => Ok(FilePreview {
            path,
            kind: "Binary".into(),
            language: None,
            content: None,
            readonly: true,
            size: stat.size.unwrap_or_default() as usize,
        }),
    }
}

#[tauri::command]
pub fn save_remote_file(
    state: State<'_, AppState>,
    path: String,
    content: String,
) -> Result<SaveResponse, String> {
    let connection = active_connection(&state)?;
    let session = connect_from_stored(&connection)?;
    let sftp = session.sftp().map_err(to_error)?;
    let mut file = sftp
        .create(Path::new(&path))
        .map_err(|error| explain_remote_write_error("创建", &path, error))?;

    file.write_all(content.as_bytes())
        .map_err(|error| explain_remote_write_error("写入", &path, error))?;
    file.flush()
        .map_err(|error| explain_remote_write_error("刷新", &path, error))?;
    remember_recent_file(&state, &path)?;

    Ok(SaveResponse {
        path: path.clone(),
        bytes_written: content.len(),
        message: format!("远端文件已保存: {path}"),
    })
}

#[tauri::command]
pub fn upload_remote_file(
    state: State<'_, AppState>,
    remote_dir: String,
    filename: String,
    base64_data: String,
) -> Result<UploadResponse, String> {
    let sanitized_name = sanitize_upload_filename(&filename)?;
    let remote_path = join_remote_path(&remote_dir, &sanitized_name);
    let payload = STANDARD
        .decode(base64_data.as_bytes())
        .map_err(|error| format!("上传文件 `{sanitized_name}` 失败：base64 解码错误，{error}"))?;

    let connection = active_connection(&state)?;
    let session = connect_from_stored(&connection)?;
    let sftp = session.sftp().map_err(to_error)?;
    write_remote_payload(&sftp, &remote_path, &payload)?;

    *state
        .current_path
        .lock()
        .map_err(|_| "路径状态锁坏了".to_string())? = Some(remote_dir.clone());
    remember_recent_file(&state, &remote_path)?;

    Ok(UploadResponse {
        path: remote_path.clone(),
        bytes_written: payload.len(),
        message: format!("已上传 `{sanitized_name}` 到 `{remote_dir}`"),
    })
}

#[tauri::command]
pub fn upload_windows_clipboard_files(
    state: State<'_, AppState>,
    remote_dir: String,
) -> Result<Vec<UploadResponse>, String> {
    #[cfg(not(windows))]
    {
        let _ = state;
        let _ = remote_dir;
        Err("当前系统暂不支持原生文件剪贴板上传。".into())
    }

    #[cfg(windows)]
    {
        let clipboard_items = windows_clipboard::read_clipboard_items()?;
        if clipboard_items.is_empty() {
            return Ok(Vec::new());
        }

        let connection = active_connection(&state)?;
        let session = connect_from_stored(&connection)?;
        let sftp = session.sftp().map_err(to_error)?;
        let mut responses = Vec::new();

        for item in clipboard_items {
            let (sanitized_name, payload, message) = match item {
                windows_clipboard::ClipboardItem::LocalFile(local_path) => {
                    if !local_path.is_file() {
                        continue;
                    }

                    let filename = local_path
                        .file_name()
                        .and_then(|value| value.to_str())
                        .ok_or_else(|| format!("本地文件名非法，没法上传：{}", local_path.display()))?;
                    let sanitized_name = sanitize_upload_filename(filename)?;
                    let payload = std::fs::read(&local_path).map_err(|error| {
                        format!("读取本地文件 `{}` 失败: {error}", local_path.display())
                    })?;
                    (
                        sanitized_name,
                        payload,
                        format!("已从 Windows 剪贴板上传 `{filename}` 到 `{remote_dir}`"),
                    )
                }
                windows_clipboard::ClipboardItem::Image { filename, payload } => {
                    let sanitized_name = sanitize_upload_filename(&filename)?;
                    (
                        sanitized_name,
                        payload,
                        format!("已从 Windows 剪贴板上传图片 `{filename}` 到 `{remote_dir}`"),
                    )
                }
            };

            let remote_path = join_remote_path(&remote_dir, &sanitized_name);
            write_remote_payload(&sftp, &remote_path, &payload)?;
            remember_recent_file(&state, &remote_path)?;

            responses.push(UploadResponse {
                path: remote_path,
                bytes_written: payload.len(),
                message,
            });
        }

        *state
            .current_path
            .lock()
            .map_err(|_| "路径状态锁坏了".to_string())? = Some(remote_dir.clone());

        Ok(responses)
    }
}

#[tauri::command]
pub fn download_remote_entry(
    state: State<'_, AppState>,
    remote_path: String,
    suggested_name: String,
    is_dir: bool,
) -> Result<DownloadResponse, String> {
    let connection = active_connection(&state)?;
    let session = connect_from_stored(&connection)?;
    let sftp = session.sftp().map_err(to_error)?;

    let destination = if is_dir {
        let folder = FileDialog::new()
            .set_title("选择目录下载位置")
            .pick_folder()
            .ok_or_else(|| "已取消目录下载。".to_string())?;
        folder.join(sanitize_local_name(&suggested_name))
    } else {
        FileDialog::new()
            .set_title("保存远端文件")
            .set_file_name(&sanitize_local_name(&suggested_name))
            .save_file()
            .ok_or_else(|| "已取消文件下载。".to_string())?
    };

    let final_destination = unique_local_destination(destination);
    let bytes_written = if is_dir {
        download_remote_directory_recursive(&sftp, Path::new(&remote_path), &final_destination)?
    } else {
        download_remote_file_to_path(&sftp, Path::new(&remote_path), &final_destination)?
    };

    Ok(DownloadResponse {
        remote_path: remote_path.clone(),
        local_path: final_destination.to_string_lossy().to_string(),
        bytes_written,
        message: format!("已下载 `{remote_path}` 到 `{}`", final_destination.display()),
    })
}

#[tauri::command]
pub fn create_remote_directory(
    state: State<'_, AppState>,
    parent_dir: String,
    name: String,
) -> Result<FileActionResponse, String> {
    let validated_name = validate_remote_entry_name(&name)?;
    let remote_dir = join_remote_path(&parent_dir, &validated_name);
    let connection = active_connection(&state)?;
    let session = connect_from_stored(&connection)?;
    let sftp = session.sftp().map_err(to_error)?;

    sftp.mkdir(Path::new(&remote_dir), 0o755)
        .map_err(|error| explain_remote_manage_error("创建目录", &remote_dir, error))?;

    Ok(FileActionResponse {
        path: remote_dir.clone(),
        message: format!("已创建目录 `{remote_dir}`"),
    })
}

#[tauri::command]
pub fn create_remote_file(
    state: State<'_, AppState>,
    parent_dir: String,
    name: String,
) -> Result<FileActionResponse, String> {
    let validated_name = validate_remote_entry_name(&name)?;
    let remote_path = join_remote_path(&parent_dir, &validated_name);
    let connection = active_connection(&state)?;
    let session = connect_from_stored(&connection)?;
    let sftp = session.sftp().map_err(to_error)?;
    let mut file = sftp
        .open_mode(
            Path::new(&remote_path),
            OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::EXCLUSIVE,
            0o644,
            OpenType::File,
        )
        .map_err(|error| explain_remote_manage_error("创建文件", &remote_path, error))?;

    file.flush()
        .map_err(|error| explain_remote_manage_error("刷新文件", &remote_path, error))?;

    Ok(FileActionResponse {
        path: remote_path.clone(),
        message: format!("已创建文件 `{remote_path}`"),
    })
}

#[tauri::command]
pub fn rename_remote_entry(
    state: State<'_, AppState>,
    path: String,
    new_name: String,
) -> Result<FileActionResponse, String> {
    let source_path = normalize_remote_path(&path);
    let validated_name = validate_remote_entry_name(&new_name)?;
    let parent_dir = parent_remote_path(&source_path);
    let target_path = join_remote_path(&parent_dir, &validated_name);

    if source_path == target_path {
        return Ok(FileActionResponse {
            path: target_path.clone(),
            message: format!("名称没变，`{target_path}` 不需要重命名。"),
        });
    }

    let connection = active_connection(&state)?;
    let session = connect_from_stored(&connection)?;
    let sftp = session.sftp().map_err(to_error)?;

    sftp.rename(Path::new(&source_path), Path::new(&target_path), None)
        .map_err(|error| explain_remote_manage_error("重命名", &source_path, error))?;

    Ok(FileActionResponse {
        path: target_path.clone(),
        message: format!("已将 `{source_path}` 重命名为 `{target_path}`"),
    })
}

#[tauri::command]
pub fn delete_remote_entry(
    state: State<'_, AppState>,
    path: String,
    is_dir: bool,
) -> Result<FileActionResponse, String> {
    let remote_path = normalize_remote_path(&path);
    let connection = active_connection(&state)?;
    let session = connect_from_stored(&connection)?;
    let sftp = session.sftp().map_err(to_error)?;

    if is_dir {
        remove_remote_directory_recursive(&sftp, Path::new(&remote_path))?;
    } else {
        sftp.unlink(Path::new(&remote_path))
            .map_err(|error| explain_remote_manage_error("删除文件", &remote_path, error))?;
    }

    Ok(FileActionResponse {
        path: remote_path.clone(),
        message: format!("已删除 `{remote_path}`"),
    })
}

fn spawn_terminal_worker(
    app: AppHandle,
    _session: Session,
    mut channel: ssh2::Channel,
    rx: mpsc::Receiver<TerminalCommand>,
) {
    thread::spawn(move || {
        let _ = app.emit(
            "terminal-status",
            TerminalStatus {
                kind: "connected".into(),
                message: "SSH 会话已建立".into(),
            },
        );

        let mut buffer = [0_u8; 8192];
        loop {
            match channel.read(&mut buffer) {
                Ok(size) if size > 0 => {
                    let payload = String::from_utf8_lossy(&buffer[..size]).to_string();
                    let _ = app.emit("terminal-chunk", TerminalChunk { data: payload });
                }
                Ok(_) => {}
                Err(error) if error.kind() == ErrorKind::WouldBlock => {}
                Err(error) => {
                    let _ = app.emit(
                        "terminal-status",
                        TerminalStatus {
                            kind: "error".into(),
                            message: format!("终端读取失败: {error}"),
                        },
                    );
                    break;
                }
            }

            match rx.try_recv() {
                Ok(TerminalCommand::Input(data)) => {
                    if let Err(error) = write_until_ready(&mut channel, data.as_bytes()) {
                        let _ = app.emit(
                            "terminal-status",
                            TerminalStatus {
                                kind: "error".into(),
                                message: format!("终端写入失败: {error}"),
                            },
                        );
                        break;
                    }
                }
                Ok(TerminalCommand::Resize { cols, rows }) => {
                    if let Err(error) = channel.request_pty_size(
                        u32::from(cols),
                        u32::from(rows),
                        Some(0),
                        Some(0),
                    ) {
                        let _ = app.emit(
                            "terminal-status",
                            TerminalStatus {
                                kind: "warning".into(),
                                message: format!("终端尺寸更新失败: {}", to_error(error)),
                            },
                        );
                    }
                }
                Ok(TerminalCommand::Close) => {
                    let _ = channel.close();
                    break;
                }
                Err(mpsc::TryRecvError::Empty) => {}
                Err(mpsc::TryRecvError::Disconnected) => break,
            }

            if channel.eof() {
                break;
            }

            thread::sleep(Duration::from_millis(12));
        }

        let _ = app.emit(
            "terminal-status",
            TerminalStatus {
                kind: "closed".into(),
                message: "SSH 会话已关闭".into(),
            },
        );
    });
}

fn write_until_ready(channel: &mut ssh2::Channel, payload: &[u8]) -> Result<(), String> {
    let mut sent = 0;
    while sent < payload.len() {
        match channel.write(&payload[sent..]) {
            Ok(size) => sent += size,
            Err(error) if error.kind() == ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(8));
            }
            Err(error) => return Err(error.to_string()),
        }
    }

    channel.flush().map_err(|error| error.to_string())
}

fn sanitize_local_name(name: &str) -> String {
    let trimmed = name.trim();
    let fallback = if trimmed.is_empty() { "download" } else { trimmed };

    fallback
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            _ => ch,
        })
        .collect()
}

fn unique_local_destination(initial: PathBuf) -> PathBuf {
    if !initial.exists() {
        return initial;
    }

    let parent = initial.parent().map(Path::to_path_buf).unwrap_or_default();
    let stem = initial
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("download");
    let ext = initial.extension().and_then(|value| value.to_str()).unwrap_or("");

    for index in 1..10_000 {
        let candidate_name = if ext.is_empty() {
            format!("{stem}-{index}")
        } else {
            format!("{stem}-{index}.{ext}")
        };
        let candidate = parent.join(candidate_name);
        if !candidate.exists() {
            return candidate;
        }
    }

    initial
}

fn create_authenticated_session(app: &AppHandle, request: &ConnectRequest) -> Result<Session, String> {
    create_authenticated_session_inner(request, Some(app))
}

fn create_authenticated_session_silent(request: &ConnectRequest) -> Result<Session, String> {
    create_authenticated_session_inner(request, None)
}

fn create_authenticated_session_inner(
    request: &ConnectRequest,
    app: Option<&AppHandle>,
) -> Result<Session, String> {
    let tcp = connect_tcp_stream(request)?;
    tcp.set_read_timeout(Some(SSH_IO_TIMEOUT))
        .map_err(|error| format!("设置 TCP 读取超时失败: {error}"))?;
    tcp.set_write_timeout(Some(SSH_IO_TIMEOUT))
        .map_err(|error| format!("设置 TCP 写入超时失败: {error}"))?;

    if let Some(app) = app {
        emit_connection_progress(
            app,
            ConnectionProgress {
                stage: "handshake".into(),
                message: "正在进行 SSH 握手...".into(),
                detail: Some(
                    "这一步卡住通常是服务端没响应、被防火墙拦了，或者网络质量太烂。".into(),
                ),
                current_step: 2,
                total_steps: CONNECT_TOTAL_STEPS,
                is_error: false,
            },
        );
    }

    let mut session = Session::new().map_err(to_error)?;
    session.set_timeout(SSH_IO_TIMEOUT.as_millis() as u32);
    session.set_tcp_stream(tcp);
    session
        .handshake()
        .map_err(|error| explain_ssh_handshake_error(&request.host, request.port, error))?;

    if let Some(app) = app {
        emit_connection_progress(
            app,
            ConnectionProgress {
                stage: "auth".into(),
                message: "正在验证用户名和密码...".into(),
                detail: Some(format!("登录用户：{}", request.username)),
                current_step: 3,
                total_steps: CONNECT_TOTAL_STEPS,
                is_error: false,
            },
        );
    }

    session
        .userauth_password(&request.username, &request.password)
        .map_err(|error| explain_ssh_auth_error(&request.username, error))?;

    if !session.authenticated() {
        return Err("SSH 鉴权失败，请检查账号密码。".into());
    }

    Ok(session)
}

fn resolve_home_path(session: &Session) -> Result<String, String> {
    let sftp = session.sftp().map_err(to_error)?;
    let path = sftp.realpath(Path::new(".")).map_err(to_error)?;
    Ok(normalize_remote_path(&path.to_string_lossy()))
}

fn resolve_remote_identity(session: &Session) -> Result<(Option<u32>, Vec<u32>), String> {
    let output = run_remote_command(session, "id -u; id -G")?;
    let mut lines = output.lines();
    let user_uid = lines.next().and_then(|value| value.trim().parse::<u32>().ok());
    let group_ids = lines
        .next()
        .unwrap_or_default()
        .split_whitespace()
        .filter_map(|item| item.trim().parse::<u32>().ok())
        .collect::<Vec<_>>();

    Ok((user_uid, group_ids))
}

fn run_remote_command(session: &Session, command: &str) -> Result<String, String> {
    let mut channel = session.channel_session().map_err(to_error)?;
    channel.exec(command).map_err(to_error)?;

    let mut output = String::new();
    channel.read_to_string(&mut output).map_err(to_error)?;

    let mut stderr = String::new();
    channel.stderr().read_to_string(&mut stderr).map_err(to_error)?;
    channel.wait_close().map_err(to_error)?;

    if channel.exit_status().map_err(to_error)? != 0 {
        let details = stderr.trim();
        if details.is_empty() {
            return Err(format!("执行远端命令 `{command}` 失败。"));
        }
        return Err(format!("执行远端命令 `{command}` 失败: {details}"));
    }

    Ok(output)
}

fn download_remote_file_to_path(
    sftp: &ssh2::Sftp,
    remote_path: &Path,
    local_path: &Path,
) -> Result<u64, String> {
    if let Some(parent) = local_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建本地目录 `{}` 失败: {error}", parent.display()))?;
    }

    let mut remote_file = sftp
        .open(remote_path)
        .map_err(|error| format!("读取远端文件 `{}` 失败: {}", remote_path.display(), to_error(error)))?;
    let mut local_file = fs::File::create(local_path)
        .map_err(|error| format!("创建本地文件 `{}` 失败: {error}", local_path.display()))?;

    let mut buffer = [0_u8; 64 * 1024];
    let mut written = 0_u64;
    loop {
        let read = remote_file
            .read(&mut buffer)
            .map_err(|error| format!("下载远端文件 `{}` 失败: {error}", remote_path.display()))?;
        if read == 0 {
            break;
        }

        local_file
            .write_all(&buffer[..read])
            .map_err(|error| format!("写入本地文件 `{}` 失败: {error}", local_path.display()))?;
        written += read as u64;
    }

    Ok(written)
}

fn download_remote_directory_recursive(
    sftp: &ssh2::Sftp,
    remote_dir: &Path,
    local_dir: &Path,
) -> Result<u64, String> {
    fs::create_dir_all(local_dir)
        .map_err(|error| format!("创建本地目录 `{}` 失败: {error}", local_dir.display()))?;

    let entries = sftp
        .readdir(remote_dir)
        .map_err(|error| format!("读取远端目录 `{}` 失败: {}", remote_dir.display(), to_error(error)))?;

    let mut total = 0_u64;
    for (entry_path, stat) in entries {
        let Some(name) = entry_path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if name == "." || name == ".." {
            continue;
        }

        let local_child = local_dir.join(name);
        let is_dir = stat
            .perm
            .map(|perm| perm & 0o170000 == 0o040000)
            .unwrap_or(false);

        if is_dir {
            total += download_remote_directory_recursive(sftp, &entry_path, &local_child)?;
        } else {
            total += download_remote_file_to_path(sftp, &entry_path, &local_child)?;
        }
    }

    Ok(total)
}

fn connect_from_stored(connection: &StoredConnection) -> Result<Session, String> {
    create_authenticated_session_silent(&ConnectRequest {
        name: Some(connection.summary.name.clone()),
        host: connection.host.clone(),
        port: connection.port,
        username: connection.username.clone(),
        password: connection.password.clone(),
        cols: 120,
        rows: 32,
    })
}

fn can_write_entry(stat: &FileStat, connection: &StoredConnection) -> bool {
    let (_, can_write, _) = resolve_entry_access(stat, connection);
    can_write
}

fn detect_language(path: &str) -> Option<String> {
    let lower = path.to_lowercase();
    let value = if lower.ends_with(".rs") {
        "rust"
    } else if lower.ends_with(".ts") || lower.ends_with(".tsx") {
        "typescript"
    } else if lower.ends_with(".js") || lower.ends_with(".mjs") {
        "javascript"
    } else if lower.ends_with(".html") || lower.ends_with(".htm") {
        "html"
    } else if lower.ends_with(".css") || lower.ends_with(".scss") || lower.ends_with(".less") {
        "css"
    } else if lower.ends_with(".json") {
        "json"
    } else if lower.ends_with(".toml") {
        "toml"
    } else if lower.ends_with(".yml") || lower.ends_with(".yaml") {
        "yaml"
    } else if lower.ends_with(".xml") || lower.ends_with(".svg") {
        "xml"
    } else if lower.ends_with(".sh") {
        "shell"
    } else if lower.ends_with(".conf") {
        "nginx"
    } else if lower.ends_with(".md") {
        "markdown"
    } else if lower.ends_with(".env") {
        "dotenv"
    } else {
        "plaintext"
    };

    Some(value.into())
}

fn image_mime_type(path: &str) -> &'static str {
    if path.ends_with(".png") {
        "image/png"
    } else if path.ends_with(".jpg") || path.ends_with(".jpeg") {
        "image/jpeg"
    } else if path.ends_with(".gif") {
        "image/gif"
    } else if path.ends_with(".bmp") {
        "image/bmp"
    } else if path.ends_with(".svg") {
        "image/svg+xml"
    } else if path.ends_with(".webp") {
        "image/webp"
    } else {
        "application/octet-stream"
    }
}

fn write_remote_payload(sftp: &ssh2::Sftp, remote_path: &str, payload: &[u8]) -> Result<(), String> {
    let mut file = sftp
        .create(Path::new(remote_path))
        .map_err(|error| explain_remote_write_error("创建", remote_path, error))?;

    file.write_all(payload)
        .map_err(|error| explain_remote_write_error("写入", remote_path, error))?;
    file.flush()
        .map_err(|error| explain_remote_write_error("刷新", remote_path, error))?;
    Ok(())
}

fn sanitize_upload_filename(filename: &str) -> Result<String, String> {
    let trimmed = filename.trim();
    let candidate = trimmed
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(trimmed)
        .trim();

    if candidate.is_empty() {
        return Err("上传文件名为空，没法往远端写。".into());
    }

    if candidate.contains('\0') {
        return Err("上传文件名非法，里面带了空字符。".into());
    }

    Ok(candidate.to_string())
}

fn join_remote_path(dir: &str, filename: &str) -> String {
    let owned = normalize_remote_path(dir);
    let normalized = if owned.trim().is_empty() { "/" } else { owned.trim() };
    if normalized == "/" {
        format!("/{filename}")
    } else {
        format!("{}/{}", normalized.trim_end_matches('/'), filename)
    }
}

fn parent_remote_path(path: &str) -> String {
    let normalized = normalize_remote_path(path);
    if normalized == "/" {
        return "/".into();
    }

    let mut segments = normalized.split('/').filter(|segment| !segment.is_empty()).collect::<Vec<_>>();
    if segments.len() <= 1 {
        return "/".into();
    }

    segments.pop();
    format!("/{}", segments.join("/"))
}

fn normalize_remote_path(path: &str) -> String {
    let replaced = path.trim().replace('\\', "/");
    if replaced.is_empty() {
        return "/".into();
    }

    if replaced == "/" {
        return replaced;
    }

    let compact = replaced
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("/");

    if compact.is_empty() {
        "/".into()
    } else if replaced.starts_with('/') {
        format!("/{compact}")
    } else {
        compact
    }
}

fn validate_remote_entry_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("名称不能为空。".into());
    }

    if trimmed == "." || trimmed == ".." {
        return Err("名称不能是 `.` 或 `..`。".into());
    }

    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err("名称里不能带路径分隔符。".into());
    }

    if trimmed.contains('\0') {
        return Err("名称里不能带空字符。".into());
    }

    Ok(trimmed.to_string())
}

fn remember_recent_file(state: &State<'_, AppState>, path: &str) -> Result<(), String> {
    let mut recent_files = state
        .recent_files
        .lock()
        .map_err(|_| "最近文件状态锁坏了".to_string())?;

    recent_files.retain(|value| value != path);
    recent_files.insert(0, path.to_string());
    recent_files.truncate(6);
    Ok(())
}

fn active_connection(state: &State<'_, AppState>) -> Result<StoredConnection, String> {
    lock_connection(state)?
        .clone()
        .ok_or_else(|| "当前没有活动连接，请先登录 SSH。".to_string())
}

fn lock_connection<'a>(
    state: &'a State<'_, AppState>,
) -> Result<MutexGuard<'a, Option<StoredConnection>>, String> {
    state
        .connection
        .lock()
        .map_err(|_| "连接状态锁坏了".to_string())
}

fn map_entry(
    entry_path: &std::path::PathBuf,
    stat: &FileStat,
    connection: &StoredConnection,
) -> Option<RemoteEntry> {
    let normalized_path = normalize_remote_path(&entry_path.to_string_lossy());
    let name = normalized_path
        .rsplit('/')
        .next()
        .filter(|value| !value.is_empty())?
        .to_string();
    if name == "." || name == ".." {
        return None;
    }

    let permissions = stat.perm;
    let is_dir = permissions
        .map(|perm| perm & 0o170000 == 0o040000)
        .unwrap_or(false);
    let (can_read, can_write, can_enter) = resolve_entry_access(stat, connection);

    Some(RemoteEntry {
        name,
        path: normalized_path,
        is_dir,
        size: stat.size.unwrap_or_default(),
        modified_at: stat.mtime,
        permissions,
        can_read,
        can_write,
        can_enter,
    })
}

fn resolve_entry_access(stat: &FileStat, connection: &StoredConnection) -> (bool, bool, bool) {
    if connection.user_uid == Some(0) {
        return (true, true, true);
    }

    let Some(perm) = stat.perm else {
        return (true, true, true);
    };

    let scope_shift = if connection.user_uid.zip(stat.uid).is_some_and(|(left, right)| left == right) {
        6
    } else if stat
        .gid
        .is_some_and(|gid| connection.group_ids.iter().any(|item| *item == gid))
    {
        3
    } else {
        0
    };

    let access_bits = (perm >> scope_shift) & 0o7;
    let can_read = access_bits & 0o4 != 0;
    let can_write = access_bits & 0o2 != 0;
    let can_enter = access_bits & 0o1 != 0;

    (can_read, can_write, can_enter)
}

fn connect_tcp_stream(request: &ConnectRequest) -> Result<TcpStream, String> {
    let address = format!("{}:{}", request.host, request.port);
    let socket_addrs = address
        .to_socket_addrs()
        .map_err(|error| format!("解析主机 `{address}` 失败: {error}"))?
        .collect::<Vec<_>>();

    if socket_addrs.is_empty() {
        return Err(format!("主机 `{address}` 没解析出可用地址。"));
    }

    let mut last_error = None;
    for socket_addr in socket_addrs {
        match TcpStream::connect_timeout(&socket_addr, SSH_CONNECT_TIMEOUT) {
            Ok(stream) => return Ok(stream),
            Err(error) => last_error = Some(error),
        }
    }

    let rendered = last_error
        .map(|error| explain_tcp_connect_error(&address, error))
        .unwrap_or_else(|| format!("TCP 连接 `{address}` 失败，底层错误都没吐出来。"));
    Err(rendered)
}

fn to_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn explain_tcp_connect_error(address: &str, error: std::io::Error) -> String {
    match error.kind() {
        ErrorKind::TimedOut => format!(
            "TCP 连接 `{address}` 超时了。{} 秒内连不上，通常是主机不通、防火墙拦截，或者端口压根没开。",
            SSH_CONNECT_TIMEOUT.as_secs()
        ),
        ErrorKind::ConnectionRefused => {
            format!("TCP 连接 `{address}` 被拒绝。主机在线，但 SSH 服务可能没启动，或者端口写错了。")
        }
        ErrorKind::NotFound | ErrorKind::AddrNotAvailable => {
            format!("TCP 连接 `{address}` 失败：主机地址不可用。")
        }
        _ => format!("TCP 连接 `{address}` 失败: {error}"),
    }
}

fn explain_ssh_handshake_error(
    host: &str,
    port: u16,
    error: impl std::fmt::Display,
) -> String {
    let raw = error.to_string();
    let lower = raw.to_lowercase();

    if lower.contains("timed out") || lower.contains("timeout") {
        return format!(
            "SSH 握手 `{host}:{port}` 超时了。服务端可能太慢、被限流，或者网络已经烂到握手都完不成。原始错误：{raw}"
        );
    }

    if lower.contains("banner") {
        return format!(
            "SSH 握手 `{host}:{port}` 失败：服务端返回的 SSH banner 不对劲，端口可能根本不是 SSH。原始错误：{raw}"
        );
    }

    format!("SSH 握手 `{host}:{port}` 失败: {raw}")
}

fn explain_ssh_auth_error(username: &str, error: impl std::fmt::Display) -> String {
    let raw = error.to_string();
    let lower = raw.to_lowercase();

    if lower.contains("timed out") || lower.contains("timeout") {
        return format!(
            "SSH 鉴权超时了，用户 `{username}` 的登录请求没在限定时间内完成。网络慢、服务端负载高，或者安全策略在拖时间。原始错误：{raw}"
        );
    }

    if lower.contains("authentication failed")
        || lower.contains("username/password")
        || lower.contains("access denied")
    {
        return format!("SSH 鉴权失败，用户 `{username}` 的账号或密码不对。原始错误：{raw}");
    }

    format!("SSH 鉴权失败，用户 `{username}` 登录没过。原始错误：{raw}")
}

fn humanize_updater_error(error: impl std::fmt::Display) -> String {
    let raw = error.to_string();
    let lower = raw.to_lowercase();

    if lower.contains("example.com") || lower.contains("404") {
        return "在线更新已经接好，但更新源地址还是占位值。把 `src-tauri/tauri.conf.json` 里的 `plugins.updater.endpoints` 改成你自己发布 `latest.json` 的 HTTPS 地址再试。".to_string();
    }

    if lower.contains("pubkey") || lower.contains("public key") || lower.contains("signature") {
        return format!(
            "更新签名校验没过。检查 `plugins.updater.pubkey`、产物 `.sig` 文件和 `latest.json` 里的签名是不是同一套。原始错误：{raw}"
        );
    }

    if lower.contains("timeout")
        || lower.contains("dns")
        || lower.contains("connection")
        || lower.contains("network")
        || lower.contains("sending request")
        || lower.contains("tls handshake eof")
        || lower.contains("connection was reset")
    {
        return format!(
            "更新源连不上。当前默认直连 GitHub Releases，在中国网络环境下经常会失败。先检查代理是否生效，或者给应用配置本地代理后再试。原始错误：{raw}"
        );
    }

    raw
}

fn emit_update_progress(app: &AppHandle, payload: AppUpdateProgress) {
    let _ = app.emit("update-progress", payload);
}

fn emit_connection_progress(app: &AppHandle, payload: ConnectionProgress) {
    let _ = app.emit("connection-progress", payload);
}

#[cfg(desktop)]
fn build_updater(app: &AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    let mut builder = app.updater_builder().timeout(Duration::from_secs(18));
    if let Some(proxy) = resolve_updater_proxy() {
        builder = builder.proxy(proxy);
    }
    builder.build().map_err(humanize_updater_error)
}

#[cfg(desktop)]
fn resolve_updater_proxy() -> Option<Url> {
    let env_candidates = [
        "FSHELL_UPDATER_PROXY",
        "HTTPS_PROXY",
        "https_proxy",
        "HTTP_PROXY",
        "http_proxy",
        "ALL_PROXY",
        "all_proxy",
    ];

    for key in env_candidates {
        if let Some(value) = env::var_os(key).and_then(|value| value.into_string().ok()) {
            if let Some(proxy) = normalize_proxy_url(&value) {
                return Some(proxy);
            }
        }
    }

    if let Some(port) = read_maomaocloud_mixed_port() {
        let candidate = format!("http://127.0.0.1:{port}");
        if let Some(proxy) = proxy_if_reachable(&candidate) {
            return Some(proxy);
        }
    }

    for candidate in [
        "http://127.0.0.1:10090",
        "http://127.0.0.1:7890",
        "http://127.0.0.1:7891",
        "http://127.0.0.1:10809",
    ] {
        if let Some(proxy) = proxy_if_reachable(candidate) {
            return Some(proxy);
        }
    }

    None
}

#[cfg(desktop)]
fn read_maomaocloud_mixed_port() -> Option<u16> {
    let user_profile = env::var_os("USERPROFILE")?;
    let config_path = PathBuf::from(user_profile)
        .join(".config")
        .join("MAOMAOCLOUD")
        .join("config.yaml");
    let content = fs::read_to_string(config_path).ok()?;
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(value) = trimmed.strip_prefix("mixed-port:") {
            let value = value.trim().trim_matches('\'').trim_matches('"');
            if let Ok(port) = value.parse::<u16>() {
                return Some(port);
            }
        }
    }
    None
}

#[cfg(desktop)]
fn proxy_if_reachable(raw: &str) -> Option<Url> {
    let url = normalize_proxy_url(raw)?;
    let host = url.host_str()?;
    let port = url.port_or_known_default()?;
    let address = format!("{host}:{port}");
    let socket = address.parse().ok()?;
    if TcpStream::connect_timeout(&socket, Duration::from_millis(280)).is_ok() {
        return Some(url);
    }
    None
}

#[cfg(desktop)]
fn normalize_proxy_url(raw: &str) -> Option<Url> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Ok(url) = Url::parse(trimmed) {
        return Some(url);
    }

    Url::parse(&format!("http://{trimmed}")).ok()
}

fn explain_remote_write_error(
    action: &str,
    remote_path: &str,
    error: impl std::fmt::Display,
) -> String {
    let raw = error.to_string();
    let lower = raw.to_lowercase();

    if lower.contains("permission denied") {
        return format!(
            "{action}远端文件 `{remote_path}` 失败：当前 SSH 用户对这个目录没有写权限。\
试试上传到自己的家目录，或者先在服务器上给 `{remote_path}` 所在目录授权。SFTP 不能替你自动 sudo。原始错误：{raw}"
        );
    }

    if lower.contains("no such file") {
        return format!(
            "{action}远端文件 `{remote_path}` 失败：目标目录不存在，或者路径写错了。原始错误：{raw}"
        );
    }

    format!("{action}远端文件 `{remote_path}` 失败: {raw}")
}

fn explain_remote_manage_error(
    action: &str,
    remote_path: &str,
    error: impl std::fmt::Display,
) -> String {
    let raw = error.to_string();
    let lower = raw.to_lowercase();

    if lower.contains("permission denied") {
        return format!(
            "{action} `{remote_path}` 失败：当前 SSH 用户权限不够。别拿只读目录硬怼。原始错误：{raw}"
        );
    }

    if lower.contains("already exists") || lower.contains("failure") {
        return format!(
            "{action} `{remote_path}` 失败：目标可能已存在，或者服务端直接拒绝了这次操作。原始错误：{raw}"
        );
    }

    if lower.contains("no such file") {
        return format!(
            "{action} `{remote_path}` 失败：目标路径不存在，或者父目录已经没了。原始错误：{raw}"
        );
    }

    if lower.contains("not empty") {
        return format!("{action} `{remote_path}` 失败：目录里还有东西。原始错误：{raw}");
    }

    format!("{action} `{remote_path}` 失败：{raw}")
}

fn remove_remote_directory_recursive(sftp: &ssh2::Sftp, remote_dir: &Path) -> Result<(), String> {
    let entries = sftp
        .readdir(remote_dir)
        .map_err(|error| explain_remote_manage_error("读取目录", &remote_dir.display().to_string(), error))?;

    for (entry_path, stat) in entries {
        let normalized_path = normalize_remote_path(&entry_path.to_string_lossy());
        let name = normalized_path
            .rsplit('/')
            .next()
            .filter(|value| !value.is_empty())
            .unwrap_or_default();
        if name == "." || name == ".." {
            continue;
        }

        let is_dir = stat
            .perm
            .map(|perm| perm & 0o170000 == 0o040000)
            .unwrap_or(false);

        if is_dir {
            remove_remote_directory_recursive(sftp, Path::new(&normalized_path))?;
        } else {
            sftp.unlink(Path::new(&normalized_path))
                .map_err(|error| explain_remote_manage_error("删除文件", &normalized_path, error))?;
        }
    }

    let rendered_dir = remote_dir.display().to_string();
    sftp.rmdir(remote_dir)
        .map_err(|error| explain_remote_manage_error("删除目录", &rendered_dir, error))
}

#[cfg(windows)]
mod windows_clipboard {
    use std::{
        ffi::{c_void, OsString},
        mem,
        os::windows::ffi::OsStringExt,
        path::PathBuf,
        ptr,
        slice,
        time::{SystemTime, UNIX_EPOCH},
    };

    type Bool = i32;
    type Handle = *mut c_void;
    type Hdrop = Handle;
    type Hglobal = Handle;
    type Hwnd = *mut c_void;
    type Uint = u32;
    type SizeT = usize;

    const CF_HDROP: Uint = 15;
    const CF_DIB: Uint = 8;
    const CF_DIBV5: Uint = 17;
    const FILE_COUNT_QUERY: Uint = 0xFFFF_FFFF;
    const BI_BITFIELDS: u32 = 3;

    #[link(name = "user32")]
    unsafe extern "system" {
        fn OpenClipboard(new_owner: Hwnd) -> Bool;
        fn CloseClipboard() -> Bool;
        fn GetClipboardData(format: Uint) -> Handle;
        fn IsClipboardFormatAvailable(format: Uint) -> Bool;
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GlobalLock(memory: Hglobal) -> *mut c_void;
        fn GlobalUnlock(memory: Hglobal) -> Bool;
        fn GlobalSize(memory: Hglobal) -> SizeT;
    }

    #[link(name = "shell32")]
    unsafe extern "system" {
        fn DragQueryFileW(drop: Hdrop, index: Uint, file: *mut u16, length: Uint) -> Uint;
    }

    pub enum ClipboardItem {
        LocalFile(PathBuf),
        Image { filename: String, payload: Vec<u8> },
    }

    pub fn read_clipboard_items() -> Result<Vec<ClipboardItem>, String> {
        unsafe {
            let has_files = IsClipboardFormatAvailable(CF_HDROP) != 0;
            let has_image =
                IsClipboardFormatAvailable(CF_DIBV5) != 0 || IsClipboardFormatAvailable(CF_DIB) != 0;

            if !has_files && !has_image {
                return Ok(Vec::new());
            }

            if OpenClipboard(ptr::null_mut()) == 0 {
                return Err("打开 Windows 剪贴板失败。".into());
            }

            let result = if has_files {
                read_drop_file_list().map(|paths| {
                    paths.into_iter()
                        .map(ClipboardItem::LocalFile)
                        .collect::<Vec<_>>()
                })
            } else {
                read_bitmap_item().map(|item| item.into_iter().collect::<Vec<_>>())
            };
            let _ = CloseClipboard();
            result
        }
    }

    unsafe fn read_drop_file_list() -> Result<Vec<PathBuf>, String> {
        let handle = unsafe { GetClipboardData(CF_HDROP) };
        if handle.is_null() {
            return Ok(Vec::new());
        }

        let count = unsafe { DragQueryFileW(handle, FILE_COUNT_QUERY, ptr::null_mut(), 0) };
        let mut paths = Vec::with_capacity(count as usize);

        for index in 0..count {
            let length = unsafe { DragQueryFileW(handle, index, ptr::null_mut(), 0) };
            if length == 0 {
                continue;
            }

            let mut buffer = vec![0_u16; length as usize + 1];
            let written =
                unsafe { DragQueryFileW(handle, index, buffer.as_mut_ptr(), buffer.len() as Uint) };
            buffer.truncate(written as usize);
            paths.push(PathBuf::from(OsString::from_wide(&buffer)));
        }

        Ok(paths)
    }

    unsafe fn read_bitmap_item() -> Result<Option<ClipboardItem>, String> {
        let format = if unsafe { IsClipboardFormatAvailable(CF_DIBV5) } != 0 {
            CF_DIBV5
        } else if unsafe { IsClipboardFormatAvailable(CF_DIB) } != 0 {
            CF_DIB
        } else {
            return Ok(None);
        };

        let handle = unsafe { GetClipboardData(format) };
        if handle.is_null() {
            return Ok(None);
        }

        let size = unsafe { GlobalSize(handle) };
        if size == 0 {
            return Err("读取 Windows 剪贴板图片失败：位图数据为空。".into());
        }

        let pointer = unsafe { GlobalLock(handle) } as *const u8;
        if pointer.is_null() {
            return Err("读取 Windows 剪贴板图片失败：无法锁定位图数据。".into());
        }

        let dib = unsafe { slice::from_raw_parts(pointer, size) }.to_vec();
        let _ = unsafe { GlobalUnlock(handle) };
        let payload = build_bmp_file(&dib)?;

        Ok(Some(ClipboardItem::Image {
            filename: build_clipboard_image_name(),
            payload,
        }))
    }

    fn build_clipboard_image_name() -> String {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        format!("clipboard-{stamp}.bmp")
    }

    fn build_bmp_file(dib: &[u8]) -> Result<Vec<u8>, String> {
        if dib.len() < 16 {
            return Err("读取 Windows 剪贴板图片失败：位图头不完整。".into());
        }

        let header_size = read_u32_le(dib, 0)? as usize;
        if header_size < 40 || header_size > dib.len() {
            return Err("读取 Windows 剪贴板图片失败：位图头格式不支持。".into());
        }

        let bit_count = read_u16_le(dib, 14)? as usize;
        let compression = read_u32_le(dib, 16)?;
        let colors_used = if header_size >= 36 {
            read_u32_le(dib, 32)? as usize
        } else {
            0
        };

        let mask_bytes = if compression == BI_BITFIELDS && header_size == 40 {
            12
        } else {
            0
        };
        let palette_entries = if bit_count <= 8 {
            if colors_used > 0 {
                colors_used
            } else {
                1usize
                    .checked_shl(bit_count as u32)
                    .ok_or_else(|| "读取 Windows 剪贴板图片失败：调色板大小异常。".to_string())?
            }
        } else {
            0
        };
        let palette_bytes = palette_entries
            .checked_mul(mem::size_of::<u32>())
            .ok_or_else(|| "读取 Windows 剪贴板图片失败：调色板大小异常。".to_string())?;
        let pixel_offset = 14usize
            .checked_add(header_size)
            .and_then(|value| value.checked_add(mask_bytes))
            .and_then(|value| value.checked_add(palette_bytes))
            .ok_or_else(|| "读取 Windows 剪贴板图片失败：像素偏移异常。".to_string())?;

        if pixel_offset < 14 || pixel_offset - 14 > dib.len() {
            return Err("读取 Windows 剪贴板图片失败：位图像素偏移超出范围。".into());
        }

        let file_size = 14usize
            .checked_add(dib.len())
            .ok_or_else(|| "读取 Windows 剪贴板图片失败：位图大小异常。".to_string())?;
        let file_size_u32 = u32::try_from(file_size)
            .map_err(|_| "读取 Windows 剪贴板图片失败：位图体积过大。".to_string())?;
        let pixel_offset_u32 = u32::try_from(pixel_offset)
            .map_err(|_| "读取 Windows 剪贴板图片失败：位图偏移过大。".to_string())?;

        let mut payload = Vec::with_capacity(file_size);
        payload.extend_from_slice(b"BM");
        payload.extend_from_slice(&file_size_u32.to_le_bytes());
        payload.extend_from_slice(&[0_u8; 4]);
        payload.extend_from_slice(&pixel_offset_u32.to_le_bytes());
        payload.extend_from_slice(dib);
        Ok(payload)
    }

    fn read_u16_le(bytes: &[u8], offset: usize) -> Result<u16, String> {
        let chunk = bytes
            .get(offset..offset + 2)
            .ok_or_else(|| "读取 Windows 剪贴板图片失败：位图字段越界。".to_string())?;
        Ok(u16::from_le_bytes([chunk[0], chunk[1]]))
    }

    fn read_u32_le(bytes: &[u8], offset: usize) -> Result<u32, String> {
        let chunk = bytes
            .get(offset..offset + 4)
            .ok_or_else(|| "读取 Windows 剪贴板图片失败：位图字段越界。".to_string())?;
        Ok(u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
    }
}
