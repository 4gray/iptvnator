import {
    LauncherVpnSessionService,
    resolveLauncherVpnCleanupPlan,
} from './launcher-vpn-session.service';

describe('launcher VPN session service', () => {
    const readyStatus = {
        state: 'ready',
        requiredCountry: 'HR',
        country: 'HR',
        cleanupProcessNames: ['ExampleVpn.Client'],
    };

    describe('resolveLauncherVpnCleanupPlan', () => {
        it('uses the explicit cleanup action when the launcher provides one', () => {
            expect(
                resolveLauncherVpnCleanupPlan({
                    ...readyStatus,
                    cleanupAction: 'terminate-client',
                })
            ).toEqual({
                action: 'terminate-client',
                processNames: ['ExampleVpn.Client'],
                reason: 'explicit-action',
            });
        });

        it('terminates a client that was started by the launcher', () => {
            expect(
                resolveLauncherVpnCleanupPlan({
                    ...readyStatus,
                    initialClientRunning: false,
                    initialRequiredCountry: false,
                    touchedVpn: true,
                })
            ).toEqual({
                action: 'terminate-client',
                processNames: ['ExampleVpn.Client'],
                reason: 'vpn-client-started-by-launcher',
            });
        });

        it('disconnects a client that was already open but disconnected', () => {
            expect(
                resolveLauncherVpnCleanupPlan({
                    ...readyStatus,
                    initialClientRunning: true,
                    initialConnected: false,
                    initialRequiredCountry: false,
                })
            ).toEqual({
                action: 'disconnect',
                processNames: ['ExampleVpn.Client'],
                reason: 'vpn-client-was-open-but-disconnected',
            });
        });

        it('does nothing when the launcher found the required route already active', () => {
            expect(
                resolveLauncherVpnCleanupPlan({
                    ...readyStatus,
                    initialClientRunning: true,
                    initialConnected: true,
                    initialRequiredCountry: true,
                })
            ).toEqual({
                action: 'none',
                processNames: ['ExampleVpn.Client'],
                reason: 'initially-ready',
            });
        });

        it('does not run process cleanup without launcher-owned process names', () => {
            expect(
                resolveLauncherVpnCleanupPlan({
                    ...readyStatus,
                    cleanupProcessNames: [],
                    initialClientRunning: false,
                    touchedVpn: true,
                })
            ).toEqual({
                action: 'none',
                processNames: [],
                reason: 'missing-process-names',
            });
        });
    });

    it('starts one hidden cleanup process at app shutdown', () => {
        const unref = jest.fn();
        const spawnProcess = jest.fn(() => ({ unref }));
        const service = new LauncherVpnSessionService({
            appendFileSync: jest.fn() as never,
            env: {
                IPTVNATOR_VPN_STATUS_FILE: 'C:\\tmp\\status.json',
            },
            existsSync: jest.fn(() => true) as never,
            readFileSync: jest.fn(() =>
                JSON.stringify({
                    ...readyStatus,
                    cleanupAction: 'disconnect',
                })
            ) as never,
            spawn: spawnProcess as never,
        });

        expect(service.restoreAfterAppExit()).toEqual({
            action: 'disconnect',
            processNames: ['ExampleVpn.Client'],
            reason: 'explicit-action',
        });
        expect(service.restoreAfterAppExit()).toEqual({
            action: 'none',
            processNames: [],
            reason: 'already-started',
        });

        expect(spawnProcess).toHaveBeenCalledTimes(1);
        expect(spawnProcess).toHaveBeenCalledWith(
            'powershell.exe',
            expect.arrayContaining(['-WindowStyle', 'Hidden']),
            expect.objectContaining({
                detached: true,
                stdio: 'ignore',
                windowsHide: true,
            })
        );
        expect(unref).toHaveBeenCalledTimes(1);
    });
});
