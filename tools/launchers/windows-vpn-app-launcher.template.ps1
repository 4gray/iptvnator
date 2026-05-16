param(
    [string]$VpnExecutable = "<path-to-vpn-client.exe>",
    [string]$VpnProcessName = "<vpn-process-name>",
    [string]$VpnCliExecutable = "<path-to-vpn-cli.exe>",
    [string]$TargetLocation = "<target-location>",
    [string]$AppExecutable = "<path-to-iptvnator.exe>",
    [string]$StatusFile = "$env:TEMP\iptvnator-vpn-session.json"
)

$ErrorActionPreference = "Stop"

function Test-ProcessRunning {
    param([string]$Name)
    if ([string]::IsNullOrWhiteSpace($Name)) {
        return $false
    }
    return [bool](Get-Process -Name $Name -ErrorAction SilentlyContinue)
}

function Start-VpnClientHidden {
    if (-not (Test-Path -LiteralPath $VpnExecutable)) {
        throw "VPN executable not found."
    }

    if (-not (Test-ProcessRunning -Name $VpnProcessName)) {
        Start-Process -FilePath $VpnExecutable -WindowStyle Hidden
        Start-Sleep -Seconds 3
    }
}

function Write-SessionStatus {
    param(
        [string]$State,
        [bool]$InitialClientRunning,
        [bool]$TouchedVpn
    )

    $status = [ordered]@{
        state = $State
        requiredCountry = $TargetLocation
        country = $TargetLocation
        initialClientRunning = $InitialClientRunning
        initialConnected = $false
        initialRequiredCountry = $false
        touchedVpn = $TouchedVpn
        cleanupProcessNames = @($VpnProcessName)
        cleanupAction = "terminate-client"
        updatedAt = (Get-Date).ToString("o")
    }

    $parent = Split-Path -Parent $StatusFile
    if ($parent -and -not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    $status | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $StatusFile -Encoding UTF8
}

function Connect-VpnLocation {
    if (-not (Test-Path -LiteralPath $VpnCliExecutable)) {
        return
    }

    if ([string]::IsNullOrWhiteSpace($TargetLocation)) {
        return
    }

    Start-Process `
        -FilePath $VpnCliExecutable `
        -ArgumentList @("connect", $TargetLocation) `
        -WindowStyle Hidden `
        -Wait
}

function Start-App {
    if (-not (Test-Path -LiteralPath $AppExecutable)) {
        throw "App executable not found."
    }

    $previousStatusFile = $env:IPTVNATOR_VPN_STATUS_FILE
    try {
        $env:IPTVNATOR_VPN_STATUS_FILE = $StatusFile
        Start-Process -FilePath $AppExecutable
    } finally {
        $env:IPTVNATOR_VPN_STATUS_FILE = $previousStatusFile
    }
}

$initialClientRunning = Test-ProcessRunning -Name $VpnProcessName
Start-VpnClientHidden
Connect-VpnLocation
Write-SessionStatus -State "ready" -InitialClientRunning $initialClientRunning -TouchedVpn (-not $initialClientRunning)
Start-App
