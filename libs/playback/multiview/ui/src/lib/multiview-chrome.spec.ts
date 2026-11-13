import { Component, type Type, input, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import {
    MULTIVIEW_SOURCE_PICKER,
    MultiviewAnchorRegistry,
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
}

function source(
    key: string,
    kind: MultiviewTileSource['kind'] = 'live'
): MultiviewTileSource {
    return {
        playback: {
            streamUrl: `https://stream.example/${key}.m3u8`,
            title: key,
        },
        playbackSessionKey: `session:${key}`,
        kind,
        playlistId: 'playlist-1',
        title: `Title ${key}`,
    };
}

const rect = (left: number, top: number, width: number, height: number) =>
    ({ left, top, width, height }) as DOMRect;

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

describe('multiview chrome and bar', () => {
    let fixture: ComponentFixture<MultiviewStage>;
    let store: MultiviewSessionStore;
    let frame: HTMLElement;
    const pick = jest.fn();

    function setup(withPicker = false): void {
        TestBed.configureTestingModule({
            imports: [TranslateModule.forRoot()],
            providers: [
                {
                    provide: SettingsStore,
                    useValue: { player: signal(VideoPlayer.VideoJs) },
                },
                ...(withPicker
                    ? [{ provide: MULTIVIEW_SOURCE_PICKER, useValue: { pick } }]
                    : []),
            ],
        }).overrideComponent(MultiviewTileComponent, {
            set: { imports: tileImports() },
        });
        store = TestBed.inject(MultiviewSessionStore);
        frame = document.createElement('div');
        const clip = document.createElement('main');
        const anchor = document.createElement('div');
        frame.append(clip);
        clip.append(anchor);
        document.body.append(frame);
        frame.getBoundingClientRect = () => rect(0, 0, 1400, 900);
        clip.getBoundingClientRect = () => rect(0, 0, 1400, 900);
        anchor.getBoundingClientRect = () => rect(0, 0, 1280, 768);
        TestBed.inject(MultiviewAnchorRegistry).register({
            host: {
                anchorId: 'anchor',
                source: signal(null),
                engine: signal(VideoPlayer.VideoJs),
            },
            element: signal(anchor),
        });
        fixture = TestBed.createComponent(MultiviewStageComponent);
        frame.append(fixture.nativeElement);
        fixture.componentRef.setInput('clipTo', clip);
        fixture.detectChanges();
    }

    afterEach(() => {
        fixture?.destroy();
        frame?.remove();
        pick.mockReset();
    });

    function start(
        primary = source('movie', 'vod'),
        added = source('match')
    ): void {
        store.start('anchor', primary, VideoPlayer.VideoJs, added);
        fixture.detectChanges();
        fixture.detectChanges();
    }

    const q = <T extends Element = HTMLElement>(selector: string) =>
        fixture.nativeElement.querySelector(selector) as T | null;
    const qa = (selector: string) =>
        [...fixture.nativeElement.querySelectorAll(selector)] as HTMLElement[];
    const pipTile = () => q('[data-tile-role="pip"]');
    const chrome = () =>
        q('[data-test-id="multiview-tile-chrome"]') as HTMLElement;

    function pointer(type: string, x: number, y: number, target: Element) {
        const event = new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            button: 0,
        });
        Object.defineProperty(event, 'pointerId', { value: 1 });
        target.dispatchEvent(event);
    }

    describe('PiP tile chrome', () => {
        beforeEach(() => {
            setup();
            start();
        });

        it('is rendered on the small tile only, with a named region', () => {
            expect(qa('[data-test-id="multiview-tile-chrome"]')).toHaveLength(
                1
            );
            expect(pipTile()?.contains(chrome())).toBe(true);
            expect(pipTile()?.getAttribute('role')).toBe('region');
            expect(pipTile()?.getAttribute('aria-label')).toBe(
                'PLAYER.MULTIVIEW.TILE_LABEL, PLAYER.MULTIVIEW.STATE_MUTED'
            );
        });

        it('swaps from its button, a double click and Enter', () => {
            q<HTMLButtonElement>(
                '[data-test-id="multiview-tile-swap"]'
            )?.click();
            expect(store.tiles()[0].title).toBe('Title match');

            fixture.detectChanges();
            chrome().dispatchEvent(
                new MouseEvent('dblclick', { bubbles: true })
            );
            expect(store.tiles()[0].title).toBe('Title movie');

            fixture.detectChanges();
            chrome().dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
            );
            expect(store.tiles()[0].title).toBe('Title match');
        });

        it('moves the sound to the small tile', () => {
            q<HTMLButtonElement>(
                '[data-test-id="multiview-tile-audio"]'
            )?.click();

            expect(store.audioTileId()).toBe(store.tiles()[1].id);
        });

        it('closes the tile, which ends a two-tile session', () => {
            q<HTMLButtonElement>(
                '[data-test-id="multiview-tile-close"]'
            )?.click();

            expect(store.exists()).toBe(false);
        });

        it('moves to another corner with the arrow keys and resizes with plus', () => {
            chrome().dispatchEvent(
                new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })
            );
            expect(store.pipGeometry()?.corner).toBe('top-right');

            const width = pipTile()?.getBoundingClientRect().width ?? 0;
            fixture.detectChanges();
            chrome().dispatchEvent(
                new KeyboardEvent('keydown', { key: '+', bubbles: true })
            );
            expect(store.pipGeometry()?.width).toBeGreaterThan(width);
        });

        it('snaps to the nearest corner after a drag (L1)', () => {
            pointer('pointerdown', 1100, 500, chrome());
            pointer('pointermove', 300, 100, chrome());
            fixture.detectChanges();
            expect(pipTile()?.style.transform).toBe(
                'translate(-800px, -400px)'
            );

            pointer('pointerup', 300, 100, chrome());
            fixture.detectChanges();

            expect(store.pipGeometry()?.corner).toBe('top-left');
            expect(pipTile()?.style.transform).toBe('');
        });

        it('treats a press without movement as a click', () => {
            pointer('pointerdown', 1100, 500, chrome());
            pointer('pointerup', 1101, 501, chrome());

            expect(store.pipGeometry()?.corner).toBe('bottom-right');
        });

        it('resizes from the corner facing the stage centre', () => {
            const handle = q(
                '[data-test-id="multiview-tile-resize"]'
            ) as HTMLElement;
            expect(handle.getAttribute('data-corner')).toBe('top-left');

            pointer('pointerdown', 900, 400, handle);
            pointer('pointermove', 840, 400, handle);
            pointer('pointerup', 840, 400, handle);

            expect(store.pipGeometry()).toEqual({
                corner: 'bottom-right',
                width: 384 + 60,
            });
        });
    });

    describe('held VOD tile', () => {
        beforeEach(() => {
            setup();
            start();
            store.reportPosition(store.tiles()[0].id, 3913);
            store.swap();
            fixture.detectChanges();
        });

        it('shows the position it will continue from', () => {
            expect(
                pipTile()?.querySelector('app-multiview-paused-overlay')
                    ?.textContent
            ).toContain('PLAYER.MULTIVIEW.PAUSED_AT');
        });

        it('gives the tile the sound from its play button (R4)', () => {
            q<HTMLButtonElement>(
                '[data-test-id="multiview-tile-resume"]'
            )?.click();

            expect(store.audioTileId()).toBe(store.tiles()[1].id);
        });
    });

    describe('bar', () => {
        it('lists every tile with its state and leaves room under the tiles', () => {
            setup();
            start();
            store.swap();
            fixture.detectChanges();

            const chips = qa('.mv-bar__chip');
            expect(
                chips.map((chip) =>
                    [...chip.children].map((part) => part.textContent?.trim())
                )
            ).toEqual([
                ['1', 'Title match', 'volume_up'],
                ['2', 'Title movie', 'pause'],
            ]);
            expect(chips[0].classList).toContain('mv-bar__chip--audio');
            expect(q('.multiview-stage__tiles')?.style.height).toBe('720px');
        });

        it('exits keeping the tile with sound (R8)', () => {
            setup();
            start();
            const main = store.tiles()[0];

            q<HTMLButtonElement>(
                '[data-test-id="multiview-bar-exit"]'
            )?.click();

            expect(store.notice()?.effect).toMatchObject({
                type: 'ended',
                reason: 'exit',
                survivor: main,
            });
        });

        it('offers "+ Channel" only when a picker exists', () => {
            setup();
            start();
            expect(q('[data-test-id="multiview-bar-add"]')).toBeNull();
        });

        it('opens the picker from "+ Channel"', () => {
            setup(true);
            pick.mockResolvedValue(null);
            start();

            q<HTMLButtonElement>('[data-test-id="multiview-bar-add"]')?.click();

            expect(pick).toHaveBeenCalledWith({ context: 'add' });
        });
    });
});
