mod cli;
mod constants;
#[cfg(target_os = "linux")]
pub mod linux_display;
#[cfg(target_os = "linux")]
pub mod linux_windowing;
mod logging;
mod markdown;
mod os;
mod server;
mod store_update;
mod window_customizer;
mod windows;

use crate::cli::CommandChild;
use futures::{FutureExt, TryFutureExt};
use std::{
    collections::HashMap,
    env,
    future::Future,
    net::TcpListener,
    path::PathBuf,
    process::Command,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Listener, Manager, RunEvent, State, ipc::Channel};
#[cfg(any(target_os = "linux", windows))]
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_specta::Event;
use tokio::{
    sync::{oneshot, watch},
    time::{sleep, timeout},
};

use crate::cli::{sqlite_migration::SqliteMigrationProgress, sync_cli};
use crate::constants::*;
use crate::windows::{LoadingWindow, MainWindow};

#[derive(Clone, serde::Serialize, specta::Type, Debug)]
struct ServerReadyData {
    url: String,
    username: Option<String>,
    password: Option<String>,
}

#[derive(Clone, Copy, serde::Serialize, specta::Type, Debug)]
#[serde(tag = "phase", rename_all = "snake_case")]
enum InitStep {
    ServerWaiting,
    SqliteWaiting,
    Done,
}

#[derive(serde::Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
enum WslPathMode {
    Windows,
    Linux,
}

struct InitState {
    current: watch::Receiver<InitStep>,
}

struct ServerState {
    child: Arc<Mutex<Option<CommandChild>>>,
}

#[derive(Default)]
struct EmbeddedWebviews {
    views: Mutex<HashMap<String, tauri::Webview>>,
}

#[derive(serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
struct EmbeddedWebviewBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// Resolves with sidecar credentials as soon as the sidecar is spawned (before health check).
struct SidecarReady(futures::future::Shared<oneshot::Receiver<ServerReadyData>>);

#[tauri::command]
#[specta::specta]
async fn embedded_webview_open(
    app: AppHandle,
    state: State<'_, EmbeddedWebviews>,
    id: String,
    url: String,
    bounds: EmbeddedWebviewBounds,
    visible: bool,
) -> Result<(), String> {
    close_embedded_webview(&app, &state, &id);
    std::thread::sleep(Duration::from_millis(75));

    let parsed: tauri::Url = url
        .parse()
        .map_err(|e| format!("Invalid embedded webview URL: {e}"))?;
    let window = app
        .get_window(MainWindow::LABEL)
        .ok_or_else(|| "Main window not found".to_string())?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {e}"))?
        .join("embedded-webviews")
        .join(sanitize_embedded_webview_id(&id));
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create embedded webview data directory: {e}"))?;

    let create_view = || {
        window.add_child(
            tauri::webview::WebviewBuilder::new(id.clone(), tauri::WebviewUrl::External(parsed.clone()))
                .data_directory(data_dir.clone())
                .disable_drag_drop_handler()
                .focused(visible),
            tauri::LogicalPosition::new(bounds.x, bounds.y),
            tauri::LogicalSize::new(bounds.width, bounds.height),
        )
    };
    let view = match create_view() {
        Ok(view) => view,
        Err(error) if error.to_string().contains("already exists") => {
            close_embedded_webview(&app, &state, &id);
            std::thread::sleep(Duration::from_millis(150));
            create_view().map_err(|e| format!("Failed to create embedded webview: {e}"))?
        }
        Err(error) => return Err(format!("Failed to create embedded webview: {error}")),
    };

    if visible {
        let _ = view.show();
        let _ = view.set_focus();
    } else {
        let _ = view.hide();
    }

    state
        .views
        .lock()
        .map_err(|_| "Embedded webview state is unavailable".to_string())?
        .insert(id, view);
    Ok(())
}

#[tauri::command]
#[specta::specta]
fn embedded_webview_set_bounds(
    state: State<'_, EmbeddedWebviews>,
    id: String,
    bounds: EmbeddedWebviewBounds,
) -> Result<(), String> {
    let view = get_embedded_webview(&state, &id)?;
    view.set_position(tauri::LogicalPosition::new(bounds.x, bounds.y))
        .map_err(|e| format!("Failed to move embedded webview: {e}"))?;
    view.set_size(tauri::LogicalSize::new(bounds.width, bounds.height))
        .map_err(|e| format!("Failed to resize embedded webview: {e}"))
}

#[tauri::command]
#[specta::specta]
fn embedded_webview_set_visible(
    state: State<'_, EmbeddedWebviews>,
    id: String,
    visible: bool,
) -> Result<(), String> {
    let view = get_embedded_webview(&state, &id)?;
    if visible {
        view.show()
            .map_err(|e| format!("Failed to show embedded webview: {e}"))?;
        let _ = view.set_focus();
        return Ok(());
    }
    view.hide()
        .map_err(|e| format!("Failed to hide embedded webview: {e}"))
}

#[tauri::command]
#[specta::specta]
fn embedded_webview_navigate(
    state: State<'_, EmbeddedWebviews>,
    id: String,
    url: String,
) -> Result<(), String> {
    let view = get_embedded_webview(&state, &id)?;
    view.navigate(
        url.parse()
            .map_err(|e| format!("Invalid embedded webview URL: {e}"))?,
    )
    .map_err(|e| format!("Failed to navigate embedded webview: {e}"))
}

#[tauri::command]
#[specta::specta]
fn embedded_webview_reload(state: State<'_, EmbeddedWebviews>, id: String) -> Result<(), String> {
    get_embedded_webview(&state, &id)?
        .reload()
        .map_err(|e| format!("Failed to reload embedded webview: {e}"))
}

#[tauri::command]
#[specta::specta]
fn embedded_webview_focus(state: State<'_, EmbeddedWebviews>, id: String) -> Result<(), String> {
    get_embedded_webview(&state, &id)?
        .set_focus()
        .map_err(|e| format!("Failed to focus embedded webview: {e}"))
}

#[tauri::command]
#[specta::specta]
fn embedded_webview_close(
    app: AppHandle,
    state: State<'_, EmbeddedWebviews>,
    id: String,
) -> Result<(), String> {
    close_embedded_webview(&app, &state, &id);
    Ok(())
}

fn get_embedded_webview(
    state: &State<'_, EmbeddedWebviews>,
    id: &str,
) -> Result<tauri::Webview, String> {
    state
        .views
        .lock()
        .map_err(|_| "Embedded webview state is unavailable".to_string())?
        .get(id)
        .cloned()
        .ok_or_else(|| "The embedded Penpot workspace is not open yet.".to_string())
}

fn close_embedded_webview(app: &AppHandle, state: &State<'_, EmbeddedWebviews>, id: &str) {
    if let Ok(mut views) = state.views.lock() {
        if let Some(view) = views.remove(id) {
            let _ = view.close();
        }
    }
    if let Some(view) = app.get_webview(id) {
        let _ = view.close();
    }
}

fn sanitize_embedded_webview_id(id: &str) -> String {
    id.chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '-' | '_') { c } else { '_' })
        .collect()
}

#[tauri::command]
#[specta::specta]
fn kill_sidecar(app: AppHandle) {
    let Some(server_state) = app.try_state::<ServerState>() else {
        tracing::info!("Server not running");
        return;
    };

    let Some(server_state) = server_state
        .child
        .lock()
        .expect("Failed to acquire mutex lock")
        .take()
    else {
        tracing::info!("Server state missing");
        return;
    };

    let _ = server_state.kill();

    tracing::info!("Killed server");
}

#[tauri::command]
#[specta::specta]
async fn await_initialization(
    state: State<'_, SidecarReady>,
    init_state: State<'_, InitState>,
    events: Channel<InitStep>,
) -> Result<ServerReadyData, String> {
    let mut rx = init_state.current.clone();

    let stream = async {
        let e = *rx.borrow();
        let _ = events.send(e);

        while rx.changed().await.is_ok() {
            let step = *rx.borrow_and_update();
            let _ = events.send(step);

            if matches!(step, InitStep::Done) {
                break;
            }
        }
    };

    // Wait for sidecar credentials (available immediately after spawn, before health check)
    let data = async {
        state
            .inner()
            .0
            .clone()
            .await
            .map_err(|_| "Failed to get sidecar data".to_string())
    };

    let (result, _) = futures::future::join(data, stream).await;
    result
}

#[tauri::command]
#[specta::specta]
fn check_app_exists(app_name: &str) -> bool {
    #[cfg(target_os = "windows")]
    {
        os::windows::check_windows_app(app_name)
    }

    #[cfg(target_os = "macos")]
    {
        check_macos_app(app_name)
    }

    #[cfg(target_os = "linux")]
    {
        check_linux_app(app_name)
    }
}

#[tauri::command]
#[specta::specta]
fn resolve_app_path(app_name: &str) -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        os::windows::resolve_windows_app_path(app_name)
    }

    #[cfg(not(target_os = "windows"))]
    {
        // On macOS/Linux, just return the app_name as-is since
        // the opener plugin handles them correctly
        Some(app_name.to_string())
    }
}

#[tauri::command]
#[specta::specta]
fn open_path(_app: AppHandle, path: String, app_name: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let app_name = app_name.map(|v| os::windows::resolve_windows_app_path(&v).unwrap_or(v));
        let is_powershell = app_name.as_ref().is_some_and(|v| {
            std::path::Path::new(v)
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| {
                    name.eq_ignore_ascii_case("powershell")
                        || name.eq_ignore_ascii_case("powershell.exe")
                })
        });

        if is_powershell {
            return os::windows::open_in_powershell(path);
        }

        return tauri_plugin_opener::open_path(path, app_name.as_deref())
            .map_err(|e| format!("Failed to open path: {e}"));
    }

    #[cfg(not(target_os = "windows"))]
    tauri_plugin_opener::open_path(path, app_name.as_deref())
        .map_err(|e| format!("Failed to open path: {e}"))
}

#[cfg(target_os = "macos")]
fn check_macos_app(app_name: &str) -> bool {
    // Check common installation locations
    let mut app_locations = vec![
        format!("/Applications/{}.app", app_name),
        format!("/System/Applications/{}.app", app_name),
    ];

    if let Ok(home) = std::env::var("HOME") {
        app_locations.push(format!("{}/Applications/{}.app", home, app_name));
    }

    for location in app_locations {
        if std::path::Path::new(&location).exists() {
            return true;
        }
    }

    // Also check if command exists in PATH
    Command::new("which")
        .arg(app_name)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

#[derive(serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum LinuxDisplayBackend {
    Wayland,
    Auto,
}

#[tauri::command]
#[specta::specta]
fn get_display_backend() -> Option<LinuxDisplayBackend> {
    #[cfg(target_os = "linux")]
    {
        let prefer = linux_display::read_wayland().unwrap_or(false);
        return Some(if prefer {
            LinuxDisplayBackend::Wayland
        } else {
            LinuxDisplayBackend::Auto
        });
    }

    #[cfg(not(target_os = "linux"))]
    None
}

#[tauri::command]
#[specta::specta]
fn set_display_backend(_app: AppHandle, _backend: LinuxDisplayBackend) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let prefer = matches!(_backend, LinuxDisplayBackend::Wayland);
        return linux_display::write_wayland(&_app, prefer);
    }

    #[cfg(not(target_os = "linux"))]
    Ok(())
}

#[cfg(target_os = "linux")]
fn check_linux_app(app_name: &str) -> bool {
    return true;
}

#[tauri::command]
#[specta::specta]
fn wsl_path(path: String, mode: Option<WslPathMode>) -> Result<String, String> {
    if !cfg!(windows) {
        return Ok(path);
    }

    let flag = match mode.unwrap_or(WslPathMode::Linux) {
        WslPathMode::Windows => "-w",
        WslPathMode::Linux => "-u",
    };

    let output = if path.starts_with('~') {
        let suffix = path.strip_prefix('~').unwrap_or("");
        let escaped = suffix.replace('"', "\\\"");
        let cmd = format!("wslpath {flag} \"$HOME{escaped}\"");
        Command::new("wsl")
            .args(["-e", "sh", "-lc", &cmd])
            .output()
            .map_err(|e| format!("Failed to run wslpath: {e}"))?
    } else {
        Command::new("wsl")
            .args(["-e", "wslpath", flag, &path])
            .output()
            .map_err(|e| format!("Failed to run wslpath: {e}"))?
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            return Err("wslpath failed".to_string());
        }
        return Err(stderr);
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = make_specta_builder();

    #[cfg(debug_assertions)] // <- Only export on non-release builds
    export_types(&builder);

    #[cfg(all(target_os = "macos", not(debug_assertions)))]
    let _ = std::process::Command::new("killall")
        .arg("opencode-cli")
        .output();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // Focus existing window when another instance is launched
            if let Some(window) = app.get_webview_window(MainWindow::LABEL) {
                let _ = window.set_focus();
                let _ = window.unminimize();
                emit_deep_links(&window, extract_deep_link_urls(&args));
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_os::init())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(window_state_flags())
                .with_denylist(&[LoadingWindow::LABEL])
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(crate::window_customizer::PinchZoomDisablePlugin)
        .plugin(tauri_plugin_decorum::init())
        .manage(EmbeddedWebviews::default())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            let handle = app.handle().clone();

            let log_dir = app
                .path()
                .app_log_dir()
                .expect("failed to resolve app log dir");
            // Hold the guard in managed state so it lives for the app's lifetime,
            // ensuring all buffered logs are flushed on shutdown.
            handle.manage(logging::init(&log_dir));

            builder.mount_events(&handle);
            tauri::async_runtime::spawn(initialize(handle));

            Ok(())
        });

    if UPDATER_ENABLED {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                tracing::info!("Received Exit");

                kill_sidecar(app.clone());
            }
        });
}

fn make_specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new()
        // Then register them (separated by a comma)
        .commands(tauri_specta::collect_commands![
            kill_sidecar,
            cli::install_cli,
            await_initialization,
            server::get_default_server_url,
            server::set_default_server_url,
            server::get_wsl_config,
            server::set_wsl_config,
            get_display_backend,
            set_display_backend,
            markdown::parse_markdown_command,
            check_app_exists,
            wsl_path,
            resolve_app_path,
            open_path,
            embedded_webview_open,
            embedded_webview_set_bounds,
            embedded_webview_set_visible,
            embedded_webview_navigate,
            embedded_webview_reload,
            embedded_webview_focus,
            embedded_webview_close,
            store_update::check_store_update,
            store_update::install_store_update
        ])
        .events(tauri_specta::collect_events![
            LoadingWindowComplete,
            SqliteMigrationProgress
        ])
        .error_handling(tauri_specta::ErrorHandlingMode::Throw)
}

fn export_types(builder: &tauri_specta::Builder<tauri::Wry>) {
    builder
        .export(
            specta_typescript::Typescript::default(),
            "../src/bindings.ts",
        )
        .expect("Failed to export typescript bindings");
}

#[cfg(test)]
#[test]
fn test_export_types() {
    let builder = make_specta_builder();
    export_types(&builder);
}

#[derive(tauri_specta::Event, serde::Deserialize, specta::Type)]
struct LoadingWindowComplete;

async fn initialize(app: AppHandle) {
    tracing::info!("Initializing app");

    let (init_tx, init_rx) = watch::channel(InitStep::ServerWaiting);

    setup_app(&app, init_rx);
    spawn_cli_sync_task(app.clone());

    // Spawn sidecar immediately - credentials are known before health check
    let port = get_sidecar_port();
    let hostname = "127.0.0.1";
    let url = format!("http://{hostname}:{port}");
    let password = uuid::Uuid::new_v4().to_string();

    tracing::info!("Spawning sidecar on {url}");
    let (child, health_check) =
        server::spawn_local_server(app.clone(), hostname.to_string(), port, password.clone());

    // Make sidecar credentials available immediately (before health check completes)
    let (ready_tx, ready_rx) = oneshot::channel();
    let _ = ready_tx.send(ServerReadyData {
        url: url.clone(),
        username: Some("opencode".to_string()),
        password: Some(password),
    });
    app.manage(SidecarReady(ready_rx.shared()));
    app.manage(ServerState {
        child: Arc::new(Mutex::new(Some(child))),
    });

    let loading_window_complete = event_once_fut::<LoadingWindowComplete>(&app);

    // SQLite migration handling:
    // We only do this if the sqlite db doesn't exist, and we're expecting the sidecar to create it.
    // A separate loading window is shown for long migrations.
    let needs_migration = !sqlite_file_exists();
    let sqlite_done = needs_migration.then(|| {
        tracing::info!(
            path = %opencode_db_path().expect("failed to get db path").display(),
            "Sqlite file not found, waiting for it to be generated"
        );

        let (done_tx, done_rx) = oneshot::channel::<()>();
        let done_tx = Arc::new(Mutex::new(Some(done_tx)));

        let init_tx = init_tx.clone();
        let id = SqliteMigrationProgress::listen(&app, move |e| {
            let _ = init_tx.send(InitStep::SqliteWaiting);

            if matches!(e.payload, SqliteMigrationProgress::Done)
                && let Some(done_tx) = done_tx.lock().unwrap().take()
            {
                let _ = done_tx.send(());
            }
        });

        let app = app.clone();
        tokio::spawn(done_rx.map(async move |_| {
            app.unlisten(id);
        }))
    });

    // The loading task waits for SQLite migration (if needed) then for the sidecar health check.
    // This is only used to drive the loading window progress - the main window is shown immediately.
    let loading_task = tokio::spawn({
        async move {
            if let Some(sqlite_done_rx) = sqlite_done {
                let _ = sqlite_done_rx.await;
            }

            // Wait for sidecar to become healthy (for loading window progress)
            let res = timeout(Duration::from_secs(30), health_check.0).await;
            match res {
                Ok(Ok(Ok(()))) => tracing::info!("Sidecar health check OK"),
                Ok(Ok(Err(e))) => tracing::error!("Sidecar health check failed: {e}"),
                Ok(Err(e)) => tracing::error!("Sidecar health check task failed: {e}"),
                Err(_) => tracing::error!("Sidecar health check timed out"),
            }

            tracing::info!("Loading task finished");
        }
    })
    .map_err(|_| ())
    .shared();

    // Show loading window for SQLite migrations if they take >1s
    let loading_window = if needs_migration
        && timeout(Duration::from_secs(1), loading_task.clone())
            .await
            .is_err()
    {
        tracing::debug!("Loading task timed out, showing loading window");
        let loading_window = LoadingWindow::create(&app).expect("Failed to create loading window");
        sleep(Duration::from_secs(1)).await;
        Some(loading_window)
    } else {
        None
    };

    // Create main window immediately - the web app handles its own loading/health gate
    MainWindow::create(&app).expect("Failed to create main window");

    let _ = loading_task.await;

    tracing::info!("Loading done, completing initialisation");
    let _ = init_tx.send(InitStep::Done);

    if loading_window.is_some() {
        loading_window_complete.await;
        tracing::info!("Loading window completed");
    }

    if let Some(loading_window) = loading_window {
        let _ = loading_window.close();
    }
}

fn setup_app(app: &tauri::AppHandle, init_rx: watch::Receiver<InitStep>) {
    cleanup_legacy_deep_links(app);

    #[cfg(any(target_os = "linux", windows))]
    app.deep_link().register_all().ok();

    app.manage(InitState { current: init_rx });
}

fn cleanup_legacy_deep_links(app: &tauri::AppHandle) {
    #[cfg(not(windows))]
    let _ = app;

    #[cfg(windows)]
    {
        let channel = option_env!("OPENCODE_CHANNEL").unwrap_or("prod");
        if matches!(channel, "dev" | "beta")
            && app.deep_link().is_registered("paddiestudio").unwrap_or(false)
        {
            app.deep_link().unregister("paddiestudio").ok();
        }
    }
}

fn extract_deep_link_urls(args: &[String]) -> Vec<String> {
    args.iter()
        .map(|arg| arg.trim())
        .filter(|arg| {
            ["opencode://", "paddiestudio://", "paddiestudiobeta://", "paddiestudiodev://"]
                .iter()
                .any(|scheme| arg.starts_with(scheme))
        })
        .map(str::to_string)
        .collect()
}

fn emit_deep_links(window: &tauri::WebviewWindow, urls: Vec<String>) {
    if urls.is_empty() {
        return;
    }

    let Ok(urls) = serde_json::to_string(&urls) else {
        return;
    };

    let script = format!(
        r#"
(() => {{
  const urls = {urls};
  window.__OPENCODE__ ??= {{}};
  const pending = window.__OPENCODE__.deepLinks ?? [];
  window.__OPENCODE__.deepLinks = [...pending, ...urls];
  for (const event of ["paddiestudio:deep-link", "opencode:deep-link"]) {{
    window.dispatchEvent(new CustomEvent(event, {{ detail: {{ urls }} }}));
  }}
}})();
"#
    );
    let _ = window.eval(&script);
}

fn spawn_cli_sync_task(app: AppHandle) {
    tokio::spawn(async move {
        if let Err(e) = sync_cli(app) {
            tracing::error!("Failed to sync CLI: {e}");
        }
    });
}


fn get_sidecar_port() -> u32 {
    option_env!("OPENCODE_PORT")
        .map(|s| s.to_string())
        .or_else(|| std::env::var("OPENCODE_PORT").ok())
        .and_then(|port_str| port_str.parse().ok())
        .unwrap_or_else(|| {
            TcpListener::bind("127.0.0.1:0")
                .expect("Failed to bind to find free port")
                .local_addr()
                .expect("Failed to get local address")
                .port()
        }) as u32
}

fn sqlite_file_exists() -> bool {
    let Ok(path) = opencode_db_path() else {
        return true;
    };

    path.exists()
}

fn opencode_db_path() -> Result<PathBuf, &'static str> {
    let xdg_data_home = env::var_os("XDG_DATA_HOME").filter(|v| !v.is_empty());

    let data_home = match xdg_data_home {
        Some(v) => PathBuf::from(v),
        None => {
            let home = dirs::home_dir().ok_or("cannot determine home directory")?;
            home.join(".local").join("share")
        }
    };

    Ok(data_home.join("opencode").join("opencode.db"))
}

// Creates a `once` listener for the specified event and returns a future that resolves
// when the listener is fired.
// Since the future creation and awaiting can be done separately, it's possible to create the listener
// synchronously before doing something, then awaiting afterwards.
fn event_once_fut<T: tauri_specta::Event + serde::de::DeserializeOwned>(
    app: &AppHandle,
) -> impl Future<Output = ()> {
    let (tx, rx) = oneshot::channel();
    T::once(app, |_| {
        let _ = tx.send(());
    });
    async {
        let _ = rx.await;
    }
}
