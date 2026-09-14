import { Component, input, output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { createStalkerVodItem } from '@iptvnator/shared/interfaces';
import { VodDetailsComponent } from '@iptvnator/ui/playback';
import { StalkerSeriesViewComponent } from '../stalker-series-view/stalker-series-view.component';
import { StalkerInlineDetailComponent } from './stalker-inline-detail.component';

@Component({ selector: 'app-vod-details', template: '' })
class StubVodDetailsComponent {
    readonly playbackSessionKey = input.required<string>();
    readonly item = input.required<unknown>();
    readonly providerOnly = input(false);
    readonly isFavorite = input(false);
    readonly playbackPosition = input<number | null>(null);
    readonly inlinePlayback = input<unknown>(null);
    readonly externalPlayback = input<unknown>(null);
    readonly isWatched = input(false);
    readonly watchedToggleBusy = input(false);
    readonly watchedToggleReady = input(true);
    readonly playbackStartPending = input(false);
    readonly playClicked = output<unknown>();
    readonly resumeClicked = output<unknown>();
    readonly favoriteToggled = output<unknown>();
    readonly watchedToggled = output<{ item: unknown; watched: boolean }>();
    readonly backClicked = output<void>();
    readonly inlineTimeUpdated = output<unknown>();
    readonly inlinePlaybackClosed = output<void>();
    readonly streamUrlCopied = output<void>();
    readonly inlineExternalFallbackRequested = output<unknown>();
}

@Component({ selector: 'app-stalker-series-view', template: '' })
class StubStalkerSeriesViewComponent {
    readonly vodWithSeries = input<unknown>(null);
    readonly providerOnly = input(false);
    readonly backClicked = output<void>();
}

const VOD_ITEM = createStalkerVodItem(
    { id: '42', cmd: '/media/42', info: { name: 'Movie' } },
    'stalker-1'
);

describe('StalkerInlineDetailComponent provider presentation', () => {
    let fixture: ComponentFixture<StalkerInlineDetailComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [StalkerInlineDetailComponent],
        })
            .overrideComponent(StalkerInlineDetailComponent, {
                remove: {
                    imports: [StalkerSeriesViewComponent, VodDetailsComponent],
                },
                add: {
                    imports: [
                        StubStalkerSeriesViewComponent,
                        StubVodDetailsComponent,
                    ],
                },
            })
            .compileComponents();
        fixture = TestBed.createComponent(StalkerInlineDetailComponent);
        fixture.componentRef.setInput('providerOnly', true);
        fixture.componentRef.setInput(
            'playbackSessionKey',
            'collection-owned-vod-key'
        );
    });

    afterEach(() => fixture.destroy());

    it('passes provider-only mode to regular VOD details', async () => {
        fixture.componentRef.setInput('categoryId', 'vod');
        fixture.componentRef.setInput('vodDetailsItem', VOD_ITEM);
        await fixture.whenStable();

        const child = fixture.debugElement.query(
            By.directive(StubVodDetailsComponent)
        ).componentInstance as StubVodDetailsComponent;
        expect(child.providerOnly()).toBe(true);
        expect(child.playbackSessionKey()).toBe('collection-owned-vod-key');
    });

    it('relays the watched state and toggle of regular VOD details', async () => {
        fixture.componentRef.setInput('categoryId', 'vod');
        fixture.componentRef.setInput('vodDetailsItem', VOD_ITEM);
        fixture.componentRef.setInput('isWatched', true);
        fixture.componentRef.setInput('watchedToggleBusy', true);
        fixture.componentRef.setInput('watchedToggleReady', false);
        fixture.componentRef.setInput('playbackStartPending', true);
        const watchedToggled = jest.fn();
        fixture.componentInstance.watchedToggled.subscribe(watchedToggled);
        await fixture.whenStable();

        const child = fixture.debugElement.query(
            By.directive(StubVodDetailsComponent)
        ).componentInstance as StubVodDetailsComponent;
        expect(child.isWatched()).toBe(true);
        expect(child.watchedToggleBusy()).toBe(true);
        expect(child.watchedToggleReady()).toBe(false);
        expect(child.playbackStartPending()).toBe(true);

        child.watchedToggled.emit({ item: VOD_ITEM, watched: false });

        expect(watchedToggled).toHaveBeenCalledWith({
            item: VOD_ITEM,
            watched: false,
        });
    });

    it.each([
        ['embedded VOD series', 'vod', { id: '42', series: [1] }, false],
        ['Ministra VOD series', 'vod', { id: '42' }, true],
        ['regular series', 'series', { id: '42' }, false],
    ] as const)(
        'passes provider-only mode to %s details',
        async (_label, categoryId, seriesItem, isSeries) => {
            fixture.componentRef.setInput('categoryId', categoryId);
            fixture.componentRef.setInput('seriesItem', seriesItem);
            fixture.componentRef.setInput('isSeries', isSeries);
            await fixture.whenStable();

            const child = fixture.debugElement.query(
                By.directive(StubStalkerSeriesViewComponent)
            ).componentInstance as StubStalkerSeriesViewComponent;
            expect(child.providerOnly()).toBe(true);
        }
    );
});
