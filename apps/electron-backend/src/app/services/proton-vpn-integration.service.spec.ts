jest.mock('./store.service', () => ({
    PROTON_VPN_INTEGRATION_ENABLED: 'protonVpnIntegrationEnabled',
    PROTON_VPN_LOCATION: 'protonVpnLocation',
    VPN_INTEGRATION_ENABLED: 'vpnIntegrationEnabled',
    VPN_LOCATION: 'vpnLocation',
    VPN_PROVIDER: 'vpnProvider',
    VPN_RESTORE_ON_EXIT: 'vpnRestoreOnExit',
    store: {
        get: jest.fn((key: string, defaultValue: unknown) => {
            if (key === 'vpnIntegrationEnabled') {
                return true;
            }
            if (key === 'vpnProvider') {
                return 'proton';
            }
            return defaultValue;
        }),
    },
}));

import {
    buildProtonVpnPreferenceScript,
    normalizeProtonVpnLocation,
    ProtonVpnIntegrationService,
} from './proton-vpn-integration.service';

describe('Proton VPN integration service', () => {
    beforeEach(() => {
        delete process.env.IPTVNATOR_SOURCE_LOCAL_ADDRESS;
    });

    afterEach(() => {
        delete process.env.IPTVNATOR_SOURCE_LOCAL_ADDRESS;
    });

    it('normalizes Proton VPN locations defensively', () => {
        expect(normalizeProtonVpnLocation('hr')).toBe('HR');
        expect(normalizeProtonVpnLocation(' FASTEST ')).toBe('FASTEST');
        expect(normalizeProtonVpnLocation('croatia')).toBe('HR');
        expect(normalizeProtonVpnLocation(undefined)).toBe('HR');
    });

    it('builds a hidden Proton preference script for tray startup', () => {
        const script = buildProtonVpnPreferenceScript('HR', true);

        expect(script).toContain("$TargetCountry = 'HR'");
        expect(script).toContain('AutoLaunchMode');
        expect(script).toContain('MinimizeToSystemTray');
        expect(script).toContain('IsAutoConnectEnabled');
        expect(script).toContain('DefaultConnection');
        expect(script).toContain('Hide-ProtonWindows');
        expect(script).toContain('Wait-ProtonLocalAddress');
        expect(script).toContain('Get-NetAdapter');
        expect(script).toContain('WireGuard Tunnel');
        expect(script).toContain('$initialClientRunning');
        expect(script).toContain('initialConnected');
        expect(script).toContain('touchedVpn');
        expect(script).toContain(
            'if ($StartClient -and $preference.HasUser -and -not $clientRunning)'
        );
        expect(script).toContain(
            '} elseif ($StartClient -and $clientRunning) {'
        );
        expect(script).toContain('ProtonVPN.Launcher.exe');
    });

    it('skips non-Windows platforms before spawning PowerShell', async () => {
        const spawnProcess = jest.fn();
        const service = new ProtonVpnIntegrationService({
            platform: 'linux',
            spawn: spawnProcess as never,
        });

        await expect(service.prepareForAppLaunch()).resolves.toEqual(
            expect.objectContaining({
                enabled: true,
                location: 'HR',
                provider: 'proton',
                reason: 'windows-only',
                status: 'skipped',
            })
        );
        expect(spawnProcess).not.toHaveBeenCalled();
    });

    it('runs PowerShell hidden on Windows', async () => {
        const stdoutHandlers = new Map<string, (chunk: string) => void>();
        const closeHandlers = new Map<string, () => void>();
        const spawnProcess = jest.fn(() => ({
            kill: jest.fn(),
            on: (event: string, handler: () => void) => {
                closeHandlers.set(event, handler);
            },
            stdout: {
                on: (event: string, handler: (chunk: string) => void) => {
                    stdoutHandlers.set(event, handler);
                },
            },
            stderr: {
                on: jest.fn(),
            },
        }));
        const service = new ProtonVpnIntegrationService({
            platform: 'win32',
            spawn: spawnProcess as never,
            timeoutMs: 1000,
        });

        const result = service.prepareForAppLaunch();
        stdoutHandlers
            .get('data')
            ?.(
                '{"status":"configured","location":"HR","localAddress":"10.2.0.9"}\n'
            );
        closeHandlers.get('close')?.();

        await expect(result).resolves.toEqual(
            expect.objectContaining({
                enabled: true,
                location: 'HR',
                localAddress: '10.2.0.9',
                provider: 'proton',
                reason: undefined,
                status: 'configured',
            })
        );
        expect(process.env.IPTVNATOR_SOURCE_LOCAL_ADDRESS).toBe('10.2.0.9');
        expect(spawnProcess).toHaveBeenCalledWith(
            'powershell.exe',
            expect.arrayContaining(['-WindowStyle', 'Hidden']),
            expect.objectContaining({
                windowsHide: true,
            })
        );
    });

    it('uses source-scoped Proton location overrides without changing global settings', async () => {
        const stdoutHandlers = new Map<string, (chunk: string) => void>();
        const closeHandlers = new Map<string, () => void>();
        const spawnProcess = jest.fn(() => ({
            kill: jest.fn(),
            on: (event: string, handler: () => void) => {
                closeHandlers.set(event, handler);
            },
            stdout: {
                on: (event: string, handler: (chunk: string) => void) => {
                    stdoutHandlers.set(event, handler);
                },
            },
            stderr: {
                on: jest.fn(),
            },
        }));
        const service = new ProtonVpnIntegrationService({
            platform: 'win32',
            spawn: spawnProcess as never,
            timeoutMs: 1000,
        });

        const result = service.applyPreference({
            enabled: true,
            location: 'DE',
            provider: 'proton',
            startClient: true,
        });
        stdoutHandlers
            .get('data')
            ?.('{"status":"configured","location":"DE"}\n');
        closeHandlers.get('close')?.();

        await expect(result).resolves.toEqual(
            expect.objectContaining({
                enabled: true,
                location: 'DE',
                provider: 'proton',
                status: 'configured',
            })
        );

        const spawnCalls = spawnProcess.mock.calls as unknown as [
            string,
            string[],
            unknown,
        ][];
        const spawnArgs = spawnCalls[0][1];
        const encodedCommand =
            spawnArgs[spawnArgs.indexOf('-EncodedCommand') + 1];
        const script = Buffer.from(encodedCommand, 'base64').toString(
            'utf16le'
        );

        expect(script).toContain("$TargetCountry = 'DE'");
    });

    it('prepares source network traffic through Proton once and reuses the tunnel address', async () => {
        const stdoutHandlers: Array<(chunk: string) => void> = [];
        const closeHandlers: Array<() => void> = [];
        const spawnProcess = jest.fn(() => ({
            kill: jest.fn(),
            on: (event: string, handler: () => void) => {
                if (event === 'close') {
                    closeHandlers.push(handler);
                }
            },
            stdout: {
                on: (event: string, handler: (chunk: string) => void) => {
                    if (event === 'data') {
                        stdoutHandlers.push(handler);
                    }
                },
            },
            stderr: {
                on: jest.fn(),
            },
        }));
        const service = new ProtonVpnIntegrationService({
            platform: 'win32',
            spawn: spawnProcess as never,
            timeoutMs: 1000,
        });

        const first = service.prepareForSourceNetwork({
            provider: 'proton',
            location: 'DE',
            sourceId: 'source-1',
        });
        stdoutHandlers[0]?.(
            '{"status":"configured","location":"DE","localAddress":"10.2.0.9"}\n'
        );
        closeHandlers[0]?.();

        await expect(first).resolves.toEqual(
            expect.objectContaining({
                enabled: true,
                location: 'DE',
                localAddress: '10.2.0.9',
                provider: 'proton',
                status: 'configured',
            })
        );

        await expect(
            service.prepareForSourceNetwork({
                provider: 'proton',
                location: 'DE',
                sourceId: 'source-1',
            })
        ).resolves.toEqual(
            expect.objectContaining({
                location: 'DE',
                localAddress: '10.2.0.9',
                reason: 'already-prepared',
            })
        );
        expect(spawnProcess).toHaveBeenCalledTimes(1);
        expect(process.env.IPTVNATOR_SOURCE_LOCAL_ADDRESS).toBe('10.2.0.9');
    });

    it('lets a source-level none provider override the global Proton default', async () => {
        process.env.IPTVNATOR_SOURCE_LOCAL_ADDRESS = '10.2.0.9';
        const spawnProcess = jest.fn();
        const service = new ProtonVpnIntegrationService({
            platform: 'win32',
            spawn: spawnProcess as never,
            timeoutMs: 1000,
        });

        await expect(
            service.prepareForSourceNetwork({
                provider: 'none',
                location: 'HR',
                sourceId: 'source-1',
            })
        ).resolves.toEqual(
            expect.objectContaining({
                enabled: false,
                location: 'HR',
                provider: 'none',
                reason: 'disabled',
                status: 'disabled',
            })
        );
        expect(spawnProcess).not.toHaveBeenCalled();
        expect(process.env.IPTVNATOR_SOURCE_LOCAL_ADDRESS).toBeUndefined();
    });

    it('restores Proton after a background-owned session started the client', async () => {
        const stdoutHandlers: Array<(chunk: string) => void> = [];
        const closeHandlers: Array<() => void> = [];
        const unref = jest.fn();
        const spawnProcess = jest.fn(() => ({
            kill: jest.fn(),
            on: (event: string, handler: () => void) => {
                if (event === 'close') {
                    closeHandlers.push(handler);
                }
            },
            stdout: {
                on: (event: string, handler: (chunk: string) => void) => {
                    if (event === 'data') {
                        stdoutHandlers.push(handler);
                    }
                },
            },
            stderr: {
                on: jest.fn(),
            },
            unref,
        }));
        const service = new ProtonVpnIntegrationService({
            platform: 'win32',
            spawn: spawnProcess as never,
            timeoutMs: 1000,
        });

        const result = service.prepareForSourceNetwork({
            provider: 'proton',
            location: 'HR',
        });
        stdoutHandlers[0]?.(
            '{"status":"configured","location":"HR","localAddress":"10.2.0.9","initialClientRunning":false,"initialConnected":false,"startedClient":true,"touchedVpn":true}\n'
        );
        closeHandlers[0]?.();
        await result;

        service.restoreAfterAppExit();

        expect(spawnProcess).toHaveBeenCalledTimes(2);
        expect(spawnProcess).toHaveBeenLastCalledWith(
            'powershell.exe',
            expect.arrayContaining(['-WindowStyle', 'Hidden']),
            expect.objectContaining({
                detached: true,
                windowsHide: true,
            })
        );
        expect(unref).toHaveBeenCalled();
    });

    it('runs cleanup after a background warmup connected a previously disconnected open client', async () => {
        const stdoutHandlers: Array<(chunk: string) => void> = [];
        const closeHandlers: Array<() => void> = [];
        const unref = jest.fn();
        const spawnProcess = jest.fn(() => ({
            kill: jest.fn(),
            on: (event: string, handler: () => void) => {
                if (event === 'close') {
                    closeHandlers.push(handler);
                }
            },
            stdout: {
                on: (event: string, handler: (chunk: string) => void) => {
                    if (event === 'data') {
                        stdoutHandlers.push(handler);
                    }
                },
            },
            stderr: {
                on: jest.fn(),
            },
            unref,
        }));
        const service = new ProtonVpnIntegrationService({
            platform: 'win32',
            spawn: spawnProcess as never,
            timeoutMs: 1000,
        });

        const result = service.prepareForSourceNetwork({
            provider: 'proton',
            location: 'HR',
        });
        stdoutHandlers[0]?.(
            '{"status":"configured","location":"HR","localAddress":"10.2.0.9","initialClientRunning":true,"initialConnected":false,"startedClient":false,"touchedVpn":true}\n'
        );
        closeHandlers[0]?.();
        await result;

        service.restoreAfterAppExit();

        expect(spawnProcess).toHaveBeenCalledTimes(2);
        expect(unref).toHaveBeenCalled();
    });
});
