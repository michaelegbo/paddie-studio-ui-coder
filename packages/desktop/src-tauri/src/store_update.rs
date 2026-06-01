use tauri::AppHandle;

#[derive(Clone, Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct StoreUpdateCheck {
    packaged: bool,
    update_available: bool,
    version: Option<String>,
    current_version: Option<String>,
    mandatory: bool,
    error: Option<String>,
}

impl StoreUpdateCheck {
    fn unpackaged() -> Self {
        Self {
            packaged: false,
            update_available: false,
            version: None,
            current_version: None,
            mandatory: false,
            error: None,
        }
    }

    fn packaged(current_version: Option<String>, error: Option<String>) -> Self {
        Self {
            packaged: true,
            update_available: false,
            version: None,
            current_version,
            mandatory: false,
            error,
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn check_store_update(app: AppHandle) -> Result<StoreUpdateCheck, String> {
    #[cfg(target_os = "windows")]
    {
        return tauri::async_runtime::spawn_blocking(move || check_store_update_sync(app))
            .await
            .map_err(|err| format!("Microsoft Store update check task failed: {err}"))?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Ok(StoreUpdateCheck::unpackaged())
    }
}

#[tauri::command]
#[specta::specta]
pub async fn install_store_update(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return tauri::async_runtime::spawn_blocking(move || install_store_update_sync(app))
            .await
            .map_err(|err| format!("Microsoft Store update install task failed: {err}"))?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Ok(())
    }
}

#[cfg(target_os = "windows")]
fn check_store_update_sync(app: AppHandle) -> Result<StoreUpdateCheck, String> {
    let Some(current_version) = current_package_version() else {
        return Ok(StoreUpdateCheck::unpackaged());
    };

    match available_update_summary(&app) {
        Ok((0, _, _)) => Ok(StoreUpdateCheck::packaged(Some(current_version), None)),
        Ok((_, version, mandatory)) => Ok(StoreUpdateCheck {
            packaged: true,
            update_available: true,
            version,
            current_version: Some(current_version),
            mandatory,
            error: None,
        }),
        Err(error) => Ok(StoreUpdateCheck::packaged(Some(current_version), Some(error))),
    }
}

#[cfg(target_os = "windows")]
fn install_store_update_sync(app: AppHandle) -> Result<(), String> {
    use ::windows::Services::Store::StorePackageUpdateState;

    let Some(_) = current_package_version() else {
        return Ok(());
    };

    let context = store_context(&app)?;
    let updates = context
        .GetAppAndOptionalStorePackageUpdatesAsync()
        .map_err(|err| format!("Could not query Microsoft Store updates: {err}"))?
        .get()
        .map_err(|err| format!("Microsoft Store update query failed: {err}"))?;
    if updates.Size().map_err(|err| format!("Could not read Microsoft Store updates: {err}"))? == 0 {
        return Ok(());
    }

    let result = context
        .RequestDownloadAndInstallStorePackageUpdatesAsync(&updates)
        .map_err(|err| format!("Could not start Microsoft Store update install: {err}"))?
        .get()
        .map_err(|err| format!("Microsoft Store update install failed: {err}"))?;
    let state = result
        .OverallState()
        .map_err(|err| format!("Could not read Microsoft Store update result: {err}"))?;

    if state == StorePackageUpdateState::Completed {
        return Ok(());
    }

    Err(format!("Microsoft Store update did not complete: {state:?}"))
}

#[cfg(target_os = "windows")]
fn current_package_version() -> Option<String> {
    let version = ::windows::ApplicationModel::Package::Current()
        .ok()?
        .Id()
        .ok()?
        .Version()
        .ok()?;
    Some(format_package_version(version))
}

#[cfg(target_os = "windows")]
fn available_update_summary(app: &AppHandle) -> Result<(u32, Option<String>, bool), String> {
    let updates = store_context(app)?
        .GetAppAndOptionalStorePackageUpdatesAsync()
        .map_err(|err| format!("Could not query Microsoft Store updates: {err}"))?
        .get()
        .map_err(|err| format!("Microsoft Store update query failed: {err}"))?;
    let count = updates
        .Size()
        .map_err(|err| format!("Could not read Microsoft Store update count: {err}"))?;
    let mut version = None;
    let mut mandatory = false;

    for index in 0..count {
        let update = updates
            .GetAt(index)
            .map_err(|err| format!("Could not read Microsoft Store update {index}: {err}"))?;
        mandatory = mandatory || update.Mandatory().unwrap_or(false);
        if version.is_some() {
            continue;
        }

        version = update
            .Package()
            .ok()
            .and_then(|package| package.Id().ok())
            .and_then(|id| id.Version().ok())
            .map(format_package_version);
    }

    Ok((count, version, mandatory))
}

#[cfg(target_os = "windows")]
fn store_context(app: &AppHandle) -> Result<::windows::Services::Store::StoreContext, String> {
    use ::windows::{Win32::UI::Shell::IInitializeWithWindow, core::Interface};
    use tauri::Manager;

    let context = ::windows::Services::Store::StoreContext::GetDefault()
        .map_err(|err| format!("Could not create Microsoft Store context: {err}"))?;

    if let Some(window) = app.get_webview_window(crate::windows::MainWindow::LABEL) {
        if let Ok(hwnd) = window.hwnd() {
            let initializer: IInitializeWithWindow = context
                .cast()
                .map_err(|err| format!("Could not initialize Microsoft Store window owner: {err}"))?;
            unsafe {
                initializer
                    .Initialize(hwnd)
                    .map_err(|err| format!("Could not attach Microsoft Store dialog to app window: {err}"))?;
            }
        }
    }

    Ok(context)
}

#[cfg(target_os = "windows")]
fn format_package_version(version: ::windows::ApplicationModel::PackageVersion) -> String {
    format!(
        "{}.{}.{}.{}",
        version.Major, version.Minor, version.Build, version.Revision
    )
}
