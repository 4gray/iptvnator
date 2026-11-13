import { Component, type Type, input, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';
import {
    MULTIVIEW_CHANNEL_DRAG_TYPE,
    MULTIVIEW_CONNECTION_BUDGET,
    MultiviewAnchorRegistry,
    MultiviewChannelDrag,
    MultiviewEntryService,
    MultiviewSessionStore,
    type MultiviewTileSource,
} from '@iptvnator/playback/multiview/data-access';
import { SettingsStore } from '@iptvnator/services';
import { VideoPlayer } from '@iptvnator/shared/interfaces';
import type { MultiviewStageComponent as MultiviewStage } from './multiview-stage.component';

jest.unstable_mockModule('video.js', () => ({ default: jest.fn() }));
jest.unstable_mockModule('@yangkghjh/videojs-aspect-ratio-panel', () => ({}));
jest.unstable_mockModule('videojs-contrib-quality-levels', () => ({}));
jest.unstable_mockModule('videojs-quality-selector-hls', () => ({}));

@Component({ selector: 'app-web-player-view', template: '' })
class StubWebPlayerViewComponent {
    readonly playbackSessionKey = input('');
    readonly streamUrl = input('');
    readonly title = input('');
    readonly playback = input<unknown>(null);
    readonly playerOverride = input<VideoPlayer | null>(null);
    readonly headerOwner = input<string | null>(null);
    readonly startTime = input(0);
    readonly controlsMode = input('full');
    readonly muted = input<boolean | null>(null);
    readonly paused = input<boolean | null>(null);
    readonly timeUpdate = output<{ currentTime: number; duration: number }>();
    readonly audioRequested = output<void>();
    readonly playbackFailed = output<unknown>();
    readonly diagnosticChanged = output<unknown>();
}

function source(
    key: string,
    kind: MultiviewTileSource['kind'] = 'live',
    position?: number
): MultiviewTileSource {
    return {
        playback: {
            streamUrl: `https://stream.example/${key}.m3u8`,
            title: key,
        },
        playbackSessionKey: `session:${key}`,
        kind,
        playlistId: 'playlist-1',
        title: key,
        position,
    };
}

function rect(left: number, top: number, width: number, height: number) {
    return { left, top, width, height } as DOMRect;
}

// Engines import video.js: load the components after the mocks above.
let MultiviewStageComponent: typeof import('./multiview-stage.component').MultiviewStageComponent;
let MultiviewTileComponent: typeof import('./multiview-tile.component').MultiviewTileComponent;
let tileImports: () => Type<unknown>[];

beforeAll(async () => {
    ({ MultiviewStageComponent } = await import('./multiview-stage.component'));
    ({ MultiviewTileComponent } = await import('./multiview-tile.component'));
    // The real chrome and overlay; only the engine is stood in for.
    const { MultiviewTileChromeComponent } =
        await import('./multiview-tile-chrome.component');
    const { MultiviewPausedOverlayComponent } =
        await import('./multiview-paused-overlay.component');
    tileImports = () => [
        StubWebPlayerViewComponent,
        MultiviewTileChromeComponent,
        MultiviewPausedOverlayComponent,
    ];
});

describe('MultiviewStageComponent', () => {
    let fixture: ComponentFixture<MultiviewStage>;
    let store: MultiviewSessionStore;
    let frame: HTMLElement;
    let clip: HTMLElement;
    let anchor: HTMLElement;
    const budgetFor = jest.fn();

    beforeEach(() => {
        budgetFor.mockReset().mockResolvedValue(null);
        TestBed.configureTestingModule({
            imports: [TranslateModule.forRoot()],
            providers: [
                {
                    provide: SettingsStore,
                    useValue: { player: signal(VideoPlayer.VideoJs) },
                },
                {
                    provide: MULTIVIEW_CONNECTION_BUDGET,
                    useValue: { budgetFor },
                },
            ],
        }).overrideComponent(MultiviewTileComponent, {
            set: { imports: tileImports() },
        });
        store = TestBed.inject(MultiviewSessionStore);

        frame = document.createElement('div');
        clip = document.createElement('main');
        anchor = document.createElement('div');
        frame.appendChild(clip);
        clip.appendChild(anchor);
        document.body.appendChild(frame);
        frame.getBoundingClientRect = () => rect(100, 50, 1400, 900);
        clip.getBoundingClientRect = () => rect(100, 90, 1400, 860);
        anchor.getBoundingClientRect = () => rect(140, 130, 1280, 720);
        clip.style.borderRadius = '14px';
        TestBed.inject(MultiviewAnchorRegistry).register({
            host: {
                anchorId: 'xtream-live',
                source: signal(null),
                engine: signal(VideoPlayer.VideoJs),
            },
            element: signal(anchor),
        });

        fixture = TestBed.createComponent(MultiviewStageComponent);
        frame.appendChild(fixture.nativeElement);
        fixture.componentRef.setInput('clipTo', clip);
        fixture.detectChanges();
    });

    afterEach(() => {
        fixture.destroy();
        frame.remove();
    });

    function start(): void {
        store.start(
            'xtream-live',
            source('movie', 'vod', 3913),
            VideoPlayer.VideoJs,
            source('match')
        );
        fixture.detectChanges();
        fixture.detectChanges();
    }

    const players = (): StubWebPlayerViewComponent[] =>
        fixture.debugElement
            .queryAll(By.directive(StubWebPlayerViewComponent))
            .map((node) => node.componentInstance);

    it('renders nothing without a session', () => {
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="multiview-stage"]'
            )
        ).toBeNull();
        expect(players()).toEqual([]);
    });

    it('takes over the playing source in tile 1 and adds the new one muted', () => {
        start();
        const [main, pip] = players();
        const [first, second] = store.tiles();

        expect(main.playbackSessionKey()).toBe('session:movie');
        expect(main.playerOverride()).toBe(VideoPlayer.VideoJs);
        expect(main.startTime()).toBe(3913);
        expect(main.headerOwner()).toBe(first.id);
        expect(main.controlsMode()).toBe('full');
        expect(main.muted()).toBe(false);
        expect(pip.playerOverride()).toBe(VideoPlayer.Html5Player);
        expect(pip.headerOwner()).toBe(second.id);
        expect(pip.controlsMode()).toBe('minimal');
        expect(pip.muted()).toBe(true);
    });

    it('lies over the anchor, clipped to the content area', () => {
        start();
        const host: HTMLElement = fixture.nativeElement;
        const viewport: HTMLElement = host.querySelector(
            '[data-test-id="multiview-stage"]'
        ) as HTMLElement;

        expect(host.style.left).toBe('0px');
        expect(host.style.top).toBe('40px');
        expect(host.style.width).toBe('1400px');
        expect(viewport.style.left).toBe('40px');
        expect(viewport.style.top).toBe('40px');
        expect(viewport.style.width).toBe('1280px');
        expect(viewport.style.height).toBe('720px');
    });

    it('takes the corner radius of the box that clips the anchor', () => {
        start();

        expect(
            (
                fixture.nativeElement.querySelector(
                    '[data-test-id="multiview-stage"]'
                ) as HTMLElement
            ).style.borderRadius
        ).toBe('14px');
    });

    it('keeps both player instances and elements across a swap', () => {
        start();
        const before = players();
        const elements = fixture.debugElement
            .queryAll(By.directive(StubWebPlayerViewComponent))
            .map((node) => node.nativeElement);

        store.swap();
        fixture.detectChanges();

        const after = players();
        expect(after).toEqual(before);
        expect(
            fixture.debugElement
                .queryAll(By.directive(StubWebPlayerViewComponent))
                .map((node) => node.nativeElement)
        ).toEqual(elements);
        expect(after[0].controlsMode()).toBe('minimal');
        expect(after[0].muted()).toBe(true);
        expect(after[0].paused()).toBe(true);
        expect(after[1].controlsMode()).toBe('full');
        expect(after[1].muted()).toBe(false);
    });

    it('moves the audio when the viewer asks for it in a tile', () => {
        start();
        players()[1].audioRequested.emit();

        expect(store.audioTileId()).toBe(store.tiles()[1].id);
    });

    it('records VOD positions once per second', () => {
        start();
        const spy = jest.spyOn(store, 'reportPosition');
        const [main] = players();

        main.timeUpdate.emit({ currentTime: 4000.2, duration: 8000 });
        main.timeUpdate.emit({ currentTime: 4000.7, duration: 8000 });
        main.timeUpdate.emit({ currentTime: 4001.1, duration: 8000 });

        expect(spy).toHaveBeenCalledTimes(2);
        expect(store.tiles()[0].lastPosition).toBe(4001.1);
        expect(main.startTime()).toBe(3913);
    });

    it('saves progress through the source the way its player would (R9)', () => {
        const persistPosition = jest.fn();
        store.start(
            'xtream-live',
            { ...source('movie', 'vod', 10), persistPosition },
            VideoPlayer.VideoJs,
            source('match')
        );
        fixture.detectChanges();
        fixture.detectChanges();

        players()[0].timeUpdate.emit({ currentTime: 12.5, duration: 90 });

        expect(persistPosition).toHaveBeenCalledWith({
            currentTime: 12.5,
            duration: 90,
        });
    });

    it('marks a failed tile', () => {
        start();
        players()[1].playbackFailed.emit('network');

        expect(store.tiles()[1].status).toBe('error');
    });

    it('clears the failure once the tile plays again', () => {
        start();
        players()[1].playbackFailed.emit('network');
        players()[1].timeUpdate.emit({ currentTime: 0, duration: 0 });
        expect(store.tiles()[1].status).toBe('error');

        players()[1].timeUpdate.emit({ currentTime: 2.5, duration: 0 });

        expect(store.tiles()[1].status).toBe('playing');
    });

    describe('error card (spec 9.6)', () => {
        const card = (): HTMLElement | null =>
            fixture.nativeElement.querySelector(
                '[data-test-id="multiview-error-card"]'
            );
        const network = { code: 'network-error' };

        it('appears at the corner of a small tile whose player reports a problem', () => {
            start();
            expect(card()).toBeNull();

            players()[1].diagnosticChanged.emit(network);
            fixture.detectChanges();

            const element = card() as HTMLElement;
            expect(element.textContent).toContain(
                'PLAYER.MULTIVIEW.ERROR_TITLE'
            );
            expect(element.textContent).toContain(
                'PLAYER.MULTIVIEW.ERROR_NETWORK_CAUSE'
            );
            // Bottom-right PiP: 16 px inset plus the 96 px dock clearance.
            expect(element.style.right).toBe('16px');
            expect(element.style.bottom).toBe('112px');
            expect(element.style.width).toBe('400px');
            expect(
                element.querySelector('[data-test-id="multiview-error-choose"]')
            ).toBeNull();
        });

        it('also appears for a tile marked failed without a diagnostic', () => {
            start();
            players()[1].playbackFailed.emit('network');
            fixture.detectChanges();

            expect(card()?.textContent).toContain(
                'PLAYER.MULTIVIEW.ERROR_GENERIC_CAUSE'
            );
        });

        it('names a full playlist from its provider budget', async () => {
            budgetFor.mockResolvedValue({
                playlistName: 'Synthetic provider',
                maxConnections: 1,
                activeConnections: 1,
            });
            start();
            players()[1].diagnosticChanged.emit(network);
            fixture.detectChanges();
            await fixture.whenStable();
            fixture.detectChanges();

            expect(budgetFor).toHaveBeenCalledTimes(1);
            expect(budgetFor).toHaveBeenCalledWith('playlist-1');
            expect(card()?.textContent).toContain(
                'PLAYER.MULTIVIEW.ERROR_LIMIT_TITLE'
            );
        });

        it('leaves a failing main tile to its own player panel', () => {
            start();
            players()[0].diagnosticChanged.emit(network);
            fixture.detectChanges();

            expect(card()).toBeNull();
        });

        it('goes away when the player recovers', () => {
            start();
            players()[1].diagnosticChanged.emit(network);
            fixture.detectChanges();
            players()[1].diagnosticChanged.emit(null);
            fixture.detectChanges();

            expect(card()).toBeNull();
        });

        function click(testId: string): void {
            (
                card()?.querySelector(
                    `[data-test-id="${testId}"]`
                ) as HTMLButtonElement
            ).click();
        }

        function survivorKey(): string | null {
            const effect = store.notice()?.effect;
            return effect?.type === 'ended'
                ? (effect.survivor?.playbackSessionKey ?? null)
                : null;
        }

        it('closes the failed tile and keeps the main one', () => {
            start();
            players()[1].diagnosticChanged.emit(network);
            fixture.detectChanges();

            click('multiview-error-close');

            expect(store.exists()).toBe(false);
            expect(survivorKey()).toBe('session:movie');
        });

        it('replaces the main tile with the failed one', () => {
            start();
            players()[1].diagnosticChanged.emit(network);
            fixture.detectChanges();

            click('multiview-error-replace-main');

            expect(store.exists()).toBe(false);
            expect(survivorKey()).toBe('session:match');
        });
    });

    describe('channels dropped from a list (R5)', () => {
        const channel = {
            uid: 'xtream::playlist-1::live:9',
            name: 'ch9',
            contentType: 'live',
            sourceType: 'xtream',
            playlistId: 'playlist-1',
            playlistName: 'p',
            xtreamId: 9,
        } as const;

        function dropOn(element: Element): void {
            const data = new Map<string, string>();
            const transfer = {
                get types() {
                    return [...data.keys()];
                },
                setData: (type: string, value: string) => data.set(type, value),
                getData: (type: string) => data.get(type) ?? '',
            } as unknown as DataTransfer;
            TestBed.inject(MultiviewChannelDrag).start(channel, transfer);
            expect(transfer.types).toContain(MULTIVIEW_CHANNEL_DRAG_TYPE);
            const event = new Event('drop', {
                bubbles: true,
                cancelable: true,
            });
            Object.defineProperty(event, 'dataTransfer', { value: transfer });
            element.dispatchEvent(event);
        }

        beforeEach(() => {
            TestBed.inject(MultiviewEntryService).useChannelResolver({
                resolve: async () => source('ch9'),
            });
        });

        it('replaces the tile it is dropped on', async () => {
            start();
            dropOn(
                fixture.nativeElement.querySelector(
                    '[data-tile-role="pip"]'
                ) as Element
            );
            await new Promise((resolve) => setTimeout(resolve));

            expect(store.tiles()[1].playbackSessionKey).toBe('session:ch9');
            expect(store.tiles()).toHaveLength(2);
        });

        it('adds the channel when dropped on the bar', async () => {
            start();
            const replaced = store.tiles()[1].playbackSessionKey;
            dropOn(
                fixture.nativeElement.querySelector(
                    '[data-test-id="multiview-bar"]'
                ) as Element
            );
            await new Promise((resolve) => setTimeout(resolve));

            // Phase 1 holds two tiles: an add replaces the PiP (D1).
            expect(replaced).toBe('session:match');
            expect(store.tiles()[1].playbackSessionKey).toBe('session:ch9');
        });
    });

    it('removes the tiles when the session ends', () => {
        start();
        store.exit();
        fixture.detectChanges();

        expect(players()).toEqual([]);
    });
});
