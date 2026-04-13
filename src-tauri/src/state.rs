use std::{
    collections::HashMap,
    sync::{mpsc::Sender, Mutex},
};

use ssh2::Session;

use crate::models::ConnectionSummary;

#[derive(Debug, Clone)]
pub struct StoredConnection {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub home_path: String,
    pub user_uid: Option<u32>,
    pub group_ids: Vec<u32>,
    pub summary: ConnectionSummary,
}

#[derive(Debug)]
pub enum TerminalCommand {
    Input(String),
    Resize { cols: u16, rows: u16 },
    Close,
}

#[derive(Debug)]
pub struct TerminalHandle {
    pub sender: Sender<TerminalCommand>,
}

#[derive(Default)]
pub struct AppState {
    pub connection: Mutex<Option<StoredConnection>>,
    pub file_session: Mutex<Option<Session>>,
    pub terminals: Mutex<HashMap<String, TerminalHandle>>,
    pub current_path: Mutex<Option<String>>,
    pub recent_files: Mutex<Vec<String>>,
}
