import { SecondStreamPosition } from '../second-stream/second-stream-position';
import {
    Component,
    computed,
    ElementRef,
    inject,
    input,
    model,
    output,
    signal,
} from '@angular/core';
import { SecondStreamFocus } from '../second-stream/second-stream-focus';
import type {
    CompanionSlot,
    MultiviewLayout,
    MultiviewSlot,
} from '../second-stream/second-stream-open-stream';
import type { PlaybackDiagnostic } from '@iptvnator/playback/util';
import type {
    EmbeddedMpvSupport,
    EmbeddedMpvSession,
    RecordingStartMetadata,
    RecordingStoppedEvent,
} from '@iptvnator/shared/interfaces';
import type { PlayerTimeUpdate } from '../playback-history/player-time-update';

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
    readonly retryRequested = output<void>();
    readonly options = input<unknown>();
    readonly fullscreenTarget = input<HTMLElement | null>(null);
    readonly mediaTitle = input<unknown>(null);
    readonly upNext = input<unknown>(null);
    readonly timelineSegments = input<unknown>(null);
    readonly volume = input(1);
    readonly showCaptions = input(false);
    readonly interactionEnabled = input(true);
    readonly startTime = input(0);
    readonly seriesNavigation = input<unknown>(null);
    readonly timeUpdate = output<PlayerTimeUpdate>();
    readonly playbackIssue = output<PlaybackDiagnostic | null>();
    readonly playbackStarted = output<void>();
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
    readonly upNext = input<unknown>(null);
    readonly timelineSegments = input<unknown>(null);
    readonly volume = input(1);
    readonly showCaptions = input(false);
    readonly isLive = input(true);
    readonly interactionEnabled = input(true);
    readonly startTime = input(0);
    readonly seriesNavigation = input<unknown>(null);
    readonly timeUpdate = output<PlayerTimeUpdate>();
    readonly playbackIssue = output<PlaybackDiagnostic | null>();
    readonly playbackStarted = output<void>();
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
    readonly upNext = input<unknown>(null);
    readonly timelineSegments = input<unknown>(null);
    readonly volume = input(1);
    readonly showCaptions = input(false);
    readonly isLive = input(true);
    readonly interactionEnabled = input(true);
    readonly startTime = input(0);
    readonly seriesNavigation = input<unknown>(null);
    readonly timeUpdate = output<PlayerTimeUpdate>();
    readonly playbackIssue = output<PlaybackDiagnostic | null>();
    readonly playbackStarted = output<void>();
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
    template: `
        <div data-test-id="stub-embedded-mpv-player"></div>
        @if (canOpenMultiview()) {
            <button type="button" data-multiview-trigger>Multiview</button>
        }
    `,
})
export class StubEmbeddedMpvPlayerComponent {
    // Host presentation is exercised with real popovers in Electron E2E.
    readonly appSecondStreamFloating = input(false);
    readonly showControls = input(true);
    readonly sharedVolumeController = input<unknown>();
    readonly inactiveSurfaceClicked = output<void>();
    readonly canOpenMultiview = input(false);
    readonly multiviewAddRequested = output<void>();
    readonly multiviewGridRequested = output<void>();
    readonly retryEnabled = input(true);
    readonly initialVolumeOverride = input<number | null>(null);
    readonly support = signal<EmbeddedMpvSupport | null>(null);
    readonly session = signal<EmbeddedMpvSession | null>(null);
    readonly liveSubtitlesOff = model(false);
    readonly playback = input.required<unknown>();
    readonly fullscreenTarget = input<HTMLElement | null>(null);
    readonly mediaTitle = input<unknown>(null);
    readonly upNext = input<unknown>(null);
    readonly timelineSegments = input<unknown>(null);
    readonly recordingFolder = input('');
    readonly recordingMetadata = input<RecordingStartMetadata | null>(null);
    readonly seriesNavigation = input<unknown>(null);
    readonly timeUpdate = output<PlayerTimeUpdate>();
    readonly playbackEnded = output<void>();
    readonly previousEpisodeRequested = output<void>();
    readonly nextEpisodeRequested = output<void>();
    readonly recordingStopped = output<RecordingStoppedEvent>();
}

@Component({
    selector: 'app-second-stream',
    template: `
        @if (stripVisible()) {
            <div class="second-stream__strip">
                <button type="button" (click)="focus.close(close())">
                    Exit
                </button>
            </div>
        }
    `,
})
export class StubSecondStreamComponent {
    private readonly host = inject(ElementRef<HTMLElement>).nativeElement;
    readonly recordingStopped = output<RecordingStoppedEvent>();
    readonly placement = new SecondStreamPosition();
    readonly active = signal(false);
    readonly primary = input<StubEmbeddedMpvPlayerComponent | null>(null);
    readonly fullscreenTarget = input<HTMLElement | null>(null);
    readonly swapped = signal(false);
    readonly available = computed(
        () => this.primary()?.support()?.engine === 'frame-copy'
    );
    readonly layout = signal<MultiviewLayout>('single');
    readonly stripVisible = computed(
        () => this.active() || this.layout() === 'grid'
    );
    readonly controlsSlot = signal<MultiviewSlot>(1);
    readonly audioSlot = signal<MultiviewSlot>(1);
    readonly audioController = signal<unknown>(undefined);
    readonly audibleVolume = signal(1);
    readonly error = signal(false);
    readonly busy = signal(false);
    readonly focus = new SecondStreamFocus(
        () => this.fullscreenTarget() ?? this.host
    );

    openPicker(): Promise<CompanionSlot | null> {
        return Promise.resolve(null);
    }

    setLayout(layout: MultiviewLayout): void {
        this.layout.set(layout);
    }

    close(): Promise<void> {
        this.setLayout('single');
        return Promise.resolve();
    }

    selectControls(slot: MultiviewSlot): void {
        this.controlsSlot.set(slot);
    }

    selectControlsFromKey(): void {
        // The Electron workflow exercises selecting a canvas by number.
    }
}
