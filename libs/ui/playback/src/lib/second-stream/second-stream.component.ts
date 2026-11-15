import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    ElementRef,
    inject,
    input,
    OnDestroy,
    output,
    signal,
    untracked,
    viewChildren,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import type { SecondStreamSelection } from '@iptvnator/portal/shared/data-access';
import type {
    RecordingStoppedEvent,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { EmbeddedMpvPlayerComponent } from '../embedded-mpv-player/embedded-mpv-player.component';
import type { PlayerTimeUpdate } from '../playback-history/player-time-update';
import {
    blurFocusedControl,
    clickPointerOrigin,
} from '../player-controls/pointer-focus-release';
import { SecondStreamAudio } from './second-stream-audio';
import { SecondStreamFloatingDirective } from './second-stream-floating.directive';
import { SecondStreamFocus } from './second-stream-focus';
import type {
    CompanionSlot,
    MultiviewLayout,
    MultiviewSlot,
    SecondStreamOpenStream,
} from './second-stream-open-stream';
import { SecondStreamPickerRequest } from './second-stream-picker-request';
import { SecondStreamPosition } from './second-stream-position';
import { samePositionKey } from './second-stream-slot-progress';
import { SecondStreamSlots } from './second-stream-slots';

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
    readonly primary = input<EmbeddedMpvPlayerComponent | null>(null);
    readonly fullscreenTarget = input<HTMLElement | null>(null);
    readonly recordingStopped = output<RecordingStoppedEvent>();
    private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
    readonly companionPlayers =
        viewChildren<EmbeddedMpvPlayerComponent>('companionPlayer');
    private readonly abort = new AbortController();
    private readonly picker = new SecondStreamPickerRequest();
    private readonly slots = new SecondStreamSlots(
        (batch) => this.audio.retire(batch),
        (batch) => {
            const focused = this.focusSlot();
            if (focused && focused !== 1 && batch.has(focused))
                this.focusSlot.set(1);
            if (this.mode() !== 'grid' && !this.active()) this.resetLayout();
        }
    );
    readonly companionSlots = this.slots.numbers;
    private readonly mode = signal<MultiviewLayout>('single');
    private readonly focusSlot = signal<MultiviewSlot | null>(null);
    private readonly audio = new SecondStreamAudio(
        (slot) => this.playerAt(slot),
        (slot) =>
            this.isSelectable(slot) &&
            (slot === 1 ||
                this.playerAt(slot)?.playback() ===
                    this.selectionAt(slot)?.playback),
        () => !this.abort.signal.aborted && this.available()
    );
    readonly layout = computed<MultiviewLayout>(() => {
        const mode = this.mode();
        if (mode === 'grid') return 'grid';
        if (!this.active()) return 'single';
        return mode === 'side-by-side' ? mode : 'pip';
    });
    readonly available = computed(
        () => this.primary()?.support()?.engine === 'frame-copy'
    );
    readonly active = computed(
        () => this.available() && this.slots.playable().length > 0
    );
    readonly stripVisible = computed(
        () => this.available() && this.layout() !== 'single'
    );
    readonly pairedSlot = computed(() =>
        this.slots.playable().length === 1
            ? this.slots.playable()[0]
            : undefined
    );
    readonly sideBySide = computed(() => this.layout() === 'side-by-side');
    readonly audioSlot = this.audio.slot.asReadonly();
    readonly audibleVolume = this.audio.volume.asReadonly();
    readonly audioController = computed(() =>
        this.busy() ? undefined : this.playerAt(this.audioSlot())?.controller
    );
    readonly controlsSlot = computed(() => {
        if (this.layout() === 'single') return 1;
        const slot =
            this.layout() === 'pip'
                ? this.audioSlot()
                : (this.focusSlot() ?? 1);
        return this.isSelectable(slot) ? slot : 1;
    });
    readonly swapped = computed(
        () =>
            this.layout() === 'pip' &&
            this.audioSlot() !== 1 &&
            this.isSelectable(this.audioSlot())
    );
    readonly openStreams = computed<SecondStreamOpenStream[]>(() => {
        const slots: MultiviewSlot[] = [1, ...this.slots.playable()];
        if (this.swapped()) slots.reverse();
        const streams: SecondStreamOpenStream[] = [];
        for (const slot of slots) {
            const playback =
                slot === 1
                    ? this.primary()?.playback()
                    : this.selectionAt(slot)?.playback;
            if (playback)
                streams.push({
                    slot,
                    playback,
                    small: this.layout() === 'pip' && slot !== this.audioSlot(),
                    muted:
                        slot !== this.audioSlot() || this.audibleVolume() === 0,
                });
        }
        return streams;
    });
    readonly busy = computed(() => this.audio.busy() || this.slots.busy());
    readonly editing = this.picker.editing.asReadonly();
    readonly error = this.audio.error.asReadonly();
    readonly small = computed(() => {
        const slot = this.smallSlot();
        return slot ? this.playerAt(slot) : undefined;
    });
    readonly ready = computed(() => {
        const slot = this.smallSlot();
        return slot !== undefined && this.canSelectSound(slot);
    });
    readonly focus = new SecondStreamFocus(
        () => this.fullscreenTarget() ?? this.element.nativeElement
    );
    readonly placement = new SecondStreamPosition();
    readonly resizeCorners = ['left', 'right'] as const;

    constructor() {
        effect((cleanup) => {
            const stage = this.fullscreenTarget();
            if (stage) cleanup(untracked(() => this.placement.observe(stage)));
        });
        effect(() => {
            if (!this.busy()) this.audio.observeVolume();
        });
    }

    selectionAt(slot: CompanionSlot): SecondStreamSelection | null {
        return this.slots.at(slot)?.selection ?? null;
    }

    isWithheld(slot: CompanionSlot): boolean {
        return this.slots.isWithheld(slot);
    }

    firstEmptySlot(): CompanionSlot | undefined {
        return this.companionSlots.find((slot) => !this.selectionAt(slot));
    }

    private playerAt(
        slot: MultiviewSlot
    ): EmbeddedMpvPlayerComponent | undefined {
        return slot === 1
            ? (this.primary() ?? undefined)
            : this.companionPlayers().find(
                  (player) => player.multiviewSlot() === slot
              );
    }

    private isSelectable(slot: MultiviewSlot): boolean {
        return (
            slot === 1 ||
            Boolean(
                this.selectionAt(slot) &&
                !this.isWithheld(slot) &&
                !this.slots.isClosing(slot)
            )
        );
    }

    private smallSlot(): MultiviewSlot | undefined {
        return this.swapped() ? 1 : this.pairedSlot();
    }

    setLayout(mode: MultiviewLayout): void {
        if (!this.available() || this.busy()) return;
        if (mode === 'single') {
            void this.close();
            return;
        }
        if (mode !== 'grid' && !this.pairedSlot()) return;
        if (this.focusSlot() === null) this.focusSlot.set(this.controlsSlot());
        this.mode.set(mode);
    }

    selectControls(slot: MultiviewSlot): void {
        if (
            !this.busy() &&
            this.isSelectable(slot) &&
            (this.sideBySide() || this.layout() === 'grid')
        )
            this.focusSlot.set(slot);
    }

    selectControlsFromKey(event: KeyboardEvent): void {
        if (
            this.layout() !== 'grid' ||
            this.busy() ||
            !this.primary()?.sharedShortcutsEnabled()
        )
            return;
        const slot = this.focus.slotFromKey(event);
        if (slot !== null && this.isSelectable(slot)) {
            event.preventDefault();
            this.selectControls(slot);
        }
    }

    canSelectSound(slot: MultiviewSlot): boolean {
        const current = this.audioSlot();
        return (
            this.available() &&
            !this.busy() &&
            !this.editing() &&
            this.isSelectable(slot) &&
            this.isSelectable(current) &&
            Boolean(
                this.playerAt(current)?.controller.sessionId() &&
                this.playerAt(slot)?.controller.sessionId()
            )
        );
    }

    selectSound(slot: MultiviewSlot): Promise<boolean> {
        return this.canSelectSound(slot)
            ? this.audio.move(slot)
            : Promise.resolve(false);
    }

    swap(): Promise<boolean> {
        const slot = this.smallSlot();
        return slot ? this.selectSound(slot) : Promise.resolve(false);
    }

    pauseSmall(): void {
        if (!this.busy()) void this.small()?.controller.togglePaused();
    }

    onStripClick(event: MouseEvent): void {
        const strip = event.currentTarget;
        if (!(strip instanceof HTMLElement) || !clickPointerOrigin(event))
            return;
        const keepGridShortcuts =
            this.layout() === 'grid' &&
            strip.ownerDocument.activeElement?.matches('button[aria-pressed]');
        if (blurFocusedControl(strip) && keepGridShortcuts)
            strip
                .closest<HTMLElement>('[data-multiview-stage]')
                ?.focus({ preventScroll: true });
    }

    openPicker(
        slot = this.firstEmptySlot(),
        replace = false
    ): Promise<CompanionSlot | null> {
        if (!slot || this.busy() || !this.available())
            return Promise.resolve(null);
        const previous = this.selectionAt(slot);
        if (Boolean(previous) !== replace || this.isWithheld(slot))
            return Promise.resolve(null);
        const primary = this.primary();
        if (!primary) return Promise.resolve(null);
        const playback = primary.playback();
        return this.picker.open({
            slot,
            replace,
            returningToOriginal:
                replace && this.swapped() && this.audioSlot() === slot,
            current: () =>
                !this.abort.signal.aborted &&
                this.available() &&
                this.primary() === primary &&
                primary.playback() === playback &&
                !this.slots.isClosing(slot) &&
                this.selectionAt(slot) === previous &&
                !this.isWithheld(slot),
            findDuplicateSlot: (selection) =>
                this.findDuplicateSlot(slot, selection.playback),
            accept: async (selection, allowed) => {
                if (
                    this.audioSlot() === slot &&
                    !(await this.audio.move(1, allowed))
                ) {
                    if (allowed()) this.audio.error.set(true);
                    return false;
                }
                if (!allowed()) return false;
                this.acceptSelection(slot, selection);
                return true;
            },
        });
    }

    private findDuplicateSlot(
        slot: CompanionSlot,
        playback: ResolvedPortalPlayback
    ): MultiviewSlot | undefined {
        if (samePositionKey(this.primary()?.playback(), playback)) return 1;
        return this.companionSlots.find(
            (other) =>
                other !== slot &&
                samePositionKey(this.selectionAt(other)?.playback, playback)
        );
    }

    private acceptSelection(
        slot: CompanionSlot,
        selection: SecondStreamSelection
    ): void {
        const controls = this.controlsSlot();
        this.slots.accept(slot, selection);
        if (this.slots.playable().length > 1) {
            if (this.focusSlot() === null) this.focusSlot.set(controls);
            this.mode.set('grid');
        }
        this.audio.error.set(false);
    }

    async close(slot?: CompanionSlot): Promise<void> {
        this.picker.cancel();
        await this.slots.retire(
            slot === undefined ? this.companionSlots : [slot]
        );
        if (slot === undefined && !this.abort.signal.aborted)
            this.resetLayout();
    }

    private resetLayout(): void {
        this.mode.set('single');
        this.focusSlot.set(null);
    }

    savePosition(
        slot: CompanionSlot,
        playback: ResolvedPortalPlayback,
        player: EmbeddedMpvPlayerComponent,
        event: PlayerTimeUpdate
    ): void {
        const entry = this.slots.at(slot);
        const session = player.session();
        if (
            !this.abort.signal.aborted &&
            !this.isWithheld(slot) &&
            entry?.selection.playback === playback &&
            player.playback() === playback &&
            this.playerAt(slot) === player &&
            session &&
            session.id === player.controller.sessionId()
        ) {
            entry.record(session, event);
        }
    }

    ngOnDestroy(): void {
        this.abort.abort();
        this.picker.cancel();
        this.slots.destroy();
    }
}
