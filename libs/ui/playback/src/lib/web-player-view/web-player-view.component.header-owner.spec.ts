import {
    ComponentFixture,
    DeferBlockBehavior,
    TestBed,
} from '@angular/core/testing';
import { StorageMap } from '@ngx-pwa/local-storage';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { VideoPlayer } from '@iptvnator/shared/interfaces';
import type { WebPlayerViewComponent as WebPlayerViewComponentInstance } from './web-player-view.component';
import {
    StubArtPlayerComponent,
    StubEmbeddedMpvPlayerComponent,
    StubFullscreenChannelPanelComponent,
    StubHtmlVideoPlayerComponent,
    StubVjsPlayerComponent,
} from './web-player-view.spec-stubs';

jest.unstable_mockModule('video.js', () => ({
    default: jest.fn(),
}));
jest.unstable_mockModule('@yangkghjh/videojs-aspect-ratio-panel', () => ({}));
jest.unstable_mockModule('videojs-contrib-quality-levels', () => ({}));
jest.unstable_mockModule('videojs-quality-selector-hls', () => ({}));

const STREAM_A = 'https://a.example/live/one.m3u8';
const STREAM_B = 'https://b.example/live/two.m3u8';

describe('WebPlayerViewComponent header owner', () => {
    let WebPlayerViewComponent: typeof import('./web-player-view.component').WebPlayerViewComponent;
    let setUserAgent: jest.Mock;
    const fixtures: ComponentFixture<WebPlayerViewComponentInstance>[] = [];

    beforeAll(async () => {
        ({ WebPlayerViewComponent } =
            await import('./web-player-view.component'));
    });

    beforeEach(async () => {
        setUserAgent = jest.fn().mockResolvedValue(true);
        (window as unknown as { electron?: unknown }).electron = {
            setUserAgent,
        };
        await TestBed.configureTestingModule({
            deferBlockBehavior: DeferBlockBehavior.Playthrough,
            imports: [WebPlayerViewComponent, TranslateModule.forRoot()],
            providers: [
                {
                    provide: StorageMap,
                    useValue: {
                        get: () => of({ player: VideoPlayer.Html5Player }),
                        set: () => of(undefined),
                    },
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsManagedExternalPlayers: false },
                },
            ],
        })
            .overrideComponent(WebPlayerViewComponent, {
                set: {
                    imports: [
                        StubArtPlayerComponent,
                        StubEmbeddedMpvPlayerComponent,
                        StubFullscreenChannelPanelComponent,
                        StubHtmlVideoPlayerComponent,
                        StubVjsPlayerComponent,
                    ],
                },
            })
            .compileComponents();
    });

    afterEach(() => {
        fixtures.splice(0).forEach((fixture) => fixture.destroy());
        delete (window as unknown as { electron?: unknown }).electron;
    });

    function mount(
        streamUrl: string,
        headerOwner?: string
    ): ComponentFixture<WebPlayerViewComponentInstance> {
        const fixture = TestBed.createComponent(WebPlayerViewComponent);
        fixtures.push(fixture);
        fixture.componentRef.setInput('playbackSessionKey', streamUrl);
        fixture.componentRef.setInput('streamUrl', streamUrl);
        fixture.componentRef.setInput(
            'playerOverride',
            VideoPlayer.Html5Player
        );
        fixture.componentRef.setInput('playback', {
            streamUrl,
            title: 'Synthetic stream',
            isLive: true,
            userAgent: `Agent for ${streamUrl}`,
        });
        if (headerOwner !== undefined) {
            fixture.componentRef.setInput('headerOwner', headerOwner);
        }
        return fixture;
    }

    it('uses the default slot and the five-argument call without an owner', async () => {
        const fixture = mount(STREAM_A);
        fixture.detectChanges();
        await fixture.whenStable();

        expect(setUserAgent.mock.calls).toEqual([
            [
                `Agent for ${STREAM_A}`,
                undefined,
                STREAM_A,
                undefined,
                undefined,
            ],
        ]);

        fixture.destroy();
        expect(setUserAgent).toHaveBeenLastCalledWith(
            undefined,
            undefined,
            STREAM_A
        );
    });

    it('configures and releases its own slot when an owner is set', async () => {
        const fixture = mount(STREAM_B, 'tile-b');
        fixture.detectChanges();
        await fixture.whenStable();

        expect(setUserAgent.mock.calls).toEqual([
            [
                `Agent for ${STREAM_B}`,
                undefined,
                STREAM_B,
                undefined,
                undefined,
                'tile-b',
            ],
        ]);

        fixture.destroy();
        expect(setUserAgent).toHaveBeenLastCalledWith(
            undefined,
            undefined,
            STREAM_B,
            undefined,
            undefined,
            'tile-b'
        );
    });

    it('hands both sources over when two views with their own owners start together', async () => {
        const resolvers: Array<() => void> = [];
        setUserAgent.mockImplementation(
            () =>
                new Promise<boolean>((resolve) =>
                    resolvers.push(() => resolve(true))
                )
        );
        const first = mount(STREAM_A, 'tile-a');
        const second = mount(STREAM_B, 'tile-b');
        first.detectChanges();
        second.detectChanges();

        resolvers.forEach((resolve) => resolve());
        await first.whenStable();
        await second.whenStable();

        expect(first.componentInstance.channel()?.url).toBe(STREAM_A);
        expect(second.componentInstance.channel()?.url).toBe(STREAM_B);
    });

    it('keeps the other view playing when one view is destroyed', async () => {
        const first = mount(STREAM_A, 'tile-a');
        const second = mount(STREAM_B, 'tile-b');
        first.detectChanges();
        second.detectChanges();
        await first.whenStable();
        await second.whenStable();
        setUserAgent.mockClear();

        first.destroy();

        expect(setUserAgent.mock.calls).toEqual([
            [undefined, undefined, STREAM_A, undefined, undefined, 'tile-a'],
        ]);
    });
});
