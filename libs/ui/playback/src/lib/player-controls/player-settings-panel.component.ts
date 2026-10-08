import {
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    OnDestroy,
    afterNextRender,
    computed,
    effect,
    inject,
    input,
    output,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import type { ControlsMenuSelection } from './controls-menu-selection';
import type { ControlsSettings } from './controls-settings';
import type { SettingsGroup } from './controls-settings-groups';
import type { ControlsSubtitleSettings } from './controls-subtitle-settings';
import type { PlayerController } from './player-controls.model';
import {
    SettingsRadioDirective,
    SettingsRadioGroupDirective,
} from './settings-radio-group.directive';
import {
    SUBTITLE_COLOR_PRESETS,
    SUBTITLE_DELAY_STEP_SECONDS,
    SUBTITLE_SIZE_PRESETS,
    subtitleDelayLabel,
} from './subtitle-style';

export type PlayerSettingsPanelMode = 'panel' | 'sheet';

let nextPanelId = 0;

/**
 * The settings surface behind the dock's `tune` button: audio, subtitles
 * (tracks, file loading, delay, size and color), quality, speed and aspect
 * ratio in one place. Wide players show it as a right-hand panel beside the
 * video, compact players as a bottom sheet. It only renders state and
 * forwards choices to the collaborators the controls component owns.
 */
@Component({
    selector: 'app-player-settings-panel',
    templateUrl: './player-settings-panel.component.html',
    styleUrl: './player-settings-panel.component.scss',
    imports: [
        MatButtonModule,
        MatIconModule,
        MatTooltipModule,
        SettingsRadioDirective,
        SettingsRadioGroupDirective,
        TranslatePipe,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        class: 'player-settings',
        role: 'dialog',
        tabindex: '-1',
        '[class.player-settings--sheet]': 'mode() === "sheet"',
        '[attr.aria-labelledby]': 'headingId("title")',
        '(focusin)': 'focusInside = true',
        '(focusout)': 'onFocusOut($event)',
    },
})
export class PlayerSettingsPanelComponent implements OnDestroy {
    private readonly host: HTMLElement =
        inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    /** Several players can be mounted at once: heading ids stay unique. */
    private readonly idPrefix = `player-settings-${nextPanelId++}`;
    readonly controller = input.required<PlayerController>();
    readonly settings = input.required<ControlsSettings>();
    readonly selection = input.required<ControlsMenuSelection>();
    readonly subtitleSettings = input.required<ControlsSubtitleSettings>();
    readonly mode = input<PlayerSettingsPanelMode>('panel');
    readonly title = input('');
    readonly closeRequested = output<void>();

    readonly state = computed(() => this.controller().state());
    readonly capabilities = computed(() => this.controller().capabilities());
    readonly groups = computed(() => this.settings().groups());
    readonly focusGroup = computed(() => this.settings().focusGroup());
    readonly defaultAspect = computed(() => this.settings().defaultAspect());

    readonly subtitleSizePresets = SUBTITLE_SIZE_PRESETS;
    readonly subtitleColorPresets = SUBTITLE_COLOR_PRESETS;
    readonly subtitleDelayStep = SUBTITLE_DELAY_STEP_SECONDS;
    readonly subtitleDelayLabel = subtitleDelayLabel;

    /** The control that opened the panel, and whether the keyboard did. */
    private readonly opener = document.activeElement;
    private readonly openedByKeyboard =
        this.opener instanceof HTMLElement &&
        this.opener !== document.body &&
        !!this.opener.closest('.player-controls-host') &&
        matchesFocusVisible(this.opener);
    focusInside = false;
    /** Recorded after render: on destroy the panel is already detached. */
    private controlsHost: Element | null = null;

    constructor() {
        // Keyboard users land inside the dialog; a pointer open leaves focus
        // alone (a focused control would capture Space from the shortcuts).
        afterNextRender(() => {
            this.controlsHost = this.host.closest('.player-controls-host');
            if (this.openedByKeyboard) {
                this.host.focus({ preventScroll: true });
                this.focusInside = this.host.contains(document.activeElement);
            }
        });
        // A chip click opens the panel on its group: bring that group into
        // view so a long audio list cannot push the speed row off-screen.
        effect(() => {
            const group = this.focusGroup();
            if (!group) {
                return;
            }
            queueMicrotask(() => this.scrollGroupIntoView(group));
        });
    }

    onFocusOut(event: FocusEvent): void {
        const next = event.relatedTarget;
        this.focusInside = next instanceof Node && this.host.contains(next);
    }

    /**
     * Closing with focus inside (Escape, the close button by keyboard)
     * returns it to the `tune` button rather than dropping it on the page.
     * The chip that may have opened the panel is re-rendered on close, so
     * `tune` is the stable target. Tracked by flag, not `activeElement`:
     * the view's DOM is already detached when this hook runs.
     */
    ngOnDestroy(): void {
        if (!this.focusInside) {
            return;
        }
        const controls = this.controlsHost;
        queueMicrotask(() =>
            controls
                ?.querySelector<HTMLElement>('.player-controls__tune')
                ?.focus({ preventScroll: true })
        );
    }

    isFocused(group: SettingsGroup): boolean {
        return this.focusGroup() === group;
    }

    /** The id of a heading that names the dialog or one of its groups. */
    headingId(name: string): string {
        return `${this.idPrefix}-${name}`;
    }

    loadExternalSubtitle(): void {
        if (!this.capabilities().externalSubtitles) {
            return;
        }
        this.selection().externalSubtitle();
    }

    private scrollGroupIntoView(group: SettingsGroup): void {
        const element = this.host.querySelector(`[data-group="${group}"]`);
        if (
            element instanceof HTMLElement &&
            typeof element.scrollIntoView === 'function'
        ) {
            element.scrollIntoView({ block: 'nearest' });
        }
    }
}

function matchesFocusVisible(element: Element | null): boolean {
    try {
        return (
            element instanceof HTMLElement && element.matches(':focus-visible')
        );
    } catch {
        return false;
    }
}
