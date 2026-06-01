param(
    [string]$ListingPath = "packages/desktop/store-listing/listing.en-US.json"
)

$ErrorActionPreference = "Stop"

function Get-RequiredEnv([string]$Name) {
    $value = [Environment]::GetEnvironmentVariable($Name)
    if (-not $value) {
        throw "$Name is required for Microsoft Store listing publishing"
    }
    $trimmed = $value.Trim().Trim([char]0xFEFF)
    if (-not $trimmed) {
        throw "$Name is required for Microsoft Store listing publishing"
    }
    return $trimmed
}

$tenantId = Get-RequiredEnv "PARTNER_CENTER_TENANT_ID"
$sellerId = Get-RequiredEnv "PARTNER_CENTER_SELLER_ID"
$clientId = Get-RequiredEnv "PARTNER_CENTER_CLIENT_ID"
$clientSecret = Get-RequiredEnv "PARTNER_CENTER_CLIENT_SECRET"
$productId = Get-RequiredEnv "MICROSOFT_STORE_PRODUCT_ID"
$listing = Get-Content -Raw -LiteralPath $ListingPath | ConvertFrom-Json
$listingRoot = Split-Path -Parent (Resolve-Path -LiteralPath $ListingPath)
$language = $listing.language.ToLowerInvariant()

$token = Invoke-RestMethod `
    -Method Post `
    -Uri "https://login.microsoftonline.com/$tenantId/oauth2/v2.0/token" `
    -ContentType "application/x-www-form-urlencoded" `
    -Body @{
        grant_type    = "client_credentials"
        client_id     = $clientId
        client_secret = $clientSecret
        scope         = "https://api.store.microsoft.com/.default"
    }

$storeHeaders = @{
    Authorization         = "Bearer $($token.access_token)"
    "X-Seller-Account-Id" = $sellerId
}

function Invoke-StoreApi([string]$Method, [string]$Path, $Body = $null) {
    $parameters = @{
        Method  = $Method
        Uri     = "https://api.store.microsoft.com$Path"
        Headers = $storeHeaders
    }
    if ($null -ne $Body) {
        $parameters.ContentType = "application/json"
        $parameters.Body = $Body | ConvertTo-Json -Depth 50
    }
    return Invoke-RestMethod @parameters
}

$listingsMetadata = Invoke-StoreApi `
    -Method Get `
    -Path "/submission/v1/product/$productId/metadata/listings?languages=$language&includelanguagelist=false"

$storeListing = @($listingsMetadata.responseData.listings) |
    Where-Object { $_.language.ToLowerInvariant() -eq $language } |
    Select-Object -First 1

if (-not $storeListing) {
    throw "No Microsoft Store listing metadata was returned for '$language'"
}

$storeListing.description = $listing.description
$storeListing.shortDescription = $listing.short_description
$storeListing.productFeatures = @($listing.features)
$storeListing.searchTerms = @($listing.search_terms)
$storeListing.supportContactInfo = $listing.support_url
$storeListing.privacyPolicyUrl = $listing.privacy_policy_url
$storeListing.isPrivacyPolicyRequired = $true

if ($listing.whats_new) {
    $storeListing.whatsNew = $listing.whats_new
}

$metadataResponse = Invoke-StoreApi `
    -Method Put `
    -Path "/submission/v1/product/$productId/metadata" `
    -Body @{ listings = $storeListing }

if ($metadataResponse.isSuccess -ne $true) {
    throw "Microsoft Store listing metadata update failed: $($metadataResponse.errors | ConvertTo-Json -Depth 20)"
}

Write-Output "Microsoft Store listing text updated for $language"

$screenshots = @($listing.screenshots)
$assetResponse = Invoke-StoreApi `
    -Method Post `
    -Path "/submission/v1/product/$productId/listings/assets/create" `
    -Body @{
        language = $language
        createAssetRequest = @{
            Screenshot = $screenshots.Count
            Logo = 0
        }
    }

if ($assetResponse.isSuccess -ne $true) {
    throw "Microsoft Store listing asset creation failed: $($assetResponse.errors | ConvertTo-Json -Depth 20)"
}

$uploads = @($assetResponse.responseData.listingAssets.screenshots)
if ($uploads.Count -ne $screenshots.Count) {
    throw "Microsoft Store returned $($uploads.Count) screenshot upload URLs for $($screenshots.Count) screenshots"
}

for ($index = 0; $index -lt $screenshots.Count; $index++) {
    $screenshotPath = Join-Path $listingRoot $screenshots[$index].file
    if (-not (Test-Path -LiteralPath $screenshotPath)) {
        throw "Missing screenshot asset: $screenshotPath"
    }

    $headers = @{}
    if ($uploads[$index].httpHeaders) {
        $uploads[$index].httpHeaders.PSObject.Properties | ForEach-Object {
            $headers[$_.Name] = $_.Value
        }
    }
    if (-not $headers.ContainsKey("x-ms-blob-type")) {
        $headers["x-ms-blob-type"] = "BlockBlob"
    }

    Invoke-WebRequest `
        -Method $uploads[$index].httpMethod `
        -Uri $uploads[$index].primaryAssetUploadUrl `
        -Headers $headers `
        -ContentType "image/png" `
        -InFile $screenshotPath `
        -UseBasicParsing | Out-Null

    Write-Output "Uploaded Store screenshot $($index + 1): $($screenshots[$index].file)"
}

$commitResponse = Invoke-StoreApi `
    -Method Put `
    -Path "/submission/v1/product/$productId/listings/assets/commit" `
    -Body @{
        listingAssets = @{
            language = $language
            storeLogos = @()
            screenshots = @($uploads | ForEach-Object { @{ id = $_.id } })
        }
    }

if ($commitResponse.isSuccess -ne $true) {
    throw "Microsoft Store screenshot commit failed: $($commitResponse.errors | ConvertTo-Json -Depth 20)"
}

Write-Output "Microsoft Store screenshots committed for $language"
