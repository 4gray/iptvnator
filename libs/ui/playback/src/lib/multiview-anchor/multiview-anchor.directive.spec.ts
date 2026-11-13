import { Component, inject, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
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
import { MultiviewAnchorDirective } from './multiview-anchor.directive';

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
    template: 'own player',
    host: { 'data-test-id': 'own-player' },
})
class ProbePlayerComponent {
    readonly action = inject(PLAYER_MULTIVIEW_ACTION, { optional: true });
}

@Component({
    template: `
        @if (shown()) {
            <app-probe-player *appMultiviewAnchor="host" />
        }
    `,
    imports: [MultiviewAnchorDirective, ProbePlayerComponent],
})
class HostViewComponent {
    readonly shown = signal(true);
    readonly playing = signal<MultiviewTileSource | null>(source('movie'));
    readonly engine = signal(VideoPlayer.VideoJs);
    readonly adopt = jest.fn((tile: MultiviewTile) => this.playing.set(tile));
    readonly host: MultiviewAnchorHost = {
        anchorId: 'xtream-live',
        source: this.playing,
        engine: this.engine,
        adopt: (tile) => this.adopt(tile),
    };
}

describe('MultiviewAnchorDirective', () => {
    let fixture: ComponentFixture<HostViewComponent>;
    let view: HostViewComponent;
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
        fixture = TestBed.createComponent(HostViewComponent);
        view = fixture.componentInstance;
        store = TestBed.inject(MultiviewSessionStore);
        entry = TestBed.inject(MultiviewEntryService);
        anchors = TestBed.inject(MultiviewAnchorRegistry);
        fixture.detectChanges();
    }

    afterEach(() => fixture.destroy());

    const ownPlayer = (): HTMLElement | null =>
        fixture.nativeElement.querySelector('[data-test-id="own-player"]');
    const placeholder = (): HTMLElement | null =>
        fixture.nativeElement.querySelector(
            '[data-test-id="multiview-anchor-placeholder"]'
        );
    const probe = (): ProbePlayerComponent =>
        fixture.debugElement.query(
            (node) => node.componentInstance instanceof ProbePlayerComponent
        ).componentInstance;

    function startSession(): void {
        entry.add(source('match'));
        fixture.detectChanges();
    }

    describe('without a session', () => {
        beforeEach(() => create());

        it('renders the view player in the first check', () => {
            expect(ownPlayer()?.textContent).toBe('own player');
            expect(placeholder()).toBeNull();
        });

        it('registers the view as the current anchor', () => {
            expect(anchors.current()?.host).toBe(view.host);
            expect(anchors.elementFor('xtream-live')).toBeNull();
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

        it('hands tile 1 the view playback and replaces the player with a placeholder', () => {
            expect(store.tiles()[0]).toMatchObject({
                playbackSessionKey: 'session:movie',
                engine: VideoPlayer.VideoJs,
            });
            expect(ownPlayer()).toBeNull();
            expect(anchors.elementFor('xtream-live')).toBe(placeholder());
        });

        it('replaces the active tile when the view selects another source (R5)', () => {
            view.playing.set(source('news'));
            fixture.detectChanges();

            expect(
                store.tiles().map((tile) => tile.playbackSessionKey)
            ).toEqual(['session:news', 'session:match']);
        });

        it('ends the session when the view leaves', () => {
            view.shown.set(false);
            fixture.detectChanges();

            expect(store.exists()).toBe(false);
            expect(store.notice()?.effect).toMatchObject({
                type: 'ended',
                reason: 'anchor-left',
            });
        });

        it('brings the player back with the surviving tile (R8, D2)', () => {
            const pip = store.tiles()[1];
            store.setAudio(pip.id);
            store.exit();
            fixture.detectChanges();

            expect(view.adopt).toHaveBeenCalledWith(pip);
            expect(ownPlayer()).not.toBeNull();
            expect(placeholder()).toBeNull();
        });

        it('does not adopt a survivor the view already shows', () => {
            store.exit();
            fixture.detectChanges();

            expect(view.adopt).not.toHaveBeenCalled();
            expect(ownPlayer()).not.toBeNull();
        });
    });

    describe('dock action', () => {
        it('offers none without a picker', () => {
            create();

            expect(probe().action).toBeNull();
        });

        it('offers the action to the wrapped player when a picker exists', () => {
            create(true);

            expect(probe().action?.enabled()).toBe(true);
            expect(probe().action?.disabledReasonKey).toBe(
                'PLAYER.MULTIVIEW.UNAVAILABLE_PLAYER'
            );
        });

        it('disables it for Embedded MPV', () => {
            create(true);
            view.engine.set(VideoPlayer.EmbeddedMpv);

            expect(probe().action?.enabled()).toBe(false);
        });
    });
});
