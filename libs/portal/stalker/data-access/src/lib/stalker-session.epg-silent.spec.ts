import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DataService, PlaylistsService } from '@iptvnator/services';
import {
    Playlist,
    CONNECTIVITY_GUARD_RESET,
    STALKER_REQUEST,
} from '@iptvnator/shared/interfaces';
import { StalkerPortalDiscoveryService } from './stalker-portal-discovery.service';
import { StalkerSessionService } from './stalker-session.service';

/** Real session + auth API: token lookup is deliberately not mocked. */
describe('background Stalker EPG authentication', () => {
    const playlist = {
        _id: 'quiet-guide',
        portalUrl: 'https://example.test/server/load.php',
        macAddress: '00:1A:79:AA:BB:CC',
        isFullStalkerPortal: true,
        username: 'test-user',
        password: 'test-password',
    } as Playlist;
    const params = { action: 'get_short_epg', type: 'itv', ch_id: '7' };
    let send: jest.Mock;
    let service: StalkerSessionService;

    beforeEach(() => {
        Object.defineProperty(globalThis, 'crypto', {
            configurable: true,
            value: {
                subtle: {
                    digest: jest.fn(
                        async () => new Uint8Array(20).fill(1).buffer
                    ),
                },
            },
        });
        send = jest.fn();
        TestBed.configureTestingModule({
            providers: [
                StalkerSessionService,
                { provide: DataService, useValue: { sendIpcEvent: send } },
                {
                    provide: PlaylistsService,
                    useValue: {
                        getPlaylistById: jest.fn(() => of(undefined)),
                        updateStalkerSession: jest.fn(() => of(null)),
                    },
                },
            ],
        });
        service = TestBed.inject(StalkerSessionService);
    });

    it.each([
        'handshake',
        'get_profile',
        'do_auth',
        'profile_retry',
        'renewal',
    ])(
        'keeps a failed %s silent through the real token path',
        async (failure) => {
            let handshakes = 0;
            let profiles = 0;
            send.mockImplementation(
                async (
                    _event: string,
                    payload: { params: { action: string } }
                ) => {
                    const action = payload.params.action;
                    if (action === 'handshake') {
                        handshakes++;
                        if (
                            failure === action ||
                            (failure === 'renewal' && handshakes === 2)
                        )
                            throw new Error('Authentication unavailable');
                        return {
                            js: {
                                token: `token-${handshakes}`,
                                random: 'random',
                            },
                        };
                    }
                    if (action === 'get_profile') {
                        profiles++;
                        if (
                            failure === action ||
                            (failure === 'profile_retry' && profiles === 2)
                        )
                            throw new Error('Authentication unavailable');
                        return {
                            js: {
                                status: ['do_auth', 'profile_retry'].includes(
                                    failure
                                )
                                    ? 2
                                    : 0,
                            },
                        };
                    }
                    if (action === 'do_auth') {
                        if (failure === action)
                            throw new Error('Authentication unavailable');
                        return { js: true };
                    }
                    return 'Authorization failed.';
                }
            );
            await expect(
                service.makeAuthenticatedRequest(playlist, params, true, {
                    silent: true,
                })
            ).rejects.toThrow('Authentication unavailable');
            expect(send).toHaveBeenCalled();
            for (const [, payload] of send.mock.calls)
                expect(payload.silent).toBe(true);
        }
    );

    it.each([true, false])(
        'keeps discovery authentication on the initiating notification policy (silent=%s)',
        async (silent) => {
            send.mockImplementation(
                async (
                    event: string,
                    payload: { params?: { action: string } }
                ) => {
                    if (event === CONNECTIVITY_GUARD_RESET)
                        return { success: true };
                    if (payload.params?.action === 'handshake')
                        throw new Error('Authentication unavailable');
                    return 'Authorization failed.';
                }
            );
            const discovery = TestBed.inject(StalkerPortalDiscoveryService);
            const result = await discovery.discover(
                playlist.portalUrl ?? '',
                playlist.macAddress ?? '',
                {},
                { silent }
            );
            expect(result.status).toBe('auth-rejected');
            const authCalls = send.mock.calls.filter(
                ([event, payload]) =>
                    event === STALKER_REQUEST &&
                    payload.params.action === 'handshake'
            );
            expect(authCalls.length).toBeGreaterThan(0);
            for (const [, payload] of authCalls)
                expect(Boolean(payload.silent)).toBe(silent);
        }
    );

    it('keeps foreground authentication errors visible', async () => {
        send.mockRejectedValue(new Error('Authentication unavailable'));
        await expect(
            service.makeAuthenticatedRequest(playlist, {
                action: 'get_genres',
                type: 'itv',
            })
        ).rejects.toThrow('Authentication unavailable');
        expect(send.mock.calls[0][1].silent).not.toBe(true);
    });
});
