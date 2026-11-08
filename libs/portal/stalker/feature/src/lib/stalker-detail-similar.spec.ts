import { Location } from '@angular/common';
import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import {
    StalkerSimilarService,
    type StalkerSimilarMatch,
    type StalkerVodSource,
} from '@iptvnator/portal/stalker/data-access';
import { STALKER_SIMILAR_ORIGIN } from '@iptvnator/portal/shared/util';
import {
    ParentalLockService,
    PlaylistsService,
    TmdbEnrichmentService,
} from '@iptvnator/services';
import { of } from 'rxjs';
import { StalkerDetailSimilar } from './stalker-detail-similar';

const item = (id: string): StalkerVodSource => ({
    id,
    info: {
        tmdb_recommendations: [
            {
                tmdbId: 10,
                title: 'Fictional Quarry',
                year: null,
                posterUrl: null,
            },
        ],
    },
});
const match: StalkerSimilarMatch = {
    recommendation: {
        tmdbId: 10,
        title: 'Fictional Quarry',
        year: null,
        posterUrl: null,
    },
    catalog: 'vod',
    item: { id: '20', category_id: 'fixture-category' },
};

describe(StalkerDetailSimilar.name, () => {
    const lookup = jest.fn();
    const navigate = jest.fn();
    const replaceState = jest.fn();
    const lastNavigation = signal<{
        id: number;
        finalUrl: { fragment: string };
    } | null>(null);
    const currentUrl = '/workspace/stalker/fixture-source/vod/5';
    const withheld = signal(false);
    const subject = signal(item('1'));
    let service: StalkerDetailSimilar;

    beforeEach(() => {
        lookup.mockReset();
        navigate.mockReset();
        replaceState.mockReset();
        lastNavigation.set(null);
        withheld.set(false);
        subject.set(item('1'));
        TestBed.configureTestingModule({
            providers: [
                StalkerDetailSimilar,
                {
                    provide: Router,
                    useValue: {
                        navigate,
                        url: currentUrl,
                        lastSuccessfulNavigation: lastNavigation,
                    },
                },
                { provide: Location, useValue: { replaceState } },
                { provide: StalkerSimilarService, useValue: { match: lookup } },
                {
                    provide: TmdbEnrichmentService,
                    useValue: { isEnabled: () => true },
                },
                {
                    provide: ParentalLockService,
                    useValue: { isStalkerCategoryLocked: withheld },
                },
                {
                    provide: PlaylistsService,
                    useValue: {
                        getPlaylistById: (id: string) =>
                            of({
                                _id: id,
                                portalUrl: 'https://portal.example/portal.php',
                                macAddress: '00:11:22:33:44:55',
                            }),
                    },
                },
            ],
        });
        service = TestBed.inject(StalkerDetailSimilar);
        service.bind({
            item: subject,
            catalog: () => 'vod',
            playlistId: () => 'fixture-source',
            enabled: () => true,
        });
    });

    it.each(['vod', 'series'] as const)(
        'opens a matched %s item in a new history entry and preserves the original detail',
        async (catalog) => {
            const returning = catalog === 'vod';
            if (returning)
                lastNavigation.set({
                    id: 8,
                    finalUrl: { fragment: 'stalker-related-8' },
                });
            service.bind({
                item: subject,
                catalog: () => catalog,
                playlistId: () => 'fixture-source',
                enabled: () => true,
                origin: (origin) => ({ ...origin, catalogReturnId: 8 }),
            });
            lookup.mockResolvedValue([{ ...match, catalog }]);
            TestBed.tick();
            await TestBed.inject(ApplicationRef).whenStable();
            service.open(service.items()[0]);

            expect(replaceState).toHaveBeenCalledWith(
                currentUrl,
                '',
                expect.objectContaining({
                    [STALKER_SIMILAR_ORIGIN]: {
                        playlistId: 'fixture-source',
                        catalog,
                        item: subject(),
                        catalogReturnId: 8,
                    },
                })
            );
            expect(navigate).toHaveBeenCalledWith(
                [
                    '/workspace',
                    'stalker',
                    'fixture-source',
                    catalog,
                    'fixture-category',
                ],
                expect.objectContaining({
                    fragment: returning
                        ? 'stalker-related-8-next'
                        : 'stalker-related-0',
                    state: expect.objectContaining({
                        stalkerReturnByHistory: '20',
                        openStalkerItem: expect.objectContaining({
                            id: '20',
                            category_id: 'fixture-category',
                        }),
                    }),
                })
            );
        }
    );

    it('leaves the rail empty when the portal lookup rejects', async () => {
        lookup.mockRejectedValue(new Error('Fixture portal unavailable'));
        TestBed.tick();
        await TestBed.inject(ApplicationRef).whenStable();
        expect(service.items()).toEqual([]);
    });

    it('hides a cached recommendation on relock and refuses a stale click', async () => {
        lookup.mockResolvedValue([match]);
        TestBed.tick();
        await TestBed.inject(ApplicationRef).whenStable();
        const [card] = service.items();
        expect(card?.title).toBe('Fictional Quarry');
        withheld.set(true);
        expect(service.items()).toEqual([]);
        service.open(card);
        expect(navigate).not.toHaveBeenCalled();
        withheld.set(false);
        expect(service.items()).toEqual([card]);
        expect(lookup).toHaveBeenCalledTimes(1);
    });

    it('ignores a response that settles after the user opens another title', async () => {
        let resolveOldLookup!: (matches: StalkerSimilarMatch[]) => void;
        const oldLookup = new Promise<StalkerSimilarMatch[]>((resolve) => {
            resolveOldLookup = resolve;
        });
        lookup.mockReturnValueOnce(oldLookup).mockResolvedValue([]);
        TestBed.tick();
        await Promise.resolve();
        expect(lookup).toHaveBeenCalledTimes(1);
        subject.set(item('2'));
        expect(service.items()).toEqual([]);
        TestBed.tick();
        resolveOldLookup([match]);
        await TestBed.inject(ApplicationRef).whenStable();
        expect(lookup).toHaveBeenCalledTimes(2);
        expect(service.items()).toEqual([]);
    });
});
