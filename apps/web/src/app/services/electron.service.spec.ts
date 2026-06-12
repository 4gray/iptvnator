import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { DialogService } from '@iptvnator/ui/components';
import { SettingsStore } from '@iptvnator/services';
import {
    ELECTRON_BRIDGE_SECURITY_ERROR_CODES,
    PLAYLIST_PARSE_BY_URL,
    SECURITY_ERROR_PREFIX,
} from '@iptvnator/shared/interfaces';
import { ElectronService } from './electron.service';

describe('ElectronService', () => {
    const session = { id: 'session-1' };
    let electronBridge: {
        fetchPlaylistByUrl: jest.Mock;
        openInMpv: jest.Mock;
        openInVlc: jest.Mock;
    };
    let snackBar: { open: jest.Mock };
    let service: ElectronService;

    beforeEach(() => {
        jest.spyOn(console, 'log').mockImplementation(() => undefined);

        electronBridge = {
            fetchPlaylistByUrl: jest.fn(),
            openInMpv: jest.fn().mockResolvedValue(session),
            openInVlc: jest.fn().mockResolvedValue(session),
        };
        snackBar = {
            open: jest.fn(() => ({
                onAction: () => of(undefined),
            })),
        };

        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: electronBridge,
        });

        TestBed.configureTestingModule({
            providers: [
                ElectronService,
                {
                    provide: MatSnackBar,
                    useValue: snackBar,
                },
                {
                    provide: DialogService,
                    useValue: {
                        openConfirmDialog: jest.fn(),
                    },
                },
                {
                    provide: SettingsStore,
                    useValue: {
                        getTrustOptions: jest.fn(() => ({
                            trustedPrivateNetworkEpgUrls: [],
                            trustedInsecureTlsHosts: [],
                        })),
                        getSettings: jest.fn(() => ({
                            trustedInsecureTlsHosts: [],
                        })),
                        updateSettings: jest.fn().mockResolvedValue(undefined),
                    },
                },
                {
                    provide: Store,
                    useValue: {
                        dispatch: jest.fn(),
                    },
                },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: jest.fn((key: string) => key),
                    },
                },
            ],
        });

        service = TestBed.inject(ElectronService);
    });

    afterEach(() => {
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: undefined,
        });
        jest.restoreAllMocks();
    });

    it('ignores URL imports without a payload instead of calling the Electron bridge', async () => {
        await service.sendIpcEvent(PLAYLIST_PARSE_BY_URL);

        expect(electronBridge.fetchPlaylistByUrl).not.toHaveBeenCalled();
    });

    it('shows the trust-host action for Electron-wrapped security errors', async () => {
        const securityPayload = {
            code: ELECTRON_BRIDGE_SECURITY_ERROR_CODES.InvalidTlsCertificate,
            host: 'playlist.local',
            message: 'Certificate for this playlist host is invalid.',
        };
        electronBridge.fetchPlaylistByUrl.mockRejectedValue(
            new Error(
                `Error invoking remote method 'FETCH_PLAYLIST_BY_URL': Error: ${SECURITY_ERROR_PREFIX}${JSON.stringify(
                    securityPayload
                )}`
            )
        );

        await service.sendIpcEvent(PLAYLIST_PARSE_BY_URL, {
            url: 'https://playlist.local/list.m3u',
        });
        await Promise.resolve();

        expect(snackBar.open).toHaveBeenCalledWith(
            'Certificate for this playlist host is invalid.',
            'Trust host',
            { duration: 10000 }
        );
    });

    it('preserves an absent MPV user-agent so backend fallback headers can apply', async () => {
        await service.sendIpcEvent('OPEN_MPV_PLAYER', {
            url: 'https://example.test/live.m3u8',
            headers: {
                'User-Agent': 'FallbackAgent/1.0',
            },
        });

        expect(electronBridge.openInMpv).toHaveBeenCalledWith(
            'https://example.test/live.m3u8',
            '',
            '',
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            {
                'User-Agent': 'FallbackAgent/1.0',
            }
        );
    });

    it('preserves an absent VLC user-agent so backend fallback headers can apply', async () => {
        await service.sendIpcEvent('OPEN_VLC_PLAYER', {
            url: 'https://example.test/live.m3u8',
            headers: {
                'User-Agent': 'FallbackAgent/1.0',
            },
        });

        expect(electronBridge.openInVlc).toHaveBeenCalledWith(
            'https://example.test/live.m3u8',
            '',
            '',
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            {
                'User-Agent': 'FallbackAgent/1.0',
            }
        );
    });
});
