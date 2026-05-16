import { spawn } from 'child_process';
import { isIP } from 'net';
import { SourceVpnRequestContext } from 'shared-interfaces';
import {
    PROTON_VPN_INTEGRATION_ENABLED,
    PROTON_VPN_LOCATION,
    VPN_INTEGRATION_ENABLED,
    VPN_LOCATION,
    VPN_PROVIDER,
    VPN_RESTORE_ON_EXIT,
    store,
} from './store.service';

export const DEFAULT_PROTON_VPN_LOCATION = 'HR';

type SpawnFunction = typeof spawn;

export interface ProtonVpnIntegrationResult {
    enabled?: boolean;
    location: string;
    localAddress?: string;
    provider?: 'none' | 'proton';
    reason?: string;
    status: 'configured' | 'disabled' | 'failed' | 'skipped' | 'timeout';
    clientRunning?: boolean;
    initialClientRunning?: boolean;
    initialConnected?: boolean;
    initialLocalAddress?: string;
    startedClient?: boolean;
    touchedVpn?: boolean;
    lastCheckedAt?: number;
}

interface ProtonVpnIntegrationServiceOptions {
    platform?: NodeJS.Platform;
    spawn?: SpawnFunction;
    timeoutMs?: number;
}

export interface ProtonVpnPreferenceOptions {
    enabled?: boolean;
    location?: string;
    provider?: 'none' | 'proton';
    startClient: boolean;
}

interface ProtonVpnPreferenceContext {
    enabled: boolean;
    location: string;
    provider: 'none' | 'proton';
}

const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
const POWERSHELL_TIMEOUT_MS = 30000;
const SOURCE_NETWORK_PREPARATION_CACHE_MS = 30000;

export function normalizeProtonVpnLocation(value: unknown): string {
    if (typeof value !== 'string') {
        return DEFAULT_PROTON_VPN_LOCATION;
    }

    const normalized = value.trim().toUpperCase();

    if (normalized === 'FASTEST') {
        return normalized;
    }

    return COUNTRY_CODE_PATTERN.test(normalized)
        ? normalized
        : DEFAULT_PROTON_VPN_LOCATION;
}

function encodePowerShellCommand(script: string): string {
    return Buffer.from(script, 'utf16le').toString('base64');
}

function psString(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}

function normalizeLocalAddress(value: unknown): string | undefined {
    const text = typeof value === 'string' ? value.trim() : '';
    return text && isIP(text) ? text : undefined;
}

function hasUsableVpnAddress(result: ProtonVpnIntegrationResult): boolean {
    return Boolean(
        result.localAddress &&
            result.status === 'configured' &&
            result.enabled &&
            result.provider === 'proton'
    );
}

export function buildProtonVpnPreferenceScript(
    location: string,
    startClient: boolean
): string {
    const targetLocation = normalizeProtonVpnLocation(location);

    return `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$TargetCountry = ${psString(targetLocation)}
$StartClient = ${startClient ? '$true' : '$false'}

function Write-Result {
    param([hashtable] $Result)
    $Result | ConvertTo-Json -Depth 12 -Compress
}

function Set-JsonStringProperty {
    param(
        [Parameter(Mandatory = $true)] $Object,
        [Parameter(Mandatory = $true)] [string] $Name,
        [AllowNull()] [string] $Value
    )

    if ($Object.PSObject.Properties.Name -contains $Name) {
        $Object.$Name = $Value
    } else {
        $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force
    }
}

function Read-JsonObject {
    param([Parameter(Mandatory = $true)] [string] $Path)

    if (Test-Path -LiteralPath $Path) {
        $raw = Get-Content -LiteralPath $Path -Raw
        if (-not [string]::IsNullOrWhiteSpace($raw)) {
            return $raw | ConvertFrom-Json
        }
    }

    return [pscustomobject]@{}
}

function Write-JsonObject {
    param(
        [Parameter(Mandatory = $true)] [string] $Path,
        [Parameter(Mandatory = $true)] $Object
    )

    $parent = Split-Path -Parent $Path
    if ($parent -and -not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    $Object | ConvertTo-Json -Depth 64 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Get-ProtonInstall {
    $programFilesX86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
    $roots = @(
        (Join-Path $env:ProgramFiles 'Proton\\VPN'),
        (if ($programFilesX86) { Join-Path $programFilesX86 'Proton\\VPN' })
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

    foreach ($root in $roots) {
        $launcher = Join-Path $root 'ProtonVPN.Launcher.exe'
        $versionDir = Get-ChildItem -LiteralPath $root -Directory -Filter 'v*' -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending |
            Select-Object -First 1

        if ((Test-Path -LiteralPath $launcher) -and $versionDir) {
            return [pscustomobject]@{
                Root = $root
                VersionDir = $versionDir.FullName
                Launcher = $launcher
            }
        }
    }

    return $null
}

function Get-ProtonStoragePath {
    $storage = Join-Path $env:LOCALAPPDATA 'Proton\\Proton VPN\\Storage'
    if (Test-Path -LiteralPath $storage) {
        return $storage
    }
    return $null
}

function Get-PrimaryUserSettingsFile {
    param([Parameter(Mandatory = $true)] [string] $StoragePath)

    $files = @(Get-ChildItem -LiteralPath $StoragePath -Filter 'UserSettings.*.json' -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notmatch '\\.bak' })

    if ($files.Count -eq 0) {
        return $null
    }

    $candidates = foreach ($file in $files) {
        try {
            $json = Read-JsonObject -Path $file.FullName
            [pscustomobject]@{
                File = $file
                HasAuthenticatedData = [bool]($json.ConnectionCertificate -and $json.ConnectionKeyPair)
                HasDefaultConnection = [bool]$json.DefaultConnection
                Length = $file.Length
            }
        } catch {}
    }

    return $candidates |
        Sort-Object -Property HasAuthenticatedData, HasDefaultConnection, Length -Descending |
        Select-Object -First 1 |
        ForEach-Object { $_.File }
}

function Add-ProtonAssemblyResolver {
    param([Parameter(Mandatory = $true)] [string] $VersionDir)

    [System.Runtime.Loader.AssemblyLoadContext]::Default.add_Resolving({
        param($context, $assemblyName)

        $candidate = Join-Path $VersionDir ($assemblyName.Name + '.dll')
        if (Test-Path -LiteralPath $candidate) {
            return $context.LoadFromAssemblyPath($candidate)
        }

        return $null
    })
}

function Load-ProtonAssembly {
    param(
        [Parameter(Mandatory = $true)] [string] $VersionDir,
        [Parameter(Mandatory = $true)] [string] $Name
    )

    $path = Join-Path $VersionDir $Name
    if (Test-Path -LiteralPath $path) {
        [System.Runtime.Loader.AssemblyLoadContext]::Default.LoadFromAssemblyPath($path) | Out-Null
    }
}

function Get-LoadedType {
    param([Parameter(Mandatory = $true)] [string] $TypeName)

    return [AppDomain]::CurrentDomain.GetAssemblies() |
        ForEach-Object { $_.GetType($TypeName, $false) } |
        Where-Object { $_ } |
        Select-Object -First 1
}

function Ensure-ProtonCountryRecent {
    param(
        [Parameter(Mandatory = $true)] [string] $VersionDir,
        [Parameter(Mandatory = $true)] [string] $RecentsPath,
        [Parameter(Mandatory = $true)] [string] $Country
    )

    Add-ProtonAssemblyResolver -VersionDir $VersionDir
    @(
        'protobuf-net.dll',
        'ProtonVPN.Common.Core.dll',
        'ProtonVPN.Serialization.Contracts.dll',
        'ProtonVPN.Serialization.Protobuf.Entities.dll',
        'ProtonVPN.Serialization.Protobuf.dll',
        'ProtonVPN.Client.Logic.Servers.Contracts.dll',
        'ProtonVPN.Client.Logic.Connection.Contracts.dll',
        'ProtonVPN.Client.Logic.Recents.Contracts.dll'
    ) | ForEach-Object { Load-ProtonAssembly -VersionDir $VersionDir -Name $_ }

    $entitiesType = Get-LoadedType 'ProtonVPN.Serialization.Protobuf.Entities.ProtobufSerializableEntities'
    $serializerType = Get-LoadedType 'ProtonVPN.Serialization.Protobuf.ProtobufSerializer'
    $recentType = Get-LoadedType 'ProtonVPN.Client.Logic.Recents.Contracts.SerializableEntities.SerializableRecentConnection'
    $intentType = Get-LoadedType 'ProtonVPN.Client.Logic.Connection.Contracts.SerializableEntities.Intents.SerializableConnectionIntent'
    $locationType = Get-LoadedType 'ProtonVPN.Client.Logic.Connection.Contracts.SerializableEntities.Intents.SerializableLocationIntent'

    if (-not $entitiesType -or -not $serializerType -or -not $recentType -or -not $intentType -or -not $locationType) {
        throw 'Could not load Proton serialization contracts.'
    }

    $serializer = [Activator]::CreateInstance(
        $serializerType,
        @([Activator]::CreateInstance($entitiesType))
    )
    $listType = [System.Collections.Generic.List[object]].GetGenericTypeDefinition().MakeGenericType($recentType)
    $list = [Activator]::CreateInstance($listType)

    if (Test-Path -LiteralPath $RecentsPath) {
        $deserializeMethod = $serializerType.GetMethod('Deserialize').MakeGenericMethod($listType)
        $stream = [IO.MemoryStream]::new([IO.File]::ReadAllBytes($RecentsPath))
        $loadedList = $deserializeMethod.Invoke($serializer, @($stream))
        if ($loadedList) {
            $list = $loadedList
        }
    }

    foreach ($recent in @($list)) {
        $location = $recent.ConnectionIntent.Location
        if (
            $location -and
            $location.TypeName -eq 'SingleCountryLocationIntent' -and
            $location.CountryCode -and
            $location.CountryCode.Equals($Country, [StringComparison]::OrdinalIgnoreCase)
        ) {
            $recent.IsPinned = $true
            return [pscustomobject]@{
                RecentId = $recent.RecentId
                Created = $false
                List = $list
            }
        }
    }

    $id = [Guid]::NewGuid()
    $newLocation = [Activator]::CreateInstance($locationType)
    $newLocation.TypeName = 'SingleCountryLocationIntent'
    $newLocation.CountryCode = $Country

    $newIntent = [Activator]::CreateInstance($intentType)
    $newIntent.Location = $newLocation

    $newRecent = [Activator]::CreateInstance($recentType)
    $newRecent.RecentId = $id
    $newRecent.ConnectionIntent = $newIntent
    $newRecent.IsPinned = $true

    $list.Insert(0, $newRecent)

    $parent = Split-Path -Parent $RecentsPath
    if ($parent -and -not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    $serializeMethod = $serializerType.GetMethod('Serialize').MakeGenericMethod($listType)
    $memoryStream = $serializeMethod.Invoke($serializer, @($list))
    [IO.File]::WriteAllBytes($RecentsPath, $memoryStream.ToArray())

    return [pscustomobject]@{
        RecentId = $id
        Created = $true
        List = $list
    }
}

function Set-ProtonPreferences {
    param(
        [Parameter(Mandatory = $true)] $Install,
        [Parameter(Mandatory = $true)] [string] $StoragePath,
        [Parameter(Mandatory = $true)] [string] $Country
    )

    $globalPath = Join-Path $StoragePath 'GlobalSettings.json'
    $globalSettings = Read-JsonObject -Path $globalPath
    Set-JsonStringProperty -Object $globalSettings -Name 'IsAutoLaunchEnabled' -Value 'true'
    Set-JsonStringProperty -Object $globalSettings -Name 'AutoLaunchMode' -Value 'MinimizeToSystemTray'
    Write-JsonObject -Path $globalPath -Object $globalSettings

    $userFile = Get-PrimaryUserSettingsFile -StoragePath $StoragePath
    if (-not $userFile) {
        return [pscustomobject]@{
            HasUser = $false
            DefaultConnectionUpdated = $false
        }
    }

    $userHash = $null
    if ($userFile.Name -match '^UserSettings\\.(.+)\\.json$') {
        $userHash = $Matches[1]
    }

    $userSettings = Read-JsonObject -Path $userFile.FullName
    Set-JsonStringProperty -Object $userSettings -Name 'IsAutoConnectEnabled' -Value 'true'

    $createdRecent = $false
    $recentId = '00000000-0000-0000-0000-000000000000'
    $connectionType = 0

    if ($Country -ne 'FASTEST' -and $userHash) {
        $recentsPath = Join-Path $StoragePath "RecentConnections.$userHash.bin"
        $recent = Ensure-ProtonCountryRecent -VersionDir $Install.VersionDir -RecentsPath $recentsPath -Country $Country
        $recentId = [string]$recent.RecentId
        $createdRecent = [bool]$recent.Created
        $connectionType = 2
    }

    $defaultConnection = @{
        Type = $connectionType
        RecentId = $recentId
    } | ConvertTo-Json -Compress

    Set-JsonStringProperty -Object $userSettings -Name 'DefaultConnection' -Value $defaultConnection
    Write-JsonObject -Path $userFile.FullName -Object $userSettings

    return [pscustomobject]@{
        HasUser = $true
        DefaultConnectionUpdated = $true
        CreatedRecent = $createdRecent
        UserHash = $userHash
    }
}

function Hide-ProtonWindows {
    param([int] $Seconds = 4)

    try {
        Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class IptvnatorWindowTools {
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
'@ -ErrorAction SilentlyContinue
    } catch {}

    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        Get-Process -Name 'ProtonVPN', 'ProtonVPN.Client', 'ProtonVPN.Launcher' -ErrorAction SilentlyContinue |
            ForEach-Object {
                try {
                    if ($_.MainWindowHandle -ne 0) {
                        [IptvnatorWindowTools]::ShowWindow($_.MainWindowHandle, 0) | Out-Null
                    }
                } catch {}
            }
        Start-Sleep -Milliseconds 150
    }
}

function Get-ProtonLocalAddress {
    try {
        $adapters = @(Get-NetAdapter -ErrorAction SilentlyContinue |
            Where-Object {
                $_.Status -eq 'Up' -and (
                    $_.Name -match 'Proton|ProtonVPN' -or
                    $_.InterfaceDescription -match 'Proton|ProtonVPN|WireGuard Tunnel'
                )
            } |
            Sort-Object @{ Expression = { if ($_.Name -match 'Proton|ProtonVPN') { 0 } else { 1 } } }, ifIndex)

        foreach ($adapter in $adapters) {
            $addresses = Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue
            foreach ($entry in $addresses) {
                if ($entry.IPAddress -and $entry.AddressState -ne 'Deprecated') {
                    return [string] $entry.IPAddress
                }
            }
        }

        $addresses = Get-NetIPAddress -InterfaceAlias 'ProtonVPN' -AddressFamily IPv4 -ErrorAction SilentlyContinue
        foreach ($entry in $addresses) {
            if ($entry.IPAddress -and $entry.AddressState -ne 'Deprecated') {
                return [string] $entry.IPAddress
            }
        }
    } catch {}

    return ''
}

function Wait-ProtonLocalAddress {
    param([int] $Seconds = 12)

    $deadline = (Get-Date).AddSeconds($Seconds)
    do {
        $address = Get-ProtonLocalAddress
        if ($address) {
            return $address
        }

        Hide-ProtonWindows -Seconds 1
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)

    return ''
}

try {
    if ($TargetCountry -ne 'FASTEST' -and $TargetCountry -notmatch '^[A-Z]{2}$') {
        Write-Result @{ status = 'skipped'; reason = 'invalid-country'; location = $TargetCountry }
        exit 0
    }

    $install = Get-ProtonInstall
    if (-not $install) {
        Write-Result @{ status = 'skipped'; reason = 'proton-not-installed'; location = $TargetCountry }
        exit 0
    }

    $storage = Get-ProtonStoragePath
    if (-not $storage) {
        Write-Result @{ status = 'skipped'; reason = 'proton-storage-missing'; location = $TargetCountry }
        exit 0
    }

    $initialClientRunning = [bool](Get-Process -Name 'ProtonVPN', 'ProtonVPN.Client' -ErrorAction SilentlyContinue)
    $initialLocalAddress = Get-ProtonLocalAddress
    $preference = Set-ProtonPreferences -Install $install -StoragePath $storage -Country $TargetCountry
    $clientRunning = [bool](Get-Process -Name 'ProtonVPN', 'ProtonVPN.Client' -ErrorAction SilentlyContinue)
    $startedClient = $false

    if ($StartClient -and $preference.HasUser -and -not $clientRunning) {
        Hide-ProtonWindows -Seconds 1
        Start-Process -FilePath $install.Launcher -WindowStyle Hidden
        $startedClient = $true
        Hide-ProtonWindows -Seconds 8
    } elseif ($StartClient -and $clientRunning) {
        Hide-ProtonWindows -Seconds 2
    }

    $localAddress = if ($StartClient) {
        Wait-ProtonLocalAddress -Seconds 12
    } else {
        Get-ProtonLocalAddress
    }

    Write-Result @{
        status = 'configured'
        location = $TargetCountry
        localAddress = $localAddress
        clientRunning = $clientRunning
        initialClientRunning = $initialClientRunning
        initialConnected = [bool]$initialLocalAddress
        initialLocalAddress = $initialLocalAddress
        startedClient = $startedClient
        touchedVpn = [bool]($startedClient -or ($localAddress -and ($localAddress -ne $initialLocalAddress)))
        hasUser = [bool]$preference.HasUser
        defaultConnectionUpdated = [bool]$preference.DefaultConnectionUpdated
        createdRecent = [bool]$preference.CreatedRecent
    }
} catch {
    Write-Result @{
        status = 'failed'
        location = $TargetCountry
        reason = $_.Exception.Message
    }
}
`;
}

export class ProtonVpnIntegrationService {
    private readonly platform: NodeJS.Platform;
    private readonly spawnProcess: SpawnFunction;
    private readonly timeoutMs: number;
    private launchPrepared = false;
    private startedClientForSession = false;
    private sessionInitialClientRunning: boolean | undefined;
    private sessionInitialConnected: boolean | undefined;
    private sessionTouchedVpn = false;
    private sourceNetworkInFlight:
        | {
              key: string;
              promise: Promise<ProtonVpnIntegrationResult>;
          }
        | null = null;
    private sourceNetworkLastResult:
        | {
              key: string;
              checkedAt: number;
              result: ProtonVpnIntegrationResult;
          }
        | null = null;

    constructor(options: ProtonVpnIntegrationServiceOptions = {}) {
        this.platform = options.platform ?? process.platform;
        this.spawnProcess = options.spawn ?? spawn;
        this.timeoutMs = options.timeoutMs ?? POWERSHELL_TIMEOUT_MS;
    }

    async prepareForAppLaunch(): Promise<ProtonVpnIntegrationResult> {
        if (this.launchPrepared) {
            return {
                enabled: this.isEnabled(),
                location: this.getConfiguredLocation(),
                provider: this.getConfiguredProvider(),
                reason: 'already-prepared',
                status: 'skipped',
                lastCheckedAt: Date.now(),
            };
        }

        this.launchPrepared = true;
        return this.prepareForSourceNetwork();
    }

    async applyPreference(
        options: ProtonVpnPreferenceOptions
    ): Promise<ProtonVpnIntegrationResult> {
        const context = this.resolvePreferenceContext(options);

        if (this.platform !== 'win32') {
            return {
                enabled: context.enabled,
                location: context.location,
                provider: context.provider,
                reason: 'windows-only',
                status: 'skipped',
                lastCheckedAt: Date.now(),
            };
        }

        if (!context.enabled || context.provider !== 'proton') {
            return {
                enabled: context.enabled,
                location: context.location,
                provider: context.provider,
                reason: context.enabled ? 'unsupported-provider' : 'disabled',
                status: 'disabled',
                lastCheckedAt: Date.now(),
            };
        }

        const result = await this.runPreferenceScript(
            context.location,
            options.startClient,
            context
        );
        if (result.localAddress) {
            process.env.IPTVNATOR_SOURCE_LOCAL_ADDRESS = result.localAddress;
        }
        if (result.startedClient) {
            this.startedClientForSession = true;
        }
        if (result.startedClient || result.touchedVpn) {
            this.sessionInitialClientRunning ??= result.initialClientRunning;
            this.sessionInitialConnected ??= result.initialConnected;
            this.sessionTouchedVpn = true;
        }
        return result;
    }

    async prepareForSourceNetwork(
        sourceVpn?: SourceVpnRequestContext
    ): Promise<ProtonVpnIntegrationResult> {
        const context = this.resolveSourceNetworkContext(sourceVpn);
        if (!context.enabled || context.provider !== 'proton') {
            delete process.env.IPTVNATOR_SOURCE_LOCAL_ADDRESS;
            return {
                enabled: context.enabled,
                location: context.location,
                provider: context.provider,
                reason: context.enabled ? 'unsupported-provider' : 'disabled',
                status: 'disabled',
                lastCheckedAt: Date.now(),
            };
        }

        const key = [
            context.enabled ? 'enabled' : 'disabled',
            context.provider,
            context.location,
        ].join(':');
        const cached = this.sourceNetworkLastResult;
        if (
            cached?.key === key &&
            Date.now() - cached.checkedAt < SOURCE_NETWORK_PREPARATION_CACHE_MS &&
            hasUsableVpnAddress(cached.result)
        ) {
            return {
                ...cached.result,
                reason: 'already-prepared',
                lastCheckedAt: Date.now(),
            };
        }

        if (this.sourceNetworkInFlight?.key === key) {
            return this.sourceNetworkInFlight.promise;
        }

        const promise = this.applyPreference({
            enabled: context.enabled,
            provider: context.provider,
            location: context.location,
            startClient: true,
        }).then((result) => {
            if (hasUsableVpnAddress(result)) {
                this.sourceNetworkLastResult = {
                    key,
                    checkedAt: Date.now(),
                    result,
                };
            } else if (this.sourceNetworkLastResult?.key === key) {
                this.sourceNetworkLastResult = null;
            }

            return result;
        }).finally(() => {
            if (this.sourceNetworkInFlight?.key === key) {
                this.sourceNetworkInFlight = null;
            }
        });

        this.sourceNetworkInFlight = { key, promise };
        return promise;
    }

    getStatus(): ProtonVpnIntegrationResult {
        const enabled = this.isEnabled();
        const provider = this.getConfiguredProvider();
        return {
            enabled,
            location: this.getConfiguredLocation(),
            localAddress: normalizeLocalAddress(
                process.env.IPTVNATOR_SOURCE_LOCAL_ADDRESS
            ),
            provider,
            reason: enabled ? undefined : 'disabled',
            status: enabled && provider === 'proton' ? 'skipped' : 'disabled',
            lastCheckedAt: Date.now(),
        };
    }

    restoreAfterAppExit(): void {
        if (
            this.platform !== 'win32' ||
            !store.get(VPN_RESTORE_ON_EXIT, true)
        ) {
            return;
        }

        const cleanupAction =
            this.startedClientForSession ||
            this.sessionInitialClientRunning === false
                ? 'terminate-client'
                : this.sessionTouchedVpn &&
                    this.sessionInitialClientRunning === true &&
                    this.sessionInitialConnected === false
                  ? 'disconnect'
                  : 'none';

        if (cleanupAction === 'none') {
            return;
        }

        const script = `
$ErrorActionPreference = 'SilentlyContinue'
$Action = '${cleanupAction}'
Get-Process -Name 'ProtonVPN', 'ProtonVPN.Client', 'ProtonVPN.Launcher' -ErrorAction SilentlyContinue |
    ForEach-Object {
        try {
            if ($_.MainWindowHandle -ne 0) {
                $_.CloseMainWindow() | Out-Null
            }
        } catch {}
    }
Start-Sleep -Milliseconds 1200
Get-Process -Name 'ProtonVPN', 'ProtonVPN.Client', 'ProtonVPN.Launcher' -ErrorAction SilentlyContinue |
    Stop-Process -Force
`;
        const child = this.spawnProcess(
            'powershell.exe',
            [
                '-NoProfile',
                '-ExecutionPolicy',
                'Bypass',
                '-WindowStyle',
                'Hidden',
                '-Command',
                script,
            ],
            {
                detached: true,
                stdio: 'ignore',
                windowsHide: true,
            }
        );
        child.unref();
        this.startedClientForSession = false;
        this.sessionInitialClientRunning = undefined;
        this.sessionInitialConnected = undefined;
        this.sessionTouchedVpn = false;
    }

    private getConfiguredLocation(): string {
        return normalizeProtonVpnLocation(
            store.get(
                VPN_LOCATION,
                store.get(PROTON_VPN_LOCATION, DEFAULT_PROTON_VPN_LOCATION)
            )
        );
    }

    private getConfiguredProvider(): 'none' | 'proton' {
        const provider = store.get(
            VPN_PROVIDER,
            store.get(PROTON_VPN_INTEGRATION_ENABLED, true)
                ? 'proton'
                : 'none'
        );
        return provider === 'proton' ? 'proton' : 'none';
    }

    private isEnabled(): boolean {
        return store.get(
            VPN_INTEGRATION_ENABLED,
            store.get(PROTON_VPN_INTEGRATION_ENABLED, true)
        );
    }

    private resolvePreferenceContext(
        options: ProtonVpnPreferenceOptions
    ): ProtonVpnPreferenceContext {
        const provider =
            options.provider !== undefined
                ? options.provider === 'proton'
                    ? 'proton'
                    : 'none'
                : this.getConfiguredProvider();

        return {
            enabled: options.enabled ?? this.isEnabled(),
            location: normalizeProtonVpnLocation(
                options.location ?? this.getConfiguredLocation()
            ),
            provider,
        };
    }

    private resolveSourceNetworkContext(
        sourceVpn?: SourceVpnRequestContext
    ): ProtonVpnPreferenceContext {
        if (sourceVpn?.provider) {
            if (sourceVpn.provider !== 'proton') {
                return {
                    enabled: false,
                    provider: 'none',
                    location: normalizeProtonVpnLocation(
                        sourceVpn.location ?? this.getConfiguredLocation()
                    ),
                };
            }

            return {
                enabled: true,
                provider: 'proton',
                location: normalizeProtonVpnLocation(
                    sourceVpn.location ?? this.getConfiguredLocation()
                ),
            };
        }

        return {
            enabled: this.isEnabled(),
            provider: this.getConfiguredProvider(),
            location: this.getConfiguredLocation(),
        };
    }

    private runPreferenceScript(
        location: string,
        startClient: boolean,
        context?: ProtonVpnPreferenceContext
    ): Promise<ProtonVpnIntegrationResult> {
        return new Promise((resolve) => {
            const encodedCommand = encodePowerShellCommand(
                buildProtonVpnPreferenceScript(location, startClient)
            );
            const child = this.spawnProcess(
                'powershell.exe',
                [
                    '-NoProfile',
                    '-ExecutionPolicy',
                    'Bypass',
                    '-WindowStyle',
                    'Hidden',
                    '-EncodedCommand',
                    encodedCommand,
                ],
                {
                    stdio: ['ignore', 'pipe', 'pipe'],
                    windowsHide: true,
                }
            );
            let stdout = '';
            let stderr = '';
            let settled = false;
            const settle = (result: ProtonVpnIntegrationResult) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timeout);
                resolve(result);
            };
            const timeout = setTimeout(() => {
                child.kill();
                settle({
                    enabled: context?.enabled ?? this.isEnabled(),
                    location,
                    provider: context?.provider ?? this.getConfiguredProvider(),
                    reason: 'powershell-timeout',
                    status: 'timeout',
                    lastCheckedAt: Date.now(),
                });
            }, this.timeoutMs);

            child.stdout?.on('data', (chunk) => {
                stdout += String(chunk).slice(0, 8192);
            });
            child.stderr?.on('data', (chunk) => {
                stderr += String(chunk).slice(0, 8192);
            });
            child.on('error', (error) => {
                settle({
                    enabled: context?.enabled ?? this.isEnabled(),
                    location,
                    provider: context?.provider ?? this.getConfiguredProvider(),
                    reason: error.message,
                    status: 'failed',
                    lastCheckedAt: Date.now(),
                });
            });
            child.on('close', () => {
                settle(
                    this.parseScriptResult(location, stdout, stderr, context)
                );
            });
        });
    }

    private parseScriptResult(
        location: string,
        stdout: string,
        stderr: string,
        context?: ProtonVpnPreferenceContext
    ): ProtonVpnIntegrationResult {
        const lines = stdout
            .split(/\r?\n/)
            .map((item) => item.trim())
            .filter(Boolean);
        const line = lines.length > 0 ? lines[lines.length - 1] : undefined;

        if (line) {
            try {
                const parsed = JSON.parse(line) as {
                    clientRunning?: unknown;
                    initialClientRunning?: unknown;
                    initialConnected?: unknown;
                    initialLocalAddress?: unknown;
                    location?: unknown;
                    localAddress?: unknown;
                    reason?: unknown;
                    startedClient?: unknown;
                    status?: unknown;
                    touchedVpn?: unknown;
                };
                const status =
                    parsed.status === 'configured' ||
                    parsed.status === 'disabled' ||
                    parsed.status === 'failed' ||
                    parsed.status === 'skipped' ||
                    parsed.status === 'timeout'
                        ? parsed.status
                        : 'failed';

                return {
                    enabled: context?.enabled ?? this.isEnabled(),
                    location: normalizeProtonVpnLocation(
                        parsed.location ?? location
                    ),
                    localAddress: normalizeLocalAddress(parsed.localAddress),
                    provider: context?.provider ?? this.getConfiguredProvider(),
                    reason:
                        typeof parsed.reason === 'string'
                            ? parsed.reason
                            : undefined,
                    status,
                    clientRunning:
                        typeof parsed.clientRunning === 'boolean'
                            ? parsed.clientRunning
                            : undefined,
                    initialClientRunning:
                        typeof parsed.initialClientRunning === 'boolean'
                            ? parsed.initialClientRunning
                            : undefined,
                    initialConnected:
                        typeof parsed.initialConnected === 'boolean'
                            ? parsed.initialConnected
                            : undefined,
                    initialLocalAddress: normalizeLocalAddress(
                        parsed.initialLocalAddress
                    ),
                    startedClient:
                        typeof parsed.startedClient === 'boolean'
                            ? parsed.startedClient
                            : undefined,
                    touchedVpn:
                        typeof parsed.touchedVpn === 'boolean'
                            ? parsed.touchedVpn
                            : undefined,
                    lastCheckedAt: Date.now(),
                };
            } catch {
                // Fall through to the generic failure below.
            }
        }

        return {
            enabled: context?.enabled ?? this.isEnabled(),
            location,
            provider: context?.provider ?? this.getConfiguredProvider(),
            reason: stderr.trim() || 'invalid-powershell-result',
            status: 'failed',
            lastCheckedAt: Date.now(),
        };
    }
}

export const protonVpnIntegration = new ProtonVpnIntegrationService();
