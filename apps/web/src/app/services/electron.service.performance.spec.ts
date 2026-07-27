import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { SettingsStore } from '@iptvnator/services';
import {
    PLAYLIST_PARSE_BY_URL,
    type Playlist,
} from '@iptvnator/shared/interfaces';
import {
    RENDERER_PERFORMANCE_PHASE_HOOK_KEY,
    type RendererPerformancePhaseEvent,
} from '@iptvnator/shared/logging';
import { DialogService } from '@iptvnator/ui/components';
import { ElectronService } from './electron.service';

describe('ElectronService performance phases', () => {
    const hookSymbol = Symbol.for(RENDERER_PERFORMANCE_PHASE_HOOK_KEY);
    const electronBridge = {
        fetchPlaylistByUrl: jest.fn(),
        onPlayerError: jest.fn(),
    };
    const store = { dispatch: jest.fn() };
    let service: ElectronService;

    beforeEach(() => {
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: electronBridge,
        });
        electronBridge.fetchPlaylistByUrl.mockReset();
        electronBridge.onPlayerError.mockReset();
        store.dispatch.mockReset();

        TestBed.configureTestingModule({
            providers: [
                ElectronService,
                {
                    provide: DialogService,
                    useValue: { openConfirmDialog: jest.fn() },
                },
                {
                    provide: MatSnackBar,
                    useValue: { open: jest.fn() },
                },
                {
                    provide: SettingsStore,
                    useValue: {
                        getTrustOptions: jest.fn(() => ({
                            trustedInsecureTlsHosts: [],
                            trustedPrivateNetworkEpgUrls: [],
                        })),
                    },
                },
                { provide: Store, useValue: store },
                {
                    provide: TranslateService,
                    useValue: { instant: jest.fn((key: string) => key) },
                },
            ],
        });
        service = TestBed.inject(ElectronService);
    });

    afterEach(() => {
        delete (globalThis as unknown as Record<symbol, unknown>)[hookSymbol];
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: undefined,
        });
    });

    it('marks the initial URL import store dispatch without exposing playlist data', async () => {
        const events: RendererPerformancePhaseEvent[] = [];
        (
            globalThis as unknown as Record<
                symbol,
                (event: RendererPerformancePhaseEvent) => void
            >
        )[hookSymbol] = (event) => events.push(event);
        const playlist = {
            playlist: { items: [{ name: 'Sensitive channel' }] },
            title: 'Sensitive title',
            url: 'https://user:secret@example.test/list.m3u',
        } as Playlist;
        electronBridge.fetchPlaylistByUrl.mockResolvedValue(playlist);

        await service.sendIpcEvent(PLAYLIST_PARSE_BY_URL, {
            title: playlist.title,
            url: playlist.url,
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(store.dispatch).toHaveBeenCalledWith(
            PlaylistActions.handleAddingPlaylistByUrl({
                isTemporary: false,
                playlist,
            })
        );
        expect(
            events.map(({ boundary, outcome, phase }) => ({
                boundary,
                outcome,
                phase,
            }))
        ).toEqual([
            {
                boundary: 'start',
                outcome: undefined,
                phase: 'store.m3u-import-dispatch',
            },
            {
                boundary: 'end',
                outcome: 'success',
                phase: 'store.m3u-import-dispatch',
            },
        ]);
        expect(JSON.stringify(events)).not.toContain('Sensitive');
        expect(JSON.stringify(events)).not.toContain('secret');
    });
});
