import { Component, input, output, signal } from '@angular/core';
import type { PlaybackDiagnostic } from '@iptvnator/playback/util';
import type {
    EmbeddedMpvSupport,
    RecordingStartMetadata,
    RecordingStoppedEvent,
} from '@iptvnator/shared/interfaces';

/**
 * Player stand-ins for WebPlayerViewComponent specs. They mirror the real
 * component inputs so a spec can assert what the host hands each engine
 * without pulling in video.js, ArtPlayer or the Electron bridge.
 */

@Component({
    selector: 'app-vjs-player',
    template: '<div data-test-id="stub-vjs-player"></div>',
})
export class StubVjsPlayerComponent {
    readonly options = input<unknown>();
    readonly fullscreenTarget = input<HTMLElement | null>(null);
    readonly mediaTitle = input<unknown>(null);
    readonly volume = input(1);
    readonly showCaptions = input(false);
    readonly interactionEnabled = input(true);
    readonly startTime = input(0);
    readonly seriesNavigation = input<unknown>(null);
    readonly timeUpdate = output<{ currentTime: number; duration: number }>();
    readonly playbackIssue = output<PlaybackDiagnostic | null>();
    readonly playbackEnded = output<void>();
    readonly previousEpisodeRequested = output<void>();
    readonly nextEpisodeRequested = output<void>();
}

@Component({
    selector: 'app-html-video-player',
    template: '<div data-test-id="stub-html-player"></div>',
})
export class StubHtmlVideoPlayerComponent {
    readonly channel = input<unknown>();
    readonly fullscreenTarget = input<HTMLElement | null>(null);
    readonly mediaTitle = input<unknown>(null);
    readonly volume = input(1);
    readonly showCaptions = input(false);
    readonly isLive = input(true);
    readonly interactionEnabled = input(true);
    readonly startTime = input(0);
    readonly seriesNavigation = input<unknown>(null);
    readonly timeUpdate = output<{ currentTime: number; duration: number }>();
    readonly playbackIssue = output<PlaybackDiagnostic | null>();
    readonly playbackEnded = output<void>();
    readonly previousEpisodeRequested = output<void>();
    readonly nextEpisodeRequested = output<void>();
}

@Component({
    selector: 'app-art-player',
    template: '<div data-test-id="stub-art-player"></div>',
})
export class StubArtPlayerComponent {
    readonly channel = input<unknown>();
    readonly fullscreenTarget = input<HTMLElement | null>(null);
    readonly mediaTitle = input<unknown>(null);
    readonly volume = input(1);
    readonly showCaptions = input(false);
    readonly isLive = input(true);
    readonly interactionEnabled = input(true);
    readonly startTime = input(0);
    readonly seriesNavigation = input<unknown>(null);
    readonly timeUpdate = output<{ currentTime: number; duration: number }>();
    readonly playbackIssue = output<PlaybackDiagnostic | null>();
    readonly playbackEnded = output<void>();
    readonly previousEpisodeRequested = output<void>();
    readonly nextEpisodeRequested = output<void>();
}

@Component({
    selector: 'app-fullscreen-channel-panel',
    template: '<div data-test-id="stub-fullscreen-channel-panel"></div>',
})
export class StubFullscreenChannelPanelComponent {
    readonly stage = input<HTMLElement | null>(null);
    readonly enabled = input(true);
}

@Component({
    selector: 'app-embedded-mpv-player',
    template: '<div data-test-id="stub-embedded-mpv-player"></div>',
})
export class StubEmbeddedMpvPlayerComponent {
    readonly support = signal<EmbeddedMpvSupport | null>(null);
    readonly playback = input.required<unknown>();
    readonly fullscreenTarget = input<HTMLElement | null>(null);
    readonly mediaTitle = input<unknown>(null);
    readonly recordingFolder = input('');
    readonly recordingMetadata = input<RecordingStartMetadata | null>(null);
    readonly seriesNavigation = input<unknown>(null);
    readonly timeUpdate = output<{ currentTime: number; duration: number }>();
    readonly playbackEnded = output<void>();
    readonly previousEpisodeRequested = output<void>();
    readonly nextEpisodeRequested = output<void>();
    readonly recordingStopped = output<RecordingStoppedEvent>();
}
