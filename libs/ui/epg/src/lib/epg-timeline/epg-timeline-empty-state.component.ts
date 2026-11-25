import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { StateViewComponent } from '@iptvnator/ui/state';

/**
 * Reasons the timeline ribbon has nothing to show. `none` means programmes are
 * present and the ribbon renders instead of this component.
 */
export type EpgTimelineEmptyReason =
    | 'none'
    | 'empty-day'
    | 'channel-unmapped'
    | 'provider-no-epg'
    | 'm3u-needs-setup'
    | 'error';

type EmptyTone = 'neutral' | 'action' | 'warn';

interface EmptyStatePreset {
    readonly icon: string;
    readonly tone: EmptyTone;
    readonly titleKey: string;
    readonly subKey: string;
}

const PRESETS: Record<
    Exclude<EpgTimelineEmptyReason, 'none'>,
    EmptyStatePreset
> = {
    'empty-day': {
        icon: 'event_busy',
        tone: 'neutral',
        titleKey: 'EPG.TIMELINE.EMPTY_DAY_TITLE',
        subKey: 'EPG.TIMELINE.EMPTY_DAY_DESCRIPTION',
    },
    'channel-unmapped': {
        icon: 'tv_off',
        tone: 'neutral',
        titleKey: 'EPG.TIMELINE.CHANNEL_UNMAPPED_TITLE',
        subKey: 'EPG.TIMELINE.CHANNEL_UNMAPPED_DESCRIPTION',
    },
    'provider-no-epg': {
        icon: 'cell_tower',
        tone: 'neutral',
        titleKey: 'EPG.TIMELINE.PROVIDER_NO_EPG_TITLE',
        subKey: 'EPG.TIMELINE.PROVIDER_NO_EPG_DESCRIPTION',
    },
    'm3u-needs-setup': {
        icon: 'cable',
        tone: 'action',
        titleKey: 'EPG.TIMELINE.M3U_SETUP_TITLE',
        subKey: 'EPG.TIMELINE.M3U_SETUP_DESCRIPTION',
    },
    error: {
        icon: 'error_outline',
        tone: 'warn',
        titleKey: 'EPG.TIMELINE.ERROR_TITLE',
        subKey: 'EPG.TIMELINE.ERROR_DESCRIPTION',
    },
};

@Component({
    selector: 'app-epg-timeline-empty-state',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [StateViewComponent, TranslatePipe],
    template: `
        @let activePreset = preset();
        @if (activePreset) {
            <app-state-view
                size="panel"
                [variant]="activePreset.tone === 'warn' ? 'error' : 'empty'"
                [icon]="activePreset.icon"
                [heading]="activePreset.titleKey | translate"
                [description]="activePreset.subKey | translate"
                [retryable]="reason() === 'error'"
                [actionLabel]="actionLabelKey() | translate"
                [actionIcon]="actionIcon()"
                [secondaryLabel]="
                    reason() === 'empty-day' && hasOtherDays()
                        ? ('EPG.TIMELINE.JUMP_NEAREST' | translate)
                        : null
                "
                (retry)="retry.emit()"
                (action)="onAction()"
                (secondaryAction)="jumpNearest.emit()"
            />
        }
    `,
    styleUrl: './epg-timeline-empty-state.component.scss',
})
export class EpgTimelineEmptyStateComponent {
    readonly reason = input.required<EpgTimelineEmptyReason>();
    readonly hasOtherDays = input(false);

    readonly jumpToday = output<void>();
    readonly jumpNearest = output<void>();
    readonly openSettings = output<void>();
    readonly retry = output<void>();

    readonly preset = computed<EmptyStatePreset | null>(() => {
        const reason = this.reason();
        return reason === 'none' ? null : PRESETS[reason];
    });

    /** The reason's own action; an error leads with the state's Retry. */
    readonly actionLabelKey = computed(() => {
        switch (this.reason()) {
            case 'empty-day':
                return 'EPG.TIMELINE.JUMP_TODAY';
            case 'm3u-needs-setup':
                return 'EPG.TIMELINE.OPEN_EPG_SETTINGS';
            default:
                return '';
        }
    });
    readonly actionIcon = computed(() =>
        this.reason() === 'empty-day' ? 'my_location' : 'settings'
    );

    onAction(): void {
        if (this.reason() === 'empty-day') this.jumpToday.emit();
        else this.openSettings.emit();
    }
}
