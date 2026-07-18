import { By } from '@angular/platform-browser';
import {
    MockHls,
    TEST_CHANNEL,
    cleanupSharedControlsTests,
    configureSharedControlsTests,
    hlsInstances,
    lifecycle,
    mpegTsCreatePlayer,
    mpegTsInstances,
    mpegTsIsSupported,
    observeBridgeSourceBinding,
    readHtmlPlayerInternals,
    renderSharedControls,
    type SharedControlsFixture,
} from './html-video-player.component.shared-controls.spec-fixtures';

describe('HtmlVideoPlayerComponent shared controls sources', () => {
    let HtmlVideoPlayerComponent: typeof import('./html-video-player.component').HtmlVideoPlayerComponent;
    const fixtures: SharedControlsFixture[] = [];

    beforeAll(async () => {
        ({ HtmlVideoPlayerComponent } =
            await import('./html-video-player.component'));
    });

    beforeEach(async () => {
        await configureSharedControlsTests(HtmlVideoPlayerComponent);
    });

    afterEach(() => {
        cleanupSharedControlsTests(fixtures);
    });

    it('retains an HLS source created before bridge initialization', () => {
        const { adapter } = renderSharedControls(
            HtmlVideoPlayerComponent,
            fixtures,
            {
                channel: TEST_CHANNEL,
                isLive: false,
                showCaptions: true,
            }
        );

        expect(hlsInstances).toHaveLength(1);
        expect(adapter.capabilities().audioTracks).toBe(true);
        expect(adapter.state().audioTracks).toEqual([
            { id: 0, label: 'English', selected: true },
            { id: 1, label: 'Deutsch', selected: false },
        ]);
    });

    it('binds HLS controls after media attach and before source loading', () => {
        const { component } = renderSharedControls(
            HtmlVideoPlayerComponent,
            fixtures
        );
        lifecycle.length = 0;

        component.playChannel(TEST_CHANNEL);

        const attachIndex = lifecycle.indexOf('hls:attachMedia');
        const bindIndex = lifecycle.indexOf(
            `on:${MockHls.Events.AUDIO_TRACKS_UPDATED}`
        );
        const loadIndex = lifecycle.indexOf('hls:loadSource');
        expect(attachIndex).toBeGreaterThanOrEqual(0);
        expect(bindIndex).toBeGreaterThanOrEqual(0);
        expect(loadIndex).toBeGreaterThanOrEqual(0);
        expect(attachIndex).toBeLessThan(bindIndex);
        expect(bindIndex).toBeLessThan(loadIndex);
    });

    it.each([false, true])(
        'passes authoritative isLive=%s to raw MPEG-TS playback',
        (isLive) => {
            mpegTsIsSupported.mockReturnValue(true);

            renderSharedControls(HtmlVideoPlayerComponent, fixtures, {
                channel: {
                    ...TEST_CHANNEL,
                    url: 'https://example.test/raw.ts',
                },
                isLive,
            });

            expect(mpegTsCreatePlayer).toHaveBeenCalledWith({
                type: 'mpegts',
                isLive,
                url: 'https://example.test/raw.ts',
            });
        }
    );

    it('owns one MPEG-TS source between media attachment and loading', () => {
        mpegTsIsSupported.mockReturnValue(true);
        const { component } = renderSharedControls(
            HtmlVideoPlayerComponent,
            fixtures,
            { isLive: false }
        );
        const setSource = observeBridgeSourceBinding(component);
        lifecycle.length = 0;

        component.playChannel({
            ...TEST_CHANNEL,
            url: 'https://example.test/raw.ts',
        });

        const internals = readHtmlPlayerInternals(component);
        expect(setSource).toHaveBeenCalledTimes(1);
        expect(setSource).toHaveBeenCalledWith({ kind: 'mpegts' });
        expect(internals.controlsSource).toEqual({ kind: 'mpegts' });
        expect(internals.hls).toBeNull();
        expect(hlsInstances).toHaveLength(0);
        expect(mpegTsInstances).toHaveLength(1);
        expect(internals.mpegtsPlayer).toBe(mpegTsInstances[0]);
        expect(mpegTsInstances[0].attachMediaElement).toHaveBeenCalledTimes(1);
        expect(mpegTsInstances[0].load).toHaveBeenCalledTimes(1);
        expect(lifecycle.indexOf('mpegts:attachMedia')).toBeLessThan(
            lifecycle.indexOf('bridge:mpegts')
        );
        expect(lifecycle.indexOf('bridge:mpegts')).toBeLessThan(
            lifecycle.indexOf('mpegts:load')
        );
    });

    it('owns one Shaka source for DASH (.mpd) streams', () => {
        const { component } = renderSharedControls(
            HtmlVideoPlayerComponent,
            fixtures
        );
        const setSource = observeBridgeSourceBinding(component);

        component.playChannel({
            ...TEST_CHANNEL,
            url: 'https://example.test/live.mpd',
            drm: {
                licenseType: 'clearkey',
                supported: true,
                clearKeys: { abc: 'def' },
            },
        });

        const internals = readHtmlPlayerInternals(component);
        expect(setSource).toHaveBeenCalledTimes(1);
        expect(setSource).toHaveBeenCalledWith(
            expect.objectContaining({ kind: 'shaka' })
        );
        expect(internals.controlsSource).toEqual(
            expect.objectContaining({ kind: 'shaka' })
        );
        expect(internals.hls).toBeNull();
        expect(internals.mpegtsPlayer).toBeNull();
        expect(hlsInstances).toHaveLength(0);
        expect(mpegTsInstances).toHaveLength(0);
    });

    it('owns one native source before loading native media', () => {
        const { component, fixture } = renderSharedControls(
            HtmlVideoPlayerComponent,
            fixtures
        );
        const setSource = observeBridgeSourceBinding(component);
        const video = fixture.debugElement.query(By.css('video'))
            .nativeElement as HTMLVideoElement;
        const load = jest
            .spyOn(video, 'load')
            .mockImplementation(() => lifecycle.push('native:load'));
        lifecycle.length = 0;

        component.playChannel({
            ...TEST_CHANNEL,
            url: 'https://example.test/movie.mp4',
        });

        const internals = readHtmlPlayerInternals(component);
        expect(setSource).toHaveBeenCalledTimes(1);
        expect(setSource).toHaveBeenCalledWith({ kind: 'native' });
        expect(internals.controlsSource).toEqual({ kind: 'native' });
        expect(internals.hls).toBeNull();
        expect(internals.mpegtsPlayer).toBeNull();
        expect(hlsInstances).toHaveLength(0);
        expect(mpegTsInstances).toHaveLength(0);
        expect(load).toHaveBeenCalledTimes(1);
        expect(lifecycle.indexOf('bridge:native')).toBeLessThan(
            lifecycle.indexOf('native:load')
        );
    });

    it('refreshes live and caption inputs through authoritative closures', () => {
        const { fixture, adapter } = renderSharedControls(
            HtmlVideoPlayerComponent,
            fixtures,
            {
                channel: TEST_CHANNEL,
                isLive: true,
                showCaptions: false,
            }
        );
        const hls = hlsInstances[0];

        expect(adapter.state().isLive).toBe(true);
        expect(hls.subtitleDisplay).toBe(false);

        fixture.componentRef.setInput('isLive', false);
        fixture.componentRef.setInput('showCaptions', true);
        fixture.detectChanges();

        expect(adapter.state().isLive).toBe(false);
        expect(hls.subtitleDisplay).toBe(true);
    });

    it('clears old HLS listeners and tracks before destroying the engine', () => {
        const { component, adapter } = renderSharedControls(
            HtmlVideoPlayerComponent,
            fixtures,
            {
                channel: TEST_CHANNEL,
                isLive: false,
                showCaptions: true,
            }
        );
        const hls = hlsInstances[0];
        const setSource = observeBridgeSourceBinding(component);
        lifecycle.length = 0;

        component.playChannel({
            ...TEST_CHANNEL,
            url: 'https://example.test/movie.mp4',
        });

        const destroyIndex = lifecycle.indexOf('hls:destroy');
        expect(destroyIndex).toBeGreaterThan(0);
        expect(
            lifecycle
                .slice(0, destroyIndex)
                .filter((event) => event.startsWith('off:'))
        ).toHaveLength(7);
        const internals = readHtmlPlayerInternals(component);
        expect(setSource).toHaveBeenCalledTimes(1);
        expect(setSource).toHaveBeenCalledWith({ kind: 'native' });
        expect(internals.controlsSource).toEqual({ kind: 'native' });
        expect(internals.hls).toBeNull();
        expect(internals.mpegtsPlayer).toBeNull();
        expect(hlsInstances).toHaveLength(1);
        expect(mpegTsInstances).toHaveLength(0);
        expect(hls.off).toHaveBeenCalledTimes(7);
        expect(adapter.state().audioTracks).toEqual([]);
        expect(adapter.state().subtitleTracks).toEqual([]);
    });

    it('destroys the bridge before HLS and detaches the adapter once', () => {
        const { component, adapter } = renderSharedControls(
            HtmlVideoPlayerComponent,
            fixtures,
            {
                channel: TEST_CHANNEL,
                showCaptions: true,
            }
        );
        const originalDetach = adapter.detach.bind(adapter);
        const detach = jest.spyOn(adapter, 'detach').mockImplementation(() => {
            lifecycle.push('adapter:detach');
            originalDetach();
        });
        lifecycle.length = 0;

        component.ngOnDestroy();
        component.ngOnDestroy();

        expect(detach).toHaveBeenCalledTimes(1);
        expect(lifecycle.indexOf('adapter:detach')).toBeLessThan(
            lifecycle.indexOf('hls:destroy')
        );
    });
});
