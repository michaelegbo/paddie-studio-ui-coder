fn main() {
    println!("cargo:rerun-if-changed=icons/dev/icon.ico");
    println!("cargo:rerun-if-changed=../app-icon.svg");
    tauri_build::try_build(
        tauri_build::Attributes::new().windows_attributes(
            tauri_build::WindowsAttributes::new().window_icon_path("icons/dev/icon.ico"),
        ),
    )
    .expect("failed to run tauri build script");
}
