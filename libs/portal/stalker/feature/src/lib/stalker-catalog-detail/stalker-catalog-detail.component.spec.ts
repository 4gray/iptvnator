import { Component, input, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import {
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYBACK_POSITIONS,
    PORTAL_PLAYER,
} from '@iptvnator/portal/shared/util';
import {
    DownloadsService,
    PlaybackPositionRuntimeBridgeService,
    PlaylistsService,
} from '@iptvnator/services';
import { VodDetailsComponent } from '@iptvnator/ui/playback';
import { EMPTY, of } from 'rxjs';
import { StalkerCatalogFacadeService } from '../stalker-catalog-facade.service';
import { StalkerSeriesViewComponent } from '../stalker-series-view/stalker-series-view.component';
import { StalkerCatalogDetailComponent } from './stalker-catalog-detail.component';

@Component({ selector: 'app-vod-details', template: '' })
class StubVodDetailsComponent {
    readonly item = input.required<unknown>();
    readonly providerOnly = input(false);
    readonly isFavorite = input(false);
    readonly playbackPosition = input<number | null>(null);
    readonly inlinePlayback = input<unknown>(null);
    readonly externalPlayback = input<unknown>(null);
    readonly playClicked = output<unknown>();
    readonly resumeClicked = output<unknown>();
    readonly favoriteToggled = output<unknown>();
    readonly downloadRequested = output<unknown>();
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
}

describe('StalkerCatalogDetailComponent provider presentation', () => {
    let fixture: ComponentFixture<StalkerCatalogDetailComponent>;
    const contentType = signal<'vod' | 'series'>('vod');
    const selectedItem = signal<unknown>({
        id: '42',
        cmd: '/media/42',
        info: { name: 'Portal movie' },
    });

    beforeEach(async () => {
        window.history.replaceState(
            {
                detailPresentation: 'provider-only',
                openStalkerItem: { id: '42' },
            },
            '',
            window.location.href
        );
        contentType.set('vod');
        selectedItem.set({
            id: '42',
            cmd: '/media/42',
            info: { name: 'Portal movie' },
        });

        await TestBed.configureTestingModule({
            imports: [StalkerCatalogDetailComponent],
            providers: [
                {
                    provide: StalkerCatalogFacadeService,
                    useValue: {
                        contentType,
                        selectedItem,
                        playlist: signal({ id: 'stalker-1' }),
                        clearSelectedItem: jest.fn(),
                    },
                },
                {
                    provide: PORTAL_PLAYBACK_POSITIONS,
                    useValue: {
                        getPlaybackPosition: jest.fn().mockResolvedValue(null),
                        savePlaybackPosition: jest.fn(),
                    },
                },
                {
                    provide: PORTAL_PLAYER,
                    useValue: { isEmbeddedPlayer: jest.fn() },
                },
                {
                    provide: PORTAL_EXTERNAL_PLAYBACK,
                    useValue: { activeSession: signal(null) },
                },
                {
                    provide: PlaybackPositionRuntimeBridgeService,
                    useValue: { onPlaybackPositionUpdate: jest.fn() },
                },
                {
                    provide: PlaylistsService,
                    useValue: { getPortalFavorites: jest.fn(() => of([])) },
                },
                { provide: DownloadsService, useValue: {} },
                { provide: Router, useValue: { navigateByUrl: jest.fn() } },
                { provide: MatSnackBar, useValue: { open: jest.fn() } },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string) => key,
                        onLangChange: EMPTY,
                        onTranslationChange: EMPTY,
                        onDefaultLangChange: EMPTY,
                    },
                },
            ],
        })
            .overrideComponent(StalkerCatalogDetailComponent, {
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
        fixture = TestBed.createComponent(StalkerCatalogDetailComponent);
    });

    afterEach(() => {
        window.history.replaceState({}, '', window.location.href);
        fixture.destroy();
    });

    it('passes provider-only mode to the matching regular VOD', async () => {
        await fixture.whenStable();

        const child = fixture.debugElement.query(
            By.directive(StubVodDetailsComponent)
        ).componentInstance as StubVodDetailsComponent;
        expect(fixture.componentInstance.providerOnly()).toBe(true);
        expect(child.providerOnly()).toBe(true);
    });

    it('does not apply stale provider-only state to a different selected item', async () => {
        selectedItem.set({
            id: '99',
            cmd: '/media/99',
            info: { name: 'Another movie' },
        });
        await fixture.whenStable();

        const child = fixture.debugElement.query(
            By.directive(StubVodDetailsComponent)
        ).componentInstance as StubVodDetailsComponent;
        expect(fixture.componentInstance.providerOnly()).toBe(false);
        expect(child.providerOnly()).toBe(false);
    });

    it.each([
        ['embedded VOD series', 'vod', { id: '42', series: [1] }],
        ['Ministra VOD series', 'vod', { id: '42', is_series: '1' }],
        ['regular series', 'series', { id: '42' }],
    ] as const)(
        'passes provider-only mode to %s',
        async (_label, type, item) => {
            contentType.set(type);
            selectedItem.set({
                ...item,
                cmd: '/media/42',
                info: { name: 'Portal series' },
            });
            await fixture.whenStable();

            const child = fixture.debugElement.query(
                By.directive(StubStalkerSeriesViewComponent)
            ).componentInstance as StubStalkerSeriesViewComponent;
            expect(child.providerOnly()).toBe(true);
        }
    );
});
