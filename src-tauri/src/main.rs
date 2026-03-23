#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod models;
mod state;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        })
        .manage(state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::get_shell_overview,
            commands::check_app_update,
            commands::install_app_update,
            commands::connect_ssh,
            commands::disconnect_ssh,
            commands::send_terminal_input,
            commands::resize_terminal,
            commands::read_remote_dir,
            commands::preview_remote_file,
            commands::save_remote_file,
            commands::upload_remote_file,
            commands::upload_windows_clipboard_files,
            commands::download_remote_entry,
            commands::create_remote_directory,
            commands::create_remote_file,
            commands::rename_remote_entry,
            commands::delete_remote_entry
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
