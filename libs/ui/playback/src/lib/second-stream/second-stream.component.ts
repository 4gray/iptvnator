import { SecondStreamFloatingDirective } from './second-stream-floating.directive';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    input,
    inject,
    Injector,
    OnDestroy,
    output,
    signal,
    viewChild,
    untracked,
} from '@angular/core';
import { MatDialog, type MatDialogRef } from '@angular/material/dialog';
import { ActivatedRoute } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { dialogSize } from '@iptvnator/ui/components/dialog-size';
import {
    createRandomId,
    type RecordingStoppedEvent,
} from '@iptvnator/shared/interfaces';
import { PLAYBACK_ACTIVITY_EVENTS } from '@iptvnator/services/activity-events';
import { WebPlayerActivity } from '../web-player-view/web-player-activity';
import {
    createInlinePlaybackPositionWriter,
    PORTAL_PLAYBACK_POSITIONS,
} from '@iptvnator/portal/shared/util';
import {
    SecondStreamCatalogService,
    UnifiedRecentDataService,
    type SecondStreamSelection,
} from '@iptvnator/portal/shared/data-access';
import { EmbeddedMpvPlayerComponent } from '../embedded-mpv-player/embedded-mpv-player.component';
import type { SecondStreamPickerComponent } from './second-stream-picker.component';
import { SecondStreamPosition } from './second-stream-position';
import { handoffMpvAudio } from '../embedded-mpv-player/embedded-mpv-audio-handoff';
import type {
    SecondStreamOpenStream,
    SecondStreamPickerData,
    SecondStreamView,
} from './second-stream-open-stream';
import { PlaybackProgressConfirmation } from '../playback-history/playback-progress-confirmation';
import type { PlayerTimeUpdate } from '../playback-history/player-time-update';
import {
    blurFocusedControl,
    clickPointerOrigin,
} from '../player-controls/pointer-focus-release';

@Component({
    selector: 'app-second-stream',
    templateUrl: './second-stream.component.html',
    styleUrl: './second-stream.component.scss',
    imports: [
        SecondStreamFloatingDirective,
        MatIconModule,
        MatTooltipModule,
        TranslatePipe,
        EmbeddedMpvPlayerComponent,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { '[class.second-stream--side-by-side]': 'sideBySide()' },
})
export class SecondStreamComponent implements OnDestroy {
    readonly primary = input.required<EmbeddedMpvPlayerComponent>();
    readonly fullscreenTarget = input<HTMLElement | null>(null);
    readonly recordingStopped = output<RecordingStoppedEvent>();
    readonly secondary = viewChild(EmbeddedMpvPlayerComponent);
    private readonly catalog = inject(SecondStreamCatalogService);
    private readonly dialog = inject(MatDialog);
    private readonly route = inject(ActivatedRoute, { optional: true });
    private picker?: MatDialogRef<
        SecondStreamPickerComponent,
        SecondStreamSelection
    >;
    readonly selection = signal<SecondStreamSelection | null>(null);
    private readonly relocking = signal(false);
    readonly playback = computed(() => {
        const selection = this.selection();
        return selection &&
            !this.relocking() &&
            this.catalog.isAllowed(selection.item)
            ? selection.playback
            : null;
    });
    readonly active = computed(() => this.playback() !== null);
    readonly swapped = signal(false);
    private readonly beside = signal(false);
    private readonly sideControls = signal<SecondStreamView>('primary');
    readonly sideBySide = computed(() => this.active() && this.beside());
    readonly audioView = computed<SecondStreamView>(() =>
        this.swapped() ? 'secondary' : 'primary'
    );
    readonly controlsView = computed(() =>
        this.sideBySide() ? this.sideControls() : this.audioView()
    );
    private readonly audiblePlayer = computed(() =>
        this.swapped() ? this.secondary() : this.primary()
    );
    readonly openStreams = computed<SecondStreamOpenStream[]>(() => {
        const primary = this.primary().playback();
        const secondary = this.playback();
        const streams: SecondStreamOpenStream[] = [];
        if (primary)
            streams.push({
                view: 'primary',
                playback: primary,
                small: this.swapped(),
                muted: (this.primary().session()?.volume ?? 0) === 0,
            });
        if (secondary)
            streams.push({
                view: 'secondary',
                playback: secondary,
                small: !this.swapped(),
                muted: (this.secondary()?.session()?.volume ?? 0) === 0,
            });
        return !this.sideBySide() && this.swapped()
            ? streams.reverse()
            : streams;
    });
    private readonly positions = inject(PORTAL_PLAYBACK_POSITIONS, {
        optional: true,
    });
    private readonly activityEvents = inject(PLAYBACK_ACTIVITY_EVENTS);
    private readonly activity = new WebPlayerActivity(this.activityEvents);
    private readonly positionWriter = createInlinePlaybackPositionWriter({
        playback: this.playback,
        save: (playlistId, position) => {
            void this.positions
                ?.savePlaybackPosition(playlistId, position)
                .catch(() => undefined);
        },
    });
    private readonly injector = inject(Injector);
    private readonly history = new PlaybackProgressConfirmation(() => {
        const item = this.selection()?.item;
        if (item)
            void this.injector
                .get(UnifiedRecentDataService)
                .recordPlayback(item)
                .catch(() => undefined);
    });
    readonly busy = signal(false);
    readonly editing = signal(false);
    readonly error = signal(false);
    readonly available = computed(
        () => this.primary().support()?.engine === 'frame-copy'
    );
    readonly small = computed(() =>
        this.swapped() ? this.primary() : this.secondary()
    );
    readonly ready = computed(() =>
        Boolean(
            this.primary().controller.sessionId() &&
            this.secondary()?.controller.sessionId()
        )
    );
    private readonly abort = new AbortController();
    readonly audibleVolume = signal(1);
    readonly placement = new SecondStreamPosition();
    readonly resizeCorners = ['left', 'right'] as const;

    constructor() {
        effect(() => {
            if (!this.available()) this.picker?.close();
        });
        effect((cleanup) => {
            const stage = this.fullscreenTarget();
            if (stage) cleanup(untracked(() => this.placement.observe(stage)));
        });
        effect(() => {
            if (!this.selection() || this.active()) return;
            this.relocking.set(true);
            if (!this.busy()) untracked(() => void this.stopWithheldStream());
        });
        effect(() => {
            if (this.busy() || this.relocking()) return;
            const session = this.audiblePlayer()?.session();
            if (
                (session?.status === 'playing' ||
                    session?.status === 'paused') &&
                (!this.error() || session.volume > 0)
            ) {
                this.audibleVolume.set(session.volume);
            }
        });
    }

    async openPicker(): Promise<void> {
        if (this.editing() || this.busy() || !this.available()) return;
        this.editing.set(true);
        try {
            const { SecondStreamPickerComponent } =
                await import('./second-stream-picker.component');
            if (this.abort.signal.aborted || !this.available()) return;

            const picker = this.dialog.open<
                SecondStreamPickerComponent,
                SecondStreamPickerData,
                SecondStreamSelection
            >(SecondStreamPickerComponent, {
                ...dialogSize('lg'),
                width: '820px',
                height: 'min(780px, calc(100dvh - 32px))',
                ariaModal: true,
                autoFocus: 'input[type="search"]',
                backdropClass: 'second-stream-picker-backdrop',
                data: {
                    returningToOriginal: this.swapped() && !this.sideBySide(),
                    initialPlaylist:
                        [...(this.route?.snapshot.pathFromRoot ?? [])]
                            .reverse()
                            .find((route) =>
                                /^(xtreams|stalker)\/:id$/.test(
                                    route.routeConfig?.path ?? ''
                                )
                            )
                            ?.paramMap.get('id') ?? undefined,
                },
            });
            this.picker = picker;
            picker.afterClosed().subscribe((selection) => {
                this.picker = undefined;
                if (!this.abort.signal.aborted && selection) {
                    void this.selectPlayback(selection);
                }
                this.editing.set(false);
            });
        } finally {
            if (!this.picker) this.editing.set(false);
        }
    }

    async selectPlayback(selection: SecondStreamSelection): Promise<void> {
        if (
            !this.editing() ||
            this.busy() ||
            this.relocking() ||
            !this.available()
        )
            return;
        if (!this.catalog.isAllowed(selection.item)) return;
        this.editing.set(false);
        if (this.swapped() && !(await this.swap())) {
            this.error.set(true);
            return;
        }
        if (
            this.abort.signal.aborted ||
            !this.catalog.isAllowed(selection.item)
        )
            return;
        this.flushPosition();
        const { playback } = selection;
        if (playback.contentInfo && !playback.isLive) {
            const ownedPlayback = {
                ...playback,
                contentInfo: {
                    ...playback.contentInfo,
                    activitySessionId: createRandomId(),
                },
            };
            this.activity.begin(ownedPlayback);
            this.selection.set({ ...selection, playback: ownedPlayback });
        } else {
            this.selection.set(selection);
        }
        this.error.set(false);
    }

    setSideBySide(enabled: boolean): void {
        if (!this.active() || this.busy() || this.sideBySide() === enabled)
            return;
        this.sideControls.set(this.audioView());
        this.beside.set(enabled);
    }

    selectControls(view: SecondStreamView): void {
        if (this.sideBySide()) this.sideControls.set(view);
    }

    selectSound(view: SecondStreamView): void {
        if (this.sideBySide() && view !== this.audioView()) void this.swap();
    }

    onStripClick(event: MouseEvent): void {
        const strip = event.currentTarget;
        if (strip instanceof HTMLElement && clickPointerOrigin(event)) {
            blurFocusedControl(strip);
        }
    }

    async swap(): Promise<boolean> {
        const canContinue = () => !this.abort.signal.aborted && this.active();
        if (this.busy() || !this.ready() || !canContinue()) return false;
        const outgoing = this.audiblePlayer();
        const incoming = this.swapped() ? this.primary() : this.secondary();
        const from = outgoing?.controller.sessionId();
        const to = incoming?.controller.sessionId();
        if (!from || !to) return false;
        this.busy.set(true);
        if (!this.error())
            this.audibleVolume.set(
                outgoing?.session()?.volume ?? this.audibleVolume()
            );
        this.error.set(false);
        try {
            await handoffMpvAudio(
                window.electron,
                from,
                to,
                this.audibleVolume(),
                canContinue
            );
            if (!canContinue()) return false;
            this.swapped.update((value) => !value);
            return true;
        } catch {
            if (canContinue()) this.error.set(true);
            return false;
        } finally {
            this.busy.set(false);
        }
    }

    private async stopWithheldStream(): Promise<void> {
        this.busy.set(true);
        const secondaryId = this.secondary()?.controller.sessionId();
        let muted = false;
        if (secondaryId) {
            try {
                await window.electron.setEmbeddedMpvVolume(secondaryId, 0);
                muted = true;
            } catch {
                // Without a mute acknowledgement, leave the primary volume alone.
            }
        }
        this.flushPosition();
        this.selection.set(null);
        this.beside.set(false);
        this.swapped.set(false);
        this.relocking.set(false);
        if (muted && !this.abort.signal.aborted)
            await this.restorePrimaryAudio();
        this.busy.set(false);
    }

    private async restorePrimaryAudio(): Promise<void> {
        const id = this.primary().controller.sessionId();
        if (id) {
            await window.electron
                .setEmbeddedMpvVolume(id, this.audibleVolume())
                .catch(() => undefined);
        }
    }

    async close(): Promise<void> {
        if (this.busy()) return;
        if (this.swapped()) await this.swap();
        if (this.selection() && !this.active()) return;
        this.swapped.set(false);
        this.flushPosition();
        this.selection.set(null);
        this.beside.set(false);
    }

    pauseSmall(): void {
        void this.small()?.controller.togglePaused();
    }

    savePosition(event: PlayerTimeUpdate): void {
        const player = this.secondary();
        const status = player?.session()?.status;
        if (
            player?.playback() !== this.playback() ||
            (status !== 'playing' &&
                status !== 'paused' &&
                status !== 'ended') ||
            !(event.currentTime > 0 && Number.isFinite(event.currentTime))
        )
            return;
        this.history.record(event.currentTime, status === 'playing');
        const playback = this.playback();
        if (
            this.activityEvents.active() &&
            playback?.contentInfo?.activitySessionId
        ) {
            const accepted = this.activity.record(playback, event);
            if (accepted && status === 'ended' && !player?.session()?.reconnect)
                this.activity.finish();
            return;
        }
        this.positionWriter.handleTimeUpdate(event);
        if (status !== 'playing') this.positionWriter.flush();
    }

    private flushPosition(): void {
        this.activity.begin(null);
        this.positionWriter.flush();
        this.positionWriter.reset();
        this.history.reset();
    }

    ngOnDestroy(): void {
        this.abort.abort();
        this.picker?.close();
        this.flushPosition();
    }
}
