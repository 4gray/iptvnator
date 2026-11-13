import { Component, ElementRef, input, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MultiviewSessionStore } from '@iptvnator/playback/multiview/data-access';
import { SettingsStore } from '@iptvnator/services';
import { VideoPlayer } from '@iptvnator/shared/interfaces';
import { hostMultiviewStage } from './multiview-stage-host';

@Component({ selector: 'app-fake-stage', template: 'stage' })
class FakeStageComponent {
    static readonly instances: FakeStageComponent[] = [];
    readonly clipTo = input<HTMLElement | null>(null);
    readonly inert = input(false);

    constructor() {
        FakeStageComponent.instances.push(this);
    }
}

const load = jest.fn(() => Promise.resolve(FakeStageComponent));

@Component({
    template: `<div #frame class="frame"><main #content></main></div>`,
})
class ShellLikeComponent {
    readonly drawerOpen = signal(false);
    private readonly frame = viewChild<ElementRef<HTMLElement>>('frame');
    private readonly content = viewChild<ElementRef<HTMLElement>>('content');

    constructor() {
        hostMultiviewStage({
            frame: () => this.frame()?.nativeElement,
            clipTo: () => this.content()?.nativeElement,
            inert: () => this.drawerOpen(),
            load,
        });
    }
}

function source(key: string) {
    return {
        playback: {
            streamUrl: `https://stream.example/${key}.m3u8`,
            title: key,
        },
        playbackSessionKey: `session:${key}`,
        kind: 'live' as const,
        playlistId: 'playlist-1',
        title: key,
    };
}

describe('hostMultiviewStage', () => {
    beforeEach(() => {
        load.mockClear();
        FakeStageComponent.instances.length = 0;
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: SettingsStore,
                    useValue: { player: signal(VideoPlayer.VideoJs) },
                },
            ],
        });
    });

    async function settle(fixture: { detectChanges(): void }) {
        fixture.detectChanges();
        await Promise.resolve();
        await Promise.resolve();
        fixture.detectChanges();
    }

    it('loads and renders nothing while no session exists', async () => {
        const fixture = TestBed.createComponent(ShellLikeComponent);
        await settle(fixture);

        expect(load).not.toHaveBeenCalled();
        expect(
            fixture.nativeElement.querySelector('app-multiview-stage')
        ).toBeNull();
    });

    it('creates the stage in the frame once, when the first session starts', async () => {
        const fixture = TestBed.createComponent(ShellLikeComponent);
        await settle(fixture);
        const store = TestBed.inject(MultiviewSessionStore);

        store.start('anchor', source('a'), VideoPlayer.VideoJs, source('b'));
        await settle(fixture);
        store.exit();
        store.start('anchor', source('c'), VideoPlayer.VideoJs, source('d'));
        await settle(fixture);

        const frame: HTMLElement =
            fixture.nativeElement.querySelector('.frame');
        const stages = frame.querySelectorAll('app-multiview-stage');
        expect(load).toHaveBeenCalledTimes(1);
        expect(stages).toHaveLength(1);
        expect(stages[0].parentElement).toBe(frame);
        expect(stages[0].textContent).toBe('stage');
    });

    it('passes the scroller and the drawer state to the stage', async () => {
        const fixture = TestBed.createComponent(ShellLikeComponent);
        await settle(fixture);
        TestBed.inject(MultiviewSessionStore).start(
            'anchor',
            source('a'),
            VideoPlayer.VideoJs,
            source('b')
        );
        await settle(fixture);
        const [stage] = FakeStageComponent.instances;

        expect(stage.clipTo()).toBe(
            fixture.nativeElement.querySelector('main')
        );
        expect(stage.inert()).toBe(false);

        fixture.componentInstance.drawerOpen.set(true);
        await settle(fixture);
        expect(stage.inert()).toBe(true);
    });

    it('destroys the stage with the shell', async () => {
        const fixture = TestBed.createComponent(ShellLikeComponent);
        await settle(fixture);
        TestBed.inject(MultiviewSessionStore).start(
            'anchor',
            source('a'),
            VideoPlayer.VideoJs,
            source('b')
        );
        await settle(fixture);
        const frame: HTMLElement =
            fixture.nativeElement.querySelector('.frame');

        fixture.destroy();

        expect(frame.querySelector('app-multiview-stage')).toBeNull();
    });
});
