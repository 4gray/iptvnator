import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { StreamResolverService } from '@iptvnator/portal/shared/data-access';
import { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import { MultiviewPageComponent } from './multiview-page.component';
import {
    MultiviewSlotChannel,
    MULTIVIEW_STORAGE_KEY,
} from './multiview-state.service';

jest.mock('./multiview-tile-engine', () => {
    class MockMultiviewTileEngine {
        start = jest.fn();
        destroy = jest.fn();
    }
    return { MultiviewTileEngine: MockMultiviewTileEngine };
});

function buildSlot(
    overrides: Partial<UnifiedCollectionItem> = {}
): MultiviewSlotChannel {
    return {
        item: {
            uid: 'm3u::playlist-1::1',
            name: 'Channel One',
            contentType: 'live',
            sourceType: 'm3u',
            playlistId: 'playlist-1',
            playlistName: 'My Playlist',
            logo: 'http://example.com/logo.png',
            ...overrides,
        } as UnifiedCollectionItem,
        origin: 'favorites',
    };
}

describe('MultiviewPageComponent', () => {
    let fixture: ComponentFixture<MultiviewPageComponent>;
    let component: MultiviewPageComponent;
    let streamResolver: { resolvePlayback: jest.Mock };
    let dialog: { open: jest.Mock };
    let router: { navigate: jest.Mock };

    beforeEach(async () => {
        localStorage.removeItem(MULTIVIEW_STORAGE_KEY);
        streamResolver = {
            resolvePlayback: jest.fn().mockResolvedValue({
                streamUrl: 'http://example.com/live.m3u8',
                title: 'Channel One',
                thumbnail: null,
                isLive: true,
            }),
        };
        dialog = { open: jest.fn() };
        router = { navigate: jest.fn().mockResolvedValue(true) };

        await TestBed.configureTestingModule({
            imports: [MultiviewPageComponent, TranslateModule.forRoot()],
            providers: [
                provideNoopAnimations(),
                { provide: StreamResolverService, useValue: streamResolver },
                { provide: MatDialog, useValue: dialog },
                { provide: Router, useValue: router },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(MultiviewPageComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    async function flush(): Promise<void> {
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
    }

    it('starts with the default 2x2 layout and only add buttons', () => {
        expect(component.state.layoutId()).toBe('grid-2x2');
        expect(
            fixture.nativeElement.querySelectorAll('.multiview-add')
        ).toHaveLength(4);
        expect(streamResolver.resolvePlayback).not.toHaveBeenCalled();
    });

    it('resolves playback for an assigned slot and renders a ready tile', async () => {
        const slot = buildSlot();
        component.state.assign(0, slot);
        await flush();

        expect(streamResolver.resolvePlayback).toHaveBeenCalledTimes(1);
        expect(streamResolver.resolvePlayback).toHaveBeenCalledWith(slot.item);
        expect(component.resolutionFor(slot)).toEqual({
            status: 'ready',
            playback: {
                url: 'http://example.com/live.m3u8',
                title: 'Channel One',
                logo: 'http://example.com/logo.png',
                userAgent: undefined,
                referer: undefined,
            },
            errorKey: null,
        });
        expect(
            fixture.nativeElement.querySelectorAll('lib-multiview-tile')
        ).toHaveLength(1);
    });

    it('marks a slot as error when resolution fails and retries on demand', async () => {
        streamResolver.resolvePlayback.mockRejectedValueOnce(
            new Error('offline')
        );
        const slot = buildSlot();
        component.state.assign(0, slot);
        await flush();

        expect(component.resolutionFor(slot).status).toBe('error');
        expect(component.resolutionFor(slot).errorKey).toBe(
            'MULTIVIEW.TILE_ERROR'
        );

        component.retry(slot);
        await flush();

        expect(streamResolver.resolvePlayback).toHaveBeenCalledTimes(2);
        expect(component.resolutionFor(slot).status).toBe('ready');
    });

    it('does not re-resolve unchanged slots and drops removed resolutions', async () => {
        const slot = buildSlot();
        component.state.assign(0, slot);
        await flush();
        component.state.assign(
            1,
            buildSlot({ uid: 'm3u::playlist-1::2', name: 'Channel Two' })
        );
        await flush();

        expect(streamResolver.resolvePlayback).toHaveBeenCalledTimes(2);

        component.state.remove(0);
        await flush();
        expect(component.resolutionFor(slot).status).toBe('resolving');

        component.state.assign(0, slot);
        await flush();
        expect(streamResolver.resolvePlayback).toHaveBeenCalledTimes(3);
    });

    it('assigns a picked channel from the dialog', async () => {
        const slot = buildSlot();
        dialog.open.mockReturnValue({ afterClosed: () => of(slot) });

        await component.openPicker(2);
        await flush();

        expect(component.state.slots()[2]).toEqual(slot);
        expect(streamResolver.resolvePlayback).toHaveBeenCalledWith(slot.item);
    });

    it('keeps the slot empty when the picker is dismissed', async () => {
        dialog.open.mockReturnValue({ afterClosed: () => of(undefined) });

        await component.openPicker(0);
        await flush();

        expect(component.state.slots()[0]).toBeNull();
        expect(streamResolver.resolvePlayback).not.toHaveBeenCalled();
    });

    it('navigates to the full player on open-in-player requests', () => {
        const slot = buildSlot({
            uid: 'xtream::playlist-2::42',
            sourceType: 'xtream',
            playlistId: 'playlist-2',
        });

        component.openInPlayer(slot);

        expect(router.navigate).toHaveBeenCalledWith(
            ['/workspace', 'xtreams', 'playlist-2', 'favorites'],
            {
                state: expect.objectContaining({
                    openLiveCollectionItem: expect.objectContaining({
                        contentType: 'live',
                        sourceType: 'xtream',
                        playlistId: 'playlist-2',
                        itemId: '42',
                    }),
                }),
            }
        );
    });

    it('shows the connection-limit hint for two slots of the same portal', async () => {
        component.state.assign(
            0,
            buildSlot({
                uid: 'xtream::playlist-2::1',
                sourceType: 'xtream',
                playlistId: 'playlist-2',
            })
        );
        component.state.assign(
            1,
            buildSlot({
                uid: 'xtream::playlist-2::2',
                sourceType: 'xtream',
                playlistId: 'playlist-2',
            })
        );
        await flush();

        expect(component.connectionLimitHintVisible()).toBe(true);
        expect(
            fixture.nativeElement.querySelector('.multiview-hint')
        ).toBeTruthy();

        component.dismissHint();
        fixture.detectChanges();
        expect(
            fixture.nativeElement.querySelector('.multiview-hint')
        ).toBeFalsy();
    });

    it('re-shows the hint when a new same-account conflict appears after dismissal', async () => {
        component.state.setLayout('grid-3x3');
        component.state.assign(
            0,
            buildSlot({
                uid: 'xtream::playlist-2::1',
                sourceType: 'xtream',
                playlistId: 'playlist-2',
            })
        );
        component.state.assign(
            1,
            buildSlot({
                uid: 'xtream::playlist-2::2',
                sourceType: 'xtream',
                playlistId: 'playlist-2',
            })
        );
        await flush();

        component.dismissHint();
        expect(component.connectionLimitHintVisible()).toBe(false);

        // Same account combination stays dismissed even when extended.
        component.state.assign(
            2,
            buildSlot({
                uid: 'xtream::playlist-2::3',
                sourceType: 'xtream',
                playlistId: 'playlist-2',
            })
        );
        await flush();
        expect(component.connectionLimitHintVisible()).toBe(false);

        // A conflict on a different account re-shows the hint.
        component.state.assign(
            3,
            buildSlot({
                uid: 'stalker::portal-1::1',
                sourceType: 'stalker',
                playlistId: 'portal-1',
            })
        );
        component.state.assign(
            4,
            buildSlot({
                uid: 'stalker::portal-1::2',
                sourceType: 'stalker',
                playlistId: 'portal-1',
            })
        );
        await flush();
        expect(component.connectionLimitHintVisible()).toBe(true);
    });

    it('drops in-flight resolutions and blocks new ones after destroy', async () => {
        let resolvePlayback!: (value: unknown) => void;
        streamResolver.resolvePlayback.mockReturnValueOnce(
            new Promise((resolve) => {
                resolvePlayback = resolve;
            })
        );
        const slot = buildSlot();
        component.state.assign(0, slot);
        fixture.detectChanges();

        fixture.destroy();
        resolvePlayback({
            streamUrl: 'http://example.com/late.m3u8',
            title: 'Late',
        });
        await Promise.resolve();

        expect(component.resolutionFor(slot).status).toBe('resolving');

        component.retry(slot);
        await Promise.resolve();
        expect(streamResolver.resolvePlayback).toHaveBeenCalledTimes(1);
    });

    it('uses distinct request ids when a channel is removed and re-added', async () => {
        let rejectFirst!: (reason: unknown) => void;
        streamResolver.resolvePlayback.mockReturnValueOnce(
            new Promise((_resolve, reject) => {
                rejectFirst = reject;
            })
        );
        const slot = buildSlot();
        component.state.assign(0, slot);
        fixture.detectChanges();

        component.state.remove(0);
        await flush();
        component.state.assign(0, slot);
        await flush();

        expect(component.resolutionFor(slot).status).toBe('ready');

        // The stale first request settling late must not overwrite the
        // fresh resolution with an error.
        rejectFirst(new Error('stale'));
        await flush();
        expect(component.resolutionFor(slot).status).toBe('ready');
    });

    it('opens only one picker dialog on double-click', async () => {
        dialog.open.mockReturnValue({ afterClosed: () => of(undefined) });

        const first = component.openPicker(0);
        const second = component.openPicker(0);
        await Promise.all([first, second]);

        expect(dialog.open).toHaveBeenCalledTimes(1);
    });

    it('ignores open-in-player requests for malformed uids', () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation();
        component.openInPlayer(buildSlot({ uid: 'm3u::playlist-1' }));
        expect(router.navigate).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    it('logs the tile diagnostic and marks the slot as error', () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation();
        const slot = buildSlot();
        const diagnostic = { code: 'hls-fatal' };

        component.onTileFailed(
            slot,
            diagnostic as unknown as Parameters<
                typeof component.onTileFailed
            >[1]
        );

        expect(component.resolutionFor(slot).status).toBe('error');
        expect(warn).toHaveBeenCalledWith(
            '[multiview] tile playback failed',
            slot.item.uid,
            diagnostic
        );
        warn.mockRestore();
    });

    it('switches layouts and renders the new slot count', async () => {
        component.state.setLayout('grid-3x3');
        await flush();

        expect(
            fixture.nativeElement.querySelectorAll('.multiview-add')
        ).toHaveLength(9);
        const grid: HTMLElement =
            fixture.nativeElement.querySelector('.multiview-grid');
        expect(grid.style.gridTemplateColumns).toBe('repeat(3, 1fr)');
    });
});
