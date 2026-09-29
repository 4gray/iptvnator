import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import {
    ResolvedLiveCollectionDetail,
    StreamResolverService,
} from '@iptvnator/portal/shared/data-access';
import {
    PORTAL_PLAYER,
    UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';
import { SettingsStore } from '@iptvnator/services';
import { Channel, EpgItem, EpgProgram } from '@iptvnator/shared/interfaces';
import { EpgArchiveCopyService } from '@iptvnator/ui/epg';
import {
    createUnifiedLiveCatchup,
    UnifiedLiveTimeshift,
} from './unified-live-catchup';
import { createUnifiedLiveEpgView } from './unified-live-epg-view';
import { createUnifiedLiveSelectionGeneration } from './unified-live-selection-generation';
import { buildLiveItem } from './unified-live-tab.spec-data';

const HOUR = 3600;
const T0 = Date.parse('2026-03-26T11:00:00.000Z') / 1000;

function programme(title: string, fromHour: number, toHour: number) {
    return {
        start: new Date((T0 + fromHour * HOUR) * 1000).toISOString(),
        stop: new Date((T0 + toHour * HOUR) * 1000).toISOString(),
        channel: 'test-channel',
        title,
        desc: null,
        category: null,
    } satisfies EpgProgram;
}

function epgItem(title: string, fromHour: number, toHour: number): EpgItem {
    const { start, stop } = programme(title, fromHour, toHour);
    return {
        id: title,
        epg_id: '',
        title,
        description: '',
        lang: '',
        start,
        end: stop,
        stop,
        channel_id: '1',
        start_timestamp: String(T0 + fromHour * HOUR),
        stop_timestamp: String(T0 + toHour * HOUR),
    };
}

const m3uChannel = {
    id: 'm3u-channel',
    name: 'M3U Live',
    url: 'https://example.com/m3u.m3u8',
    group: { title: 'News' },
    tvg: { id: 'm3u-channel', name: 'M3U Live', url: '', logo: '', rec: '3' },
    http: { referrer: '', 'user-agent': '', origin: '' },
    radio: 'false',
    epgParams: '',
} as Channel;

describe('unified live catch-up timeline segments', () => {
    const activeTimeshift = signal<UnifiedLiveTimeshift | null>(null);
    const activeItem = signal<UnifiedCollectionItem | null>(null);
    const isM3uSelection = signal(false);
    const currentM3uPrograms = signal<EpgProgram[]>([]);
    const currentPortalEpgItems = signal<EpgItem[]>([]);
    let resolveXtreamCatchupUrl: jest.Mock;

    function setup() {
        return TestBed.runInInjectionContext(() => {
            const common = {
                activeTimeshift,
                activeItem,
                activeDetail: signal<ResolvedLiveCollectionDetail | null>(null),
                isM3uSelection,
                currentM3uChannel: signal<Channel | null>(m3uChannel),
            };
            return {
                catchup: createUnifiedLiveCatchup({
                    ...common,
                    shouldUseInlinePlayer: signal(true),
                    generation: createUnifiedLiveSelectionGeneration(),
                }),
                epgView: createUnifiedLiveEpgView({
                    ...common,
                    currentM3uPrograms,
                    currentPortalEpgItems,
                    progressTick: signal(0),
                }),
            };
        });
    }

    beforeEach(() => {
        activeTimeshift.set(null);
        resolveXtreamCatchupUrl = jest
            .fn()
            .mockResolvedValue('https://example.com/timeshift.ts');
        TestBed.configureTestingModule({
            imports: [TranslateModule.forRoot()],
            providers: [
                {
                    provide: EpgArchiveCopyService,
                    useValue: { copy: jest.fn() },
                },
                {
                    provide: StreamResolverService,
                    useValue: { resolveXtreamCatchupUrl },
                },
                { provide: PORTAL_PLAYER, useValue: {} },
                { provide: MatSnackBar, useValue: { open: jest.fn() } },
                {
                    provide: SettingsStore,
                    useValue: {
                        resolvedEpgViewMode: signal('timeline'),
                        resolvedEpgOffsetMinutes: signal(0),
                        stripCountryPrefix: signal(false),
                    },
                },
            ],
        });
    });

    afterEach(() => jest.useRealTimers());

    it('spans M3U programmes from the picked start up to lutc', () => {
        jest.useFakeTimers({ now: (T0 + 2.5 * HOUR) * 1000 });
        isM3uSelection.set(true);
        activeItem.set(buildLiveItem('m3u'));
        currentM3uPrograms.set([
            programme('Before', -1, 0),
            programme('Picked', 0, 1),
            programme('Next', 1, 2),
            programme('Now on', 2, 3),
        ]);
        const { catchup, epgView } = setup();
        expect(epgView.catchupTimelineSegments()).toBeNull();

        catchup.handleProgramActivation({
            type: 'timeshift',
            program: programme('Picked', 0, 1),
        });

        expect(activeTimeshift()?.url).toContain(`lutc=${T0 + 2.5 * HOUR}`);
        expect(epgView.catchupTimelineSegments()).toEqual([
            { startSeconds: 0, endSeconds: HOUR, title: 'Picked' },
            { startSeconds: HOUR, endSeconds: 2 * HOUR, title: 'Next' },
            { startSeconds: 2 * HOUR, endSeconds: 2.5 * HOUR, title: 'Now on' },
        ]);

        catchup.returnToLive();
        expect(epgView.catchupTimelineSegments()).toBeNull();
    });

    it('bounds Xtream catch-up to the requested programme', async () => {
        isM3uSelection.set(false);
        activeItem.set(buildLiveItem('xtream'));
        currentPortalEpgItems.set([
            epgItem('Picked', 0, 1),
            epgItem('Next', 1, 2),
        ]);
        const { catchup, epgView } = setup();

        catchup.handleProgramActivation({
            type: 'timeshift',
            program: programme('Picked', 0, 1),
        });
        await Promise.resolve();

        expect(resolveXtreamCatchupUrl).toHaveBeenCalled();
        expect(epgView.catchupTimelineSegments()).toEqual([
            { startSeconds: 0, endSeconds: HOUR, title: 'Picked' },
        ]);
    });
});
