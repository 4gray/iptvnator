import { TestBed } from '@angular/core/testing';
import { EpgService } from '@iptvnator/epg/data-access';
import { collectionEpgKey } from '@iptvnator/portal/shared/util';
import type { EpgProgram } from '@iptvnator/shared/interfaces';
import { of } from 'rxjs';
import { StreamResolverService } from './collection/stream-resolver.service';
import type { SecondStreamChannel } from './second-stream-catalog.service';
import { SecondStreamEpgService } from './second-stream-epg.service';

const guideA = 'https://guide-a.example.test/tv.xml';
const guideB = 'https://guide-b.example.test/tv.xml';
const programme = (title: string): EpgProgram => ({
    channel: 'example-news',
    title,
    start: '',
    stop: '',
    desc: null,
    category: null,
});
const item = (playlistId: string): SecondStreamChannel['item'] => ({
    uid: `m3u::${playlistId}::example-news`,
    sourceType: 'm3u',
    contentType: 'live',
    playlistId,
    playlistName: playlistId,
    name: 'Example news',
    tvgId: 'example-news',
});

describe('SecondStreamEpgService', () => {
    it('scopes reused XMLTV ids to their guide and routes portal rows through the collection resolver', async () => {
        const first: SecondStreamChannel = {
            item: item('first'),
            group: 'News',
            epgSourceUrls: [guideA],
        };
        const second: SecondStreamChannel = {
            item: item('second'),
            group: 'News',
            epgSourceUrls: [guideB],
        };
        const xtream: SecondStreamChannel = {
            group: 'News',
            item: {
                ...item('xtream'),
                sourceType: 'xtream',
                uid: 'xtream::example::7',
                xtreamId: 7,
                epgChannelId: 'example-news',
            },
        };
        const stalker: SecondStreamChannel = {
            group: 'News',
            item: {
                ...item('stalker'),
                sourceType: 'stalker',
                uid: 'stalker::example::7',
                stalkerId: '7',
            },
        };
        const fromXmltv = jest.fn(
            (keys: string[], options: { sourceUrls: string[] }) =>
                of(
                    new Map([
                        [
                            keys[0],
                            programme(
                                options.sourceUrls[0] === guideA
                                    ? 'First guide'
                                    : 'Second guide'
                            ),
                        ],
                    ])
                )
        );
        const fromPortals = jest.fn().mockResolvedValue(
            new Map([
                [collectionEpgKey(xtream.item), programme('Xtream guide')],
                [collectionEpgKey(stalker.item), programme('Stalker guide')],
            ])
        );
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: EpgService,
                    useValue: { getCurrentProgramsForChannels: fromXmltv },
                },
                {
                    provide: StreamResolverService,
                    useValue: { loadEpgForItems: fromPortals },
                },
            ],
        });

        const result = await TestBed.inject(SecondStreamEpgService).load([
            first,
            second,
            xtream,
            stalker,
        ]);

        expect(fromXmltv).toHaveBeenNthCalledWith(1, ['example-news'], {
            sourceUrls: [guideA],
        });
        expect(fromXmltv).toHaveBeenNthCalledWith(2, ['example-news'], {
            sourceUrls: [guideB],
        });
        expect(fromPortals).toHaveBeenCalledWith([xtream.item, stalker.item]);
        expect(result.get(first.item.uid)?.title).toBe('First guide');
        expect(result.get(second.item.uid)?.title).toBe('Second guide');
        expect(result.get(xtream.item.uid)?.title).toBe('Xtream guide');
        expect(result.get(stalker.item.uid)?.title).toBe('Stalker guide');
    });
});
