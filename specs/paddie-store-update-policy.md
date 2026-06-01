# Paddie Store Update Policy

Paddie Studio has two Windows update paths:

- Microsoft Store/MSIX installs use the Microsoft Store package update APIs.
- GitHub/NSIS `.exe` installs use the Tauri updater and GitHub `latest.json`.

Do not use the GitHub updater to replace a Microsoft Store package. Store-installed users must stay on the Store-managed package lane so Windows can enforce package identity, signature, certification, and update rules.

## Store Update Flow

On Windows, Paddie checks whether the app has package identity. If it does, desktop startup update polling asks Microsoft Store for app and optional package updates. When an update is available, the normal Paddie update toast is shown. Clicking install starts the Microsoft Store download/install flow through Windows, then Paddie restarts.

If the Store update query fails inside a packaged install, Paddie treats the app as Store-managed and does not fall back to the GitHub updater. Users can still update through Microsoft Store.

## GitHub Update Flow

Unpackaged Windows installs, including normal `.exe` installs, continue to use the existing Tauri updater endpoint for the active release channel.

Manual sideloaded `.msix` or `.msixbundle` files are package-identity installs. They can receive Microsoft Store updates only when Windows can associate that package identity with the Store product. Otherwise, Microsoft Store remains the fallback update path.
