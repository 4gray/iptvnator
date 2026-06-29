import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';

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
    imports: [MatButton, MatIcon, TranslatePipe],
    template: `
        @let activePreset = preset();
        @if (activePreset) {
            <div class="epg-empty">
                <div class="epg-empty__icon" [class]="'tone-' + activePreset.tone">
                    <mat-icon>{{ activePreset.icon }}</mat-icon>
                </div>
                <div class="epg-empty__title">
                    {{ activePreset.titleKey | translate }}
                </div>
                <div class="epg-empty__sub">
                    {{ activePreset.subKey | translate }}
                </div>

                @switch (reason()) {
                    @case ('empty-day') {
                        <div class="epg-empty__actions">
                            <button
                                mat-flat-button
                                color="primary"
                                type="button"
                                (click)="jumpToday.emit()"
                            >
                                <mat-icon>my_location</mat-icon>
                                {{ 'EPG.TIMELINE.JUMP_TODAY' | translate }}
                            </button>
                            @if (hasOtherDays()) {
                                <button
                                    mat-stroked-button
                                    type="button"
                                    (click)="jumpNearest.emit()"
                                >
                                    {{ 'EPG.TIMELINE.JUMP_NEAREST' | translate }}
                                </button>
                            }
                        </div>
                    }
                    @case ('m3u-needs-setup') {
                        <div class="epg-empty__actions">
                            <button
                                mat-flat-button
                                color="primary"
                                type="button"
                                (click)="openSettings.emit()"
                            >
                                <mat-icon>settings</mat-icon>
                                {{ 'EPG.TIMELINE.OPEN_EPG_SETTINGS' | translate }}
                            </button>
                        </div>
                    }
                    @case ('error') {
                        <div class="epg-empty__actions">
                            <button
                                mat-flat-button
                                color="primary"
                                type="button"
                                (click)="retry.emit()"
                            >
                                <mat-icon>refresh</mat-icon>
                                {{ 'EPG.TIMELINE.RETRY' | translate }}
                            </button>
                        </div>
                    }
                }
            </div>
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
}
