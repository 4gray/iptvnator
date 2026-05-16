import { spawn } from 'child_process';
import { appendFileSync, existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';

type CleanupAction = 'disconnect' | 'terminate-client';

export interface LauncherVpnStatusFile {
    cleanupAction?: unknown;
    cleanupCompletedAt?: unknown;
    cleanupProcessNames?: unknown;
    country?: unknown;
    initialClientRunning?: unknown;
    initialConnected?: unknown;
    initialCountry?: unknown;
    initialLocalAddress?: unknown;
    initialRequiredCountry?: unknown;
    localAddress?: unknown;
    requiredCountry?: unknown;
    state?: unknown;
    touchedVpn?: unknown;
}

export interface LauncherVpnCleanupPlan {
    action: CleanupAction | 'none';
    processNames: string[];
    reason: string;
}

interface LauncherVpnSessionServiceOptions {
    appendFileSync?: typeof appendFileSync;
    env?: NodeJS.ProcessEnv;
    existsSync?: typeof existsSync;
    readFileSync?: typeof readFileSync;
    spawn?: typeof spawn;
}

const STATUS_FILE_ENV = 'IPTVNATOR_VPN_STATUS_FILE';
const PROCESS_NAME_PATTERN = /^[a-z0-9_. -]+$/i;

function asString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function asBoolean(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
}

function normalizeCountry(value: unknown): string {
    return asString(value).toUpperCase();
}

function normalizeCleanupAction(value: unknown): CleanupAction | 'none' | '' {
    const action = asString(value).toLowerCase();

    if (
        action === 'terminate' ||
        action === 'terminate-client' ||
        action === 'close-client'
    ) {
        return 'terminate-client';
    }

    if (action === 'disconnect' || action === 'disconnect-client') {
        return 'disconnect';
    }

    if (action === 'none') {
        return 'none';
    }

    return '';
}

function normalizeProcessNames(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return [
        ...new Set(
            value
                .map((item) => asString(item))
                .filter((item) => item && PROCESS_NAME_PATTERN.test(item))
        ),
    ];
}

function wasInitiallyConnected(status: LauncherVpnStatusFile): boolean {
    const explicitValue = asBoolean(status.initialConnected);
    if (explicitValue !== undefined) {
        return explicitValue;
    }

    return Boolean(asString(status.initialLocalAddress));
}

function isReadyOnRequiredRoute(status: LauncherVpnStatusFile): boolean {
    const requiredCountry = normalizeCountry(status.requiredCountry);
    return (
        asString(status.state).toLowerCase() === 'ready' &&
        Boolean(requiredCountry) &&
        normalizeCountry(status.country) === requiredCountry
    );
}

export function resolveLauncherVpnCleanupPlan(
    status: LauncherVpnStatusFile | null | undefined
): LauncherVpnCleanupPlan {
    if (!status) {
        return {
            action: 'none',
            processNames: [],
            reason: 'missing-status',
        };
    }

    if (asString(status.cleanupCompletedAt)) {
        return {
            action: 'none',
            processNames: [],
            reason: 'already-cleaned',
        };
    }

    const processNames = normalizeProcessNames(status.cleanupProcessNames);
    const explicitAction = normalizeCleanupAction(status.cleanupAction);

    if (explicitAction === 'none') {
        return {
            action: 'none',
            processNames,
            reason: 'explicit-none',
        };
    }

    if (explicitAction && processNames.length > 0) {
        return {
            action: explicitAction,
            processNames,
            reason: 'explicit-action',
        };
    }

    if (!isReadyOnRequiredRoute(status)) {
        return {
            action: 'none',
            processNames,
            reason: 'not-ready',
        };
    }

    if (processNames.length === 0) {
        return {
            action: 'none',
            processNames,
            reason: 'missing-process-names',
        };
    }

    if (asBoolean(status.initialRequiredCountry) === true) {
        return {
            action: 'none',
            processNames,
            reason: 'initially-ready',
        };
    }

    const initialClientRunning = asBoolean(status.initialClientRunning);
    if (initialClientRunning === false && asBoolean(status.touchedVpn) === true) {
        return {
            action: 'terminate-client',
            processNames,
            reason: 'vpn-client-started-by-launcher',
        };
    }

    if (initialClientRunning === true && !wasInitiallyConnected(status)) {
        return {
            action: 'disconnect',
            processNames,
            reason: 'vpn-client-was-open-but-disconnected',
        };
    }

    return {
        action: 'none',
        processNames,
        reason: 'left-unchanged',
    };
}

function psSingleQuoted(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}

function buildCleanupScript(
    statusPath: string,
    logPath: string,
    plan: LauncherVpnCleanupPlan
): string {
    const processNames = plan.processNames
        .map((processName) => psSingleQuoted(processName))
        .join(', ');

    return `
$ErrorActionPreference = 'SilentlyContinue'
$StatusPath = ${psSingleQuoted(statusPath)}
$LogPath = ${psSingleQuoted(logPath)}
$Action = ${psSingleQuoted(plan.action)}
$Reason = ${psSingleQuoted(plan.reason)}
$ProcessNames = @(${processNames})

function Write-SessionLog {
    param([string] $Message)

    try {
        $logDir = Split-Path -Parent $LogPath
        if ($logDir -and -not (Test-Path -LiteralPath $logDir)) {
            New-Item -ItemType Directory -Path $logDir -Force | Out-Null
        }
        $timestamp = Get-Date -Format 'dd/MM/yyyy HH:mm:ss'
        Add-Content -LiteralPath $LogPath -Value "[$timestamp] $Message"
    } catch {}
}

function Update-SessionStatus {
    param([string] $State)

    try {
        if (-not (Test-Path -LiteralPath $StatusPath)) {
            return
        }

        $status = Get-Content -LiteralPath $StatusPath -Raw | ConvertFrom-Json
        $propertyName = if ($State -eq 'completed') { 'cleanupCompletedAt' } else { 'cleanupStartedAt' }
        $status | Add-Member -NotePropertyName $propertyName -NotePropertyValue ((Get-Date).ToString('o')) -Force
        $status | Add-Member -NotePropertyName 'cleanupResult' -NotePropertyValue $State -Force
        $status | Add-Member -NotePropertyName 'cleanupReason' -NotePropertyValue $Reason -Force
        $status | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $StatusPath -Encoding UTF8
    } catch {
        Write-SessionLog "Could not update VPN session status: $($_.Exception.Message)"
    }
}

function Stop-ManagedProcesses {
    foreach ($processName in $ProcessNames) {
        $targets = @(Get-Process -Name $processName -ErrorAction SilentlyContinue)
        foreach ($target in $targets) {
            try {
                if ($target.MainWindowHandle -ne 0) {
                    $target.CloseMainWindow() | Out-Null
                }
            } catch {}
        }
    }

    Start-Sleep -Milliseconds 1200

    foreach ($processName in $ProcessNames) {
        $targets = @(Get-Process -Name $processName -ErrorAction SilentlyContinue)
        foreach ($target in $targets) {
            try {
                Stop-Process -Id $target.Id -Force
            } catch {
                Write-SessionLog "Could not stop managed VPN process $processName ($($target.Id)): $($_.Exception.Message)"
            }
        }
    }
}

Write-SessionLog "VPN session cleanup started: action=$Action reason=$Reason"
Update-SessionStatus 'started'
Stop-ManagedProcesses
Update-SessionStatus 'completed'
Write-SessionLog "VPN session cleanup completed: action=$Action reason=$Reason"
`;
}

export class LauncherVpnSessionService {
    private readonly appendFile: typeof appendFileSync;
    private readonly env: NodeJS.ProcessEnv;
    private readonly fileExists: typeof existsSync;
    private readonly readFile: typeof readFileSync;
    private readonly spawnProcess: typeof spawn;
    private cleanupStarted = false;

    constructor(options: LauncherVpnSessionServiceOptions = {}) {
        this.appendFile = options.appendFileSync ?? appendFileSync;
        this.env = options.env ?? process.env;
        this.fileExists = options.existsSync ?? existsSync;
        this.readFile = options.readFileSync ?? readFileSync;
        this.spawnProcess = options.spawn ?? spawn;
    }

    restoreAfterAppExit(): LauncherVpnCleanupPlan {
        if (this.cleanupStarted) {
            return {
                action: 'none',
                processNames: [],
                reason: 'already-started',
            };
        }

        const statusPath = asString(this.env[STATUS_FILE_ENV]);
        if (!statusPath || !this.fileExists(statusPath)) {
            return {
                action: 'none',
                processNames: [],
                reason: 'missing-status-file',
            };
        }

        const status = this.readStatus(statusPath);
        const plan = resolveLauncherVpnCleanupPlan(status);
        if (plan.action === 'none') {
            this.log(statusPath, `VPN session cleanup skipped: ${plan.reason}`);
            return plan;
        }

        this.cleanupStarted = true;
        this.startCleanupProcess(statusPath, plan);
        return plan;
    }

    private readStatus(statusPath: string): LauncherVpnStatusFile | null {
        try {
            return JSON.parse(this.readFile(statusPath, 'utf8'));
        } catch (error) {
            this.log(
                statusPath,
                `VPN session cleanup skipped: invalid status file (${error instanceof Error ? error.message : String(error)})`
            );
            return null;
        }
    }

    private startCleanupProcess(
        statusPath: string,
        plan: LauncherVpnCleanupPlan
    ): void {
        const logPath = join(dirname(statusPath), 'vpn-session-cleanup.log');
        const script = buildCleanupScript(statusPath, logPath, plan);
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
    }

    private log(statusPath: string, message: string): void {
        try {
            const logPath = join(dirname(statusPath), 'vpn-session-cleanup.log');
            const timestamp = new Date().toISOString();
            this.appendFile(logPath, `[${timestamp}] ${message}\n`);
        } catch {
            // Logging must never block shutdown.
        }
    }
}

export const launcherVpnSession = new LauncherVpnSessionService();
