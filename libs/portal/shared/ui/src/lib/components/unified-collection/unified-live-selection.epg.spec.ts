import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PlaybackHistoryGate } from '@iptvnator/playback/data-access';
import {
    ResolvedLiveCollectionDetail,
    StreamResolverService,
    UnifiedRecentDataService,
} from '@iptvnator/portal/shared/data-access';
import {
    PORTAL_PLAYER,
    UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';
import { ElectronStreamHeadersService } from '@iptvnator/ui/playback';
import { EpgItem } from '@iptvnator/shared/interfaces';
import { createUnifiedLiveSelection } from './unified-live-selection';
import { createUnifiedLiveSelectionGeneration } from './unified-live-selection-generation';
import {
    buildLiveItem,
    buildEpgItem,
    createDeferred,
} from './unified-live-tab.spec-data';

describe('collection guide hydration', () => {
    const activeUid = signal<string | null>(null);
    const activeItem = signal<UnifiedCollectionItem | null>(null);
    const activeDetail = signal<ResolvedLiveCollectionDetail | null>(null);
    let resolver: { resolveLiveDetail: jest.Mock; loadEpgItems: jest.Mock };
    let selection: ReturnType<typeof createUnifiedLiveSelection>;
    const detail = (
        item: UnifiedCollectionItem
    ): ResolvedLiveCollectionDetail => ({
        playback: {
            streamUrl: `https://example.test/${item.uid}`,
            title: item.name,
            isLive: true,
        },
        epgMode: 'portal',
        epgItems: [],
    });

    beforeEach(() => {
        activeUid.set(null);
        activeItem.set(null);
        activeDetail.set(null);
        resolver = {
            resolveLiveDetail: jest.fn(async (item: UnifiedCollectionItem) =>
                detail(item)
            ),
            loadEpgItems: jest.fn().mockResolvedValue([]),
        };
        TestBed.configureTestingModule({
            providers: [
                { provide: StreamResolverService, useValue: resolver },
                { provide: UnifiedRecentDataService, useValue: {} },
                {
                    provide: ElectronStreamHeadersService,
                    useValue: { clear: jest.fn() },
                },
                {
                    provide: PORTAL_PLAYER,
                    useValue: { openResolvedPlayback: jest.fn() },
                },
                {
                    provide: PlaybackHistoryGate,
                    useValue: { defer: jest.fn() },
                },
            ],
        });
        selection = TestBed.runInInjectionContext(() =>
            createUnifiedLiveSelection({
                activeUid,
                activeItem,
                activeDetail,
                activeTimeshift: signal(null),
                isSelecting: signal(false),
                generation: createUnifiedLiveSelectionGeneration(),
                supportsEpg: true,
                supportsProviderEpg: true,
                isRadioDetail: () => false,
                shouldOpenExternalPlayback: () => false,
                onItemPlayed: jest.fn(),
                onAutoOpenHandled: jest.fn(),
            })
        );
    });

    it.each(['xtream', 'stalker'] as const)(
        'publishes %s playback before its guide and hydrates afterwards',
        async (source) => {
            const guide = createDeferred<EpgItem[]>();
            resolver.loadEpgItems.mockReturnValue(guide.promise);
            const item = buildLiveItem(source);
            await selection.activate(item);
            expect(resolver.resolveLiveDetail).toHaveBeenCalledWith(item, {
                includeEpg: false,
            });
            expect(activeDetail()?.playback.title).toBe(item.name);
            expect(activeDetail()?.epgItems).toEqual([]);
            expect(resolver.loadEpgItems).toHaveBeenCalledWith(item);
            guide.resolve([buildEpgItem('Now')]);
            await guide.promise;
            await Promise.resolve();
            expect(activeDetail()?.epgItems?.[0].title).toBe('Now');
        }
    );

    it.each(['switch', 'close', 'dispose'] as const)(
        'ignores a late guide after %s',
        async (action) => {
            const first = createDeferred<EpgItem[]>();
            resolver.loadEpgItems
                .mockReturnValueOnce(first.promise)
                .mockResolvedValueOnce([buildEpgItem('Second')]);
            await selection.activate(buildLiveItem('xtream'));
            if (action === 'switch')
                await selection.activate(buildLiveItem('stalker'));
            else selection[action]();
            const current = activeDetail();
            first.resolve([buildEpgItem('Stale')]);
            await first.promise;
            await Promise.resolve();
            expect(activeDetail()).toBe(current);
            expect(activeDetail()?.epgItems?.[0]?.title).not.toBe('Stale');
        }
    );

    it.each([true, false])(
        'hydrates the retained stream when replacement fails (guide first=%s)',
        async (guideFirst) => {
            const guide = createDeferred<EpgItem[]>();
            const replacement = createDeferred<ResolvedLiveCollectionDetail>();
            const channel = buildLiveItem('xtream');
            resolver.resolveLiveDetail
                .mockResolvedValueOnce(detail(channel))
                .mockReturnValueOnce(replacement.promise);
            resolver.loadEpgItems.mockReturnValueOnce(guide.promise);
            await selection.activate(channel);
            const pending = selection.activate(buildLiveItem('stalker'));
            const settleGuide = async () => {
                guide.resolve([buildEpgItem('Retained guide')]);
                await guide.promise;
                await Promise.resolve();
            };
            if (guideFirst) await settleGuide();
            replacement.reject(new Error('Replacement unavailable'));
            await pending;
            if (!guideFirst) await settleGuide();
            expect(activeUid()).toBe(channel.uid);
            expect(activeItem()).toBe(channel);
            expect(activeDetail()?.epgItems?.[0]?.title).toBe('Retained guide');
            await selection.activate(channel);
            expect(resolver.loadEpgItems).toHaveBeenCalledTimes(1);
        }
    );

    it('rejects the first guide when revisiting the same channel under a newer selection', async () => {
        const first = createDeferred<EpgItem[]>();
        resolver.loadEpgItems
            .mockReturnValueOnce(first.promise)
            .mockResolvedValueOnce([buildEpgItem('Other')])
            .mockResolvedValueOnce([buildEpgItem('Latest')]);
        const channel = buildLiveItem('xtream');
        await selection.activate(channel);
        await selection.activate(buildLiveItem('stalker'));
        await selection.activate(channel);
        await Promise.resolve();
        expect(activeDetail()?.epgItems?.[0]?.title).toBe('Latest');
        first.resolve([buildEpgItem('Stale')]);
        await first.promise;
        await Promise.resolve();
        expect(activeDetail()?.epgItems?.[0]?.title).toBe('Latest');
    });

    it('keeps playback mounted when its guide rejects', async () => {
        resolver.loadEpgItems.mockRejectedValue(new Error('guide unavailable'));
        await selection.activate(buildLiveItem('xtream'));
        await Promise.resolve();
        expect(activeDetail()?.playback.title).toBe('Xtream Live');
        expect(activeDetail()?.epgItems).toEqual([]);
    });
});
