import {
    ChangeDetectionStrategy,
    Component,
    ElementRef,
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
    SUBTITLE_COLOR_PRESETS,
    SUBTITLE_DELAY_STEP_SECONDS,
    SUBTITLE_SIZE_PRESETS,
    subtitleDelayLabel,
} from './subtitle-style';

export type PlayerSettingsPanelMode = 'panel' | 'sheet';

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
    imports: [MatButtonModule, MatIconModule, MatTooltipModule, TranslatePipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        class: 'player-settings',
        role: 'dialog',
        '[class.player-settings--sheet]': 'mode() === "sheet"',
        '[attr.aria-label]': 'title()',
    },
})
export class PlayerSettingsPanelComponent {
    private readonly host: HTMLElement =
        inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
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

    constructor() {
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

    isFocused(group: SettingsGroup): boolean {
        return this.focusGroup() === group;
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
