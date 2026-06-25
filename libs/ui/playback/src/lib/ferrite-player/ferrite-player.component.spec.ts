import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import type { Channel } from '@iptvnator/shared/interfaces';
import type { FerritePlayerComponent as FerritePlayerComponentInstance } from './ferrite-player.component';

// Each createPlayer() call returns a fresh fake facade; the test inspects the
// most recent one (and the full list, to assert a zap created a new player).
const createdPlayers: FakePlayer[] = [];
const createPlayerMock = jest.fn(
    (source: unknown, config: unknown) => {
        const player = new FakePlayer(source, config);
        createdPlayers.push(player);
        return player;
    }
);
const getFeatureListMock = jest.fn(() => ({ crossOriginIsolated: true }));

class FakePlayer {
    source: unknown;
    config: unknown;
    handlers = new Map<string, ((...args: unknown[]) => void)[]>();
    volume = 1;
    muted = false;
    paused = false;
    duration = 0;
    tier = 'software';
    mediaInfo: unknown = null;
    attachedCanvas: HTMLCanvasElement | null = null;
    off = jest.fn();
    load = jest.fn();
    play = jest.fn().mockResolvedValue(undefined);
    pause = jest.fn();
    unload = jest.fn();
    detachMediaElement = jest.fn();
    destroy = jest.fn();
    seek = jest.fn();
    setDeint = jest.fn();
    on = jest.fn((event: string, cb: (...args: unknown[]) => void) => {
        const list = this.handlers.get(event) ?? [];
        list.push(cb);
        this.handlers.set(event, list);
    });
    attachCanvas = jest.fn((canvas: HTMLCanvasElement) => {
        this.attachedCanvas = canvas;
    });

    constructor(source: unknown, config: unknown) {
        this.source = source;
        this.config = config;
    }
}

jest.unstable_mockModule('ferrite.js', () => ({
    default: {
        createPlayer: createPlayerMock,
        getFeatureList: getFeatureListMock,
    },
    Events: {
        ERROR: 'error',
        MEDIA_INFO: 'media_info',
        TIME_UPDATE: 'ferrite_time_update',
        LOADING_COMPLETE: 'loading_complete',
        RECOVERED_EARLY_EOF: 'recovered_early_eof',
        DEINT_FAILED: 'ferrite_deint_failed',
    },
}));

function channel(url: string): Channel {
    return { id: url, url, name: url } as Channel;
}

describe('FerritePlayerComponent', () => {
    let FerritePlayerComponent: typeof import('./ferrite-player.component').FerritePlayerComponent;
    let fixture: ComponentFixture<FerritePlayerComponentInstance>;
    let component: FerritePlayerComponentInstance;

    beforeAll(async () => {
        ({ FerritePlayerComponent } = await import('./ferrite-player.component'));
    });

    beforeEach(async () => {
        localStorage.clear();
        createdPlayers.length = 0;
        createPlayerMock.mockClear();
        getFeatureListMock.mockClear();

        await TestBed.configureTestingModule({
            imports: [FerritePlayerComponent, TranslateModule.forRoot()],
        }).compileComponents();
    });

    afterEach(() => {
        fixture?.destroy();
        fixture = undefined as unknown as ComponentFixture<FerritePlayerComponentInstance>;
        localStorage.clear();
    });

    /** Create the component (constructor reads the persisted volume, so any
     *  localStorage seeding must happen before this) and load a channel. */
    function createComponent(): void {
        fixture = TestBed.createComponent(FerritePlayerComponent);
        component = fixture.componentInstance;
    }

    function start(url: string, inputs: Record<string, unknown> = {}): void {
        if (!fixture) {
            createComponent();
        }
        for (const [key, value] of Object.entries(inputs)) {
            fixture.componentRef.setInput(key, value);
        }
        fixture.componentRef.setInput('channel', channel(url));
        fixture.detectChanges();
    }

    function lastPlayer(): FakePlayer {
        return createdPlayers[createdPlayers.length - 1];
    }

    it('should create', () => {
        createComponent();
        fixture.detectChanges();
        expect(component).toBeTruthy();
    });

    it('creates a player and attaches the keyed canvas when a channel loads', () => {
        start('http://example.com/a.ts');

        expect(createPlayerMock).toHaveBeenCalledTimes(1);
        const player = lastPlayer();
        const canvas = fixture.nativeElement.querySelector('canvas');
        expect(canvas).not.toBeNull();
        expect(player.attachCanvas).toHaveBeenCalledWith(canvas);
        expect(player.load).toHaveBeenCalled();
        expect(player.play).toHaveBeenCalled();
    });

    it('recreates the canvas + player on a channel zap (fresh element, not the transferred one)', () => {
        start('http://example.com/a.ts');
        const firstCanvas = fixture.nativeElement.querySelector('canvas');
        const firstPlayer = lastPlayer();

        // Zap to a different source: the keyed @for destroys the old canvas and
        // mounts a fresh element; a stale (transferred) canvas can never re-attach.
        fixture.componentRef.setInput('channel', channel('http://example.com/b.ts'));
        fixture.detectChanges();

        const secondCanvas = fixture.nativeElement.querySelector('canvas');
        const secondPlayer = lastPlayer();

        // A fresh element + a fresh player back the new source (a transferred
        // canvas can never re-attach, so the element identity must change).
        expect(secondCanvas).not.toBe(firstCanvas);
        expect(secondPlayer).not.toBe(firstPlayer);
        expect(secondPlayer.source).toEqual(
            expect.objectContaining({ url: 'http://example.com/b.ts' })
        );
        expect(secondPlayer.attachCanvas).toHaveBeenCalledWith(secondCanvas);
        // The new player attached the NEW (live) canvas, never the stale one.
        expect(secondPlayer.attachedCanvas).toBe(secondCanvas);
        // The old player was torn down on zap.
        expect(firstPlayer.destroy).toHaveBeenCalled();
    });

    it('passes isLive through to createPlayer for both live and VOD', () => {
        start('http://example.com/live.ts', { isLive: true });
        expect(createPlayerMock).toHaveBeenLastCalledWith(
            expect.objectContaining({ isLive: true }),
            expect.objectContaining({ isLive: true, liveSync: true })
        );

        fixture.componentRef.setInput('isLive', false);
        fixture.componentRef.setInput('channel', channel('http://example.com/vod.ts'));
        fixture.detectChanges();

        expect(createPlayerMock).toHaveBeenLastCalledWith(
            expect.objectContaining({ isLive: false }),
            expect.objectContaining({ isLive: false, liveSync: false })
        );
    });

    it('keeps the localStorage-restored volume when the volume input is the null sentinel', () => {
        localStorage.setItem('volume', '0.37');

        // volume defaults to null ("no opinion") → restored value must survive.
        start('http://example.com/a.ts');

        const player = lastPlayer();
        expect(player.volume).toBe(0.37);
    });

    it('applies a genuine volume input over the restored value', () => {
        localStorage.setItem('volume', '0.37');

        start('http://example.com/a.ts', { volume: 0.6 });

        const player = lastPlayer();
        expect(player.volume).toBe(0.6);
    });

    it('exposes whether the page is cross-origin isolated from the feature list', () => {
        createComponent();
        fixture.detectChanges();
        expect(getFeatureListMock).toHaveBeenCalled();
        expect(
            (component as unknown as { dbgIsolated: boolean }).dbgIsolated
        ).toBe(true);
    });

    it('tears down the player on destroy', () => {
        start('http://example.com/a.ts');
        const player = lastPlayer();

        fixture.destroy();

        expect(player.pause).toHaveBeenCalled();
        expect(player.unload).toHaveBeenCalled();
        expect(player.detachMediaElement).toHaveBeenCalled();
        expect(player.destroy).toHaveBeenCalled();
    });
});
