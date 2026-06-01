param(
  [Parameter(Mandatory = $true)]
  [string]$Version,

  [string]$TargetDir = "packages/desktop/src-tauri/target/x86_64-pc-windows-msvc/release",
  [string]$OutputDir = "$env:RUNNER_TEMP/paddie-store-msix",
  [string]$IdentityName = $env:MSIX_PACKAGE_IDENTITY_NAME,
  [string]$Publisher = $env:MSIX_PUBLISHER,
  [string]$PublisherDisplayName = $env:MSIX_PUBLISHER_DISPLAY_NAME,
  [string]$PackageVersion
)

$ErrorActionPreference = "Stop"

if (-not $IdentityName) {
  throw "MSIX_PACKAGE_IDENTITY_NAME is required"
}
if (-not $Publisher) {
  throw "MSIX_PUBLISHER is required"
}
if (-not $PublisherDisplayName) {
  throw "MSIX_PUBLISHER_DISPLAY_NAME is required"
}
if ($Version -notmatch '^(\d+)\.(\d+)\.(\d+)(?:[.-].*)?$') {
  throw "MSIX package version must start with major.minor.patch, got '$Version'"
}

$packageVersion = if ($PackageVersion) {
  if ($PackageVersion -notmatch '^(\d+)\.(\d+)\.(\d+)\.(\d+)$') {
    throw "MSIX PackageVersion must be four numeric fields, got '$PackageVersion'"
  }
  $PackageVersion
} else {
  "$($Matches[1]).$($Matches[2]).$($Matches[3]).0"
}
$packageVersion.Split(".") | ForEach-Object {
  if ([int]$_ -gt 65535) {
    throw "MSIX package version field '$_' is above the Windows package limit of 65535"
  }
}
$resolvedTarget = (Resolve-Path -LiteralPath $TargetDir).ProviderPath
$resolvedOutput = if (Test-Path -LiteralPath $OutputDir) {
  (Resolve-Path -LiteralPath $OutputDir).ProviderPath
} else {
  (New-Item -ItemType Directory -Force -Path $OutputDir | Resolve-Path).ProviderPath
}
$stageDir = Join-Path $resolvedOutput "stage"
$stageRoot = [System.IO.Path]::GetFullPath($stageDir)
$outputRoot = [System.IO.Path]::GetFullPath($resolvedOutput)
if (-not $stageRoot.StartsWith($outputRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to stage MSIX outside the output directory"
}
Remove-Item -Recurse -Force -LiteralPath $stageDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $stageDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $stageDir "Assets") | Out-Null

Copy-Item -LiteralPath (Join-Path $resolvedTarget "PaddieStudio.exe") -Destination (Join-Path $stageDir "PaddieStudio.exe") -Force
Get-ChildItem -LiteralPath $resolvedTarget -File -Filter "*.dll" | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $stageDir $_.Name) -Force
}
if (Test-Path -LiteralPath (Join-Path $resolvedTarget "opencode-cli.exe")) {
  Copy-Item -LiteralPath (Join-Path $resolvedTarget "opencode-cli.exe") -Destination (Join-Path $stageDir "opencode-cli.exe") -Force
}

$iconsDir = (Resolve-Path -LiteralPath "packages/desktop/src-tauri/icons/prod").ProviderPath
@(
  "Square44x44Logo.png",
  "Square71x71Logo.png",
  "Square150x150Logo.png",
  "Square310x310Logo.png",
  "StoreLogo.png"
) | ForEach-Object {
  Copy-Item -LiteralPath (Join-Path $iconsDir $_) -Destination (Join-Path $stageDir "Assets/$_") -Force
}
try {
  Add-Type -AssemblyName System.Drawing
  $sourceImage = [System.Drawing.Image]::FromFile((Join-Path $iconsDir "Square150x150Logo.png"))
  $wideImage = New-Object System.Drawing.Bitmap 310, 150
  $graphics = [System.Drawing.Graphics]::FromImage($wideImage)
  $graphics.Clear([System.Drawing.Color]::FromArgb(17, 17, 17))
  $graphics.DrawImage($sourceImage, 80, 0, 150, 150)
  $wideImage.Save((Join-Path $stageDir "Assets/Wide310x150Logo.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $wideImage.Dispose()
  $sourceImage.Dispose()
} catch {
  Write-Warning "Could not generate Wide310x150Logo.png, falling back to square asset: $($_.Exception.Message)"
  Copy-Item -LiteralPath (Join-Path $iconsDir "Square310x310Logo.png") -Destination (Join-Path $stageDir "Assets/Wide310x150Logo.png") -Force
}

$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:desktop="http://schemas.microsoft.com/appx/manifest/desktop/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap desktop rescap">
  <Identity Name="$IdentityName" Publisher="$Publisher" Version="$packageVersion" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>Paddie Studio</DisplayName>
    <PublisherDisplayName>$PublisherDisplayName</PublisherDisplayName>
    <Logo>Assets\StoreLogo.png</Logo>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Resources>
    <Resource Language="en-us" />
  </Resources>
  <Applications>
    <Application Id="PaddieStudio" Executable="PaddieStudio.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        DisplayName="Paddie Studio"
        Description="Paddie Studio"
        BackgroundColor="#111111"
        Square44x44Logo="Assets\Square44x44Logo.png"
        Square150x150Logo="Assets\Square150x150Logo.png">
        <uap:DefaultTile
          Square71x71Logo="Assets\Square71x71Logo.png"
          Square310x310Logo="Assets\Square310x310Logo.png"
          Wide310x150Logo="Assets\Wide310x150Logo.png" />
      </uap:VisualElements>
      <Extensions>
        <uap:Extension Category="windows.protocol">
          <uap:Protocol Name="paddiestudio" />
        </uap:Extension>
      </Extensions>
    </Application>
  </Applications>
  <Capabilities>
    <Capability Name="internetClient" />
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
"@
$manifest | Set-Content -LiteralPath (Join-Path $stageDir "AppxManifest.xml") -Encoding utf8

$makeAppx = Get-ChildItem -LiteralPath "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Recurse -Filter makeappx.exe |
  Where-Object { $_.FullName -match "\\x64\\makeappx\.exe$" } |
  Sort-Object FullName -Descending |
  Select-Object -First 1
if (-not $makeAppx) {
  throw "MakeAppx.exe was not found in the Windows SDK"
}

$msixPath = Join-Path $resolvedOutput "PaddieStudio_$($packageVersion)_x64.msix"
Remove-Item -Force -LiteralPath $msixPath -ErrorAction SilentlyContinue
& $makeAppx.FullName pack /d $stageDir /p $msixPath /o
if ($LASTEXITCODE -ne 0) {
  throw "MakeAppx failed with exit code $LASTEXITCODE"
}

$bundleStageDir = Join-Path $resolvedOutput "bundle-stage"
$bundleStageRoot = [System.IO.Path]::GetFullPath($bundleStageDir)
if (-not $bundleStageRoot.StartsWith($outputRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to stage MSIX bundle outside the output directory"
}
Remove-Item -Recurse -Force -LiteralPath $bundleStageDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $bundleStageDir | Out-Null
Copy-Item -LiteralPath $msixPath -Destination (Join-Path $bundleStageDir (Split-Path -Leaf $msixPath)) -Force

$bundlePath = Join-Path $resolvedOutput "PaddieStudio_$($packageVersion)_x64.msixbundle"
Remove-Item -Force -LiteralPath $bundlePath -ErrorAction SilentlyContinue
& $makeAppx.FullName bundle /d $bundleStageDir /p $bundlePath /o
if ($LASTEXITCODE -ne 0) {
  throw "MakeAppx bundle failed with exit code $LASTEXITCODE"
}

if ($env:GITHUB_OUTPUT) {
  "msix=$bundlePath" | Out-File -FilePath $env:GITHUB_OUTPUT -Append -Encoding utf8
}
Write-Host "Created $bundlePath"
