import { Component, inject, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
    MULTIVIEW_SOURCE_PICKER,
    MultiviewAnchorRegistry,
    type MultiviewAnchorHost,
    MultiviewEntryService,
    MultiviewSessionStore,
    type MultiviewTile,
    type MultiviewTileSource,
} from '@iptvnator/playback/multiview/data-access';
import { SettingsStore } from '@iptvnator/services';
import { VideoPlayer } from '@iptvnator/shared/interfaces';
import { PLAYER_MULTIVIEW_ACTION } from '../player-controls/player-multiview-action';
import { MultiviewPlayerDirective } from './multiview-player.directive';
import {
    injectMultiviewAnchor,
    provideMultiviewAnchor,
} from './multiview-anchor';
import { MultiviewAnchorPlaceholderComponent } from './multiview-anchor-placeholder.component';

function source(key: string): MultiviewTileSource {
    return {
        playback: {
            streamUrl: `https://stream.example/${key}.m3u8`,
            title: key,
        },
        playbackSessionKey: `session:${key}`,
        kind: 'live',
        playlistId: 'playlist-1',
        title: key,
    };
}

@Component({
    selector: 'app-probe-player',
    template: 'own player<video></video>',
    host: { 'data-test-id': 'own-player' },
})
class ProbePlayerComponent {
    readonly action = inject(PLAYER_MULTIVIEW_ACTION, { optional: true });
}

@Component({
    selector: 'app-probe-view',
    template: `
        @if (shown()) {
            <div class="slot">
                @if (anchor.ownsSession()) {
                    <app-multiview-anchor-placeholder [anchor]="anchor" />
                } @else {
                    <app-probe-player appMultiviewPlayer />
                }
            </div>
            <app-probe-player class="other-player" />
        }
    `,
    imports: [
        MultiviewPlayerDirective,
        MultiviewAnchorPlaceholderComponent,
        ProbePlayerComponent,
    ],
    providers: [
        provideMultiviewAnchor(() => inject(ProbeViewComponent).anchor),
    ],
})
class ProbeViewComponent {
    readonly shown = signal(true);
    readonly playing = signal<MultiviewTileSource | null>(source('movie'));
    readonly engine = signal(VideoPlayer.VideoJs);
    readonly adopt = jest.fn((tile: MultiviewTile): boolean => {
        this.playing.set(tile);
        return true;
    });
    readonly host: MultiviewAnchorHost = {
        anchorId: 'probe-view',
        source: this.playing,
        engine: this.engine,
        adopt: (tile) => this.adopt(tile),
    };
    readonly anchor = injectMultiviewAnchor(this.host);
}

@Component({
    template: `@if (viewShown()) {
        <app-probe-view />
    }`,
    imports: [ProbeViewComponent],
})
class PageComponent {
    readonly viewShown = signal(true);
}

describe('MultiviewAnchor', () => {
    let fixture: ComponentFixture<PageComponent>;
    let store: MultiviewSessionStore;
    let entry: MultiviewEntryService;
    let anchors: MultiviewAnchorRegistry;

    function create(withPicker = false): void {
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: SettingsStore,
                    useValue: { player: signal(VideoPlayer.VideoJs) },
                },
                ...(withPicker
                    ? [
                          {
                              provide: MULTIVIEW_SOURCE_PICKER,
                              useValue: { pick: jest.fn() },
                          },
                      ]
                    : []),
            ],
        });
        fixture = TestBed.createComponent(PageComponent);
        store = TestBed.inject(MultiviewSessionStore);
        entry = TestBed.inject(MultiviewEntryService);
        anchors = TestBed.inject(MultiviewAnchorRegistry);
        fixture.detectChanges();
    }

    afterEach(() => fixture.destroy());

    const view = (): ProbeViewComponent =>
        fixture.debugElement.query(
            (node) => node.componentInstance instanceof ProbeViewComponent
        ).componentInstance;
    const ownPlayer = (): HTMLElement | null =>
        fixture.nativeElement.querySelector(
            '.slot [data-test-id="own-player"]'
        );
    const placeholder = (): HTMLElement | null =>
        fixture.nativeElement.querySelector(
            '[data-test-id="multiview-anchor-placeholder"]'
        );
    const players = (): ProbePlayerComponent[] =>
        fixture.debugElement
            .queryAll(By.directive(ProbePlayerComponent))
            .map((node) => node.componentInstance);

    function startSession(): void {
        entry.add(source('match'));
        fixture.detectChanges();
    }

    describe('without a session', () => {
        beforeEach(() => create());

        it('renders the view player', () => {
            expect(ownPlayer()?.textContent).toBe('own player');
            expect(placeholder()).toBeNull();
        });

        it('registers the view as the current anchor', () => {
            expect(anchors.current()?.host).toBe(view().host);
            expect(anchors.elementFor('probe-view')).toBeNull();
        });

        it('reports the player the directive marks, for shortcut checks', () => {
            expect(anchors.current()?.player?.()).toBe(ownPlayer());

            startSession();
            expect(anchors.current()?.player?.()).toBeNull();
        });

        it('keeps the player when a session belongs to another view', () => {
            anchors.register({
                host: {
                    anchorId: 'other',
                    source: signal(source('news')),
                    engine: signal(VideoPlayer.VideoJs),
                },
                element: signal(null),
            });
            entry.add(source('match'));
            fixture.detectChanges();

            expect(store.anchorId()).toBe('other');
            expect(ownPlayer()).not.toBeNull();
        });
    });

    describe('with a session on this view', () => {
        beforeEach(() => {
            create();
            startSession();
        });

        it('hands tile 1 the view playback and shows the placeholder instead', () => {
            expect(store.tiles()[0]).toMatchObject({
                playbackSessionKey: 'session:movie',
                engine: VideoPlayer.VideoJs,
            });
            expect(ownPlayer()).toBeNull();
            expect(anchors.elementFor('probe-view')).toBe(placeholder());
        });

        it('replaces the active tile when the view selects another source (R5)', () => {
            view().playing.set(source('news'));
            fixture.detectChanges();

            expect(
                store.tiles().map((tile) => tile.playbackSessionKey)
            ).toEqual(['session:news', 'session:match']);
        });

        it('ends the session when the view leaves', () => {
            fixture.componentInstance.viewShown.set(false);
            fixture.detectChanges();

            expect(store.exists()).toBe(false);
            expect(store.notice()?.effect).toMatchObject({
                type: 'ended',
                reason: 'anchor-left',
            });
        });

        it('ends the session when the player slot goes away', () => {
            view().shown.set(false);
            fixture.detectChanges();

            expect(store.exists()).toBe(false);
        });

        it('brings the player back with the surviving tile (R8, D2)', () => {
            const pip = store.tiles()[1];
            store.setAudio(pip.id);
            store.exit();
            fixture.detectChanges();

            expect(view().adopt).toHaveBeenCalledWith(pip);
            expect(view().playing()).toBe(pip);
            expect(ownPlayer()).not.toBeNull();
            expect(placeholder()).toBeNull();
            expect(store.exists()).toBe(false);
        });

        it('reopens a survivor the view cannot show in its own view (D2)', () => {
            const reopen = jest.fn();
            store.replace(store.tiles()[1].id, { ...source('news'), reopen });
            view().adopt.mockReturnValueOnce(false);
            store.setAudio(store.tiles()[1].id);
            store.exit();
            fixture.detectChanges();

            expect(reopen).toHaveBeenCalledTimes(1);
        });

        it('does not reopen a survivor the view adopted', () => {
            const reopen = jest.fn();
            store.replace(store.tiles()[1].id, { ...source('news'), reopen });
            store.setAudio(store.tiles()[1].id);
            store.exit();
            fixture.detectChanges();

            expect(reopen).not.toHaveBeenCalled();
        });

        it('does not adopt a survivor the view already shows', () => {
            store.exit();
            fixture.detectChanges();

            expect(view().adopt).not.toHaveBeenCalled();
            expect(ownPlayer()).not.toBeNull();
        });
    });

    describe('takeover position', () => {
        function reportTime(seconds: number): void {
            const video = ownPlayer()?.querySelector(
                'video'
            ) as HTMLVideoElement;
            Object.defineProperty(video, 'currentTime', {
                configurable: true,
                value: seconds,
            });
            // Media events do not bubble; the directive listens in capture.
            video.dispatchEvent(new Event('timeupdate'));
        }

        beforeEach(() => create());

        it('starts tile 1 of a VOD where the view player was (R1)', () => {
            view().playing.set({ ...source('movie'), kind: 'vod' });
            fixture.detectChanges();
            reportTime(754);
            startSession();

            expect(store.tiles()[0].position).toBe(754);
        });

        it('forgets the position when the view moves to another source', () => {
            view().playing.set({ ...source('movie'), kind: 'vod' });
            fixture.detectChanges();
            reportTime(754);
            view().playing.set({ ...source('film'), kind: 'vod' });
            fixture.detectChanges();
            startSession();

            expect(store.tiles()[0].position).toBeUndefined();
        });

        it('ignores the position of a live stream', () => {
            reportTime(42);
            startSession();

            expect(store.tiles()[0].position).toBeUndefined();
        });
    });

    describe('resume position (R7)', () => {
        beforeEach(() => create());

        function startVod(): void {
            view().playing.set({ ...source('movie'), kind: 'vod' });
            fixture.detectChanges();
            startSession();
        }

        it('continues the view source where its tile was', () => {
            startVod();
            store.reportPosition(store.tiles()[0].id, 754);
            fixture.detectChanges();
            store.exit();
            fixture.detectChanges();

            expect(view().anchor.resumePosition()).toBe(754);
        });

        it('forgets it once the view plays something else', () => {
            startVod();
            store.reportPosition(store.tiles()[0].id, 754);
            fixture.detectChanges();
            store.exit();
            fixture.detectChanges();
            view().playing.set({ ...source('film'), kind: 'vod' });

            expect(view().anchor.resumePosition()).toBeNull();
        });

        it('drops it when the view starts the same title again', () => {
            startVod();
            store.reportPosition(store.tiles()[0].id, 754);
            fixture.detectChanges();
            store.exit();
            fixture.detectChanges();
            // Start over: same title, a new playback.
            view().playing.set({ ...source('movie'), kind: 'vod' });

            expect(view().anchor.resumePosition()).toBeNull();
        });

        it('has none for a live source', () => {
            startSession();
            store.exit();
            fixture.detectChanges();

            expect(view().anchor.resumePosition()).toBeNull();
        });
    });

    describe('dock action', () => {
        it('offers none without a picker', () => {
            create();

            expect(players().map((player) => player.action)).toEqual([
                null,
                null,
            ]);
        });

        it('offers it only to the player marked appMultiviewPlayer', () => {
            create(true);
            const [anchored, other] = players();

            expect(anchored.action?.enabled()).toBe(true);
            expect(anchored.action?.disabledReasonKey).toBe(
                'PLAYER.MULTIVIEW.UNAVAILABLE_PLAYER'
            );
            expect(other.action).toBeNull();
        });

        it('disables it for Embedded MPV', () => {
            create(true);
            view().engine.set(VideoPlayer.EmbeddedMpv);

            expect(players()[0].action?.enabled()).toBe(false);
        });
    });
});
