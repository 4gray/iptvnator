import { Component, input, output } from '@angular/core';
import type { PlaybackDiagnostic } from '../playback-diagnostics/playback-diagnostics.util';

/**
 * Player stand-ins for WebPlayerViewComponent specs. They mirror the real
 * component inputs so a spec can assert what the host hands each engine
 * without pulling in video.js, ArtPlayer or the Electron bridge.
 */

@Component({ selector: 'app-vjs-player', template: '' })
export class StubVjsPlayerComponent {
    readonly options = input<unknown>();
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

@Component({ selector: 'app-html-video-player', template: '' })
export class StubHtmlVideoPlayerComponent {
    readonly channel = input<unknown>();
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

@Component({ selector: 'app-art-player', template: '' })
export class StubArtPlayerComponent {
    readonly channel = input<unknown>();
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

@Component({ selector: 'app-embedded-mpv-player', template: '' })
export class StubEmbeddedMpvPlayerComponent {
    readonly playback = input.required<unknown>();
    readonly mediaTitle = input<unknown>(null);
    readonly recordingFolder = input('');
    readonly seriesNavigation = input<unknown>(null);
    readonly timeUpdate = output<{ currentTime: number; duration: number }>();
    readonly playbackEnded = output<void>();
    readonly previousEpisodeRequested = output<void>();
    readonly nextEpisodeRequested = output<void>();
}
