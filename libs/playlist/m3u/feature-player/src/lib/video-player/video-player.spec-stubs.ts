import { Component, input, output } from '@angular/core';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import { LiveEpgPanelSummary } from '@iptvnator/ui/shared-portals';

/**
 * Stand-in for the live EPG panel. Matches both selectors so the host's
 * timeline ↔ list swap can be asserted by tag name; both branches share the
 * identical input/output contract, which this stub has to mirror — an input
 * missing here fails the host template with NG0303 at compile time.
 */
@Component({
    selector: 'app-epg-timeline, app-epg-list-view',
    standalone: true,
    template: '',
})
export class StubEpgTimelineComponent {
    readonly programs = input<EpgProgram[]>([]);
    readonly offsetMinutes = input(0);
    readonly channelName = input('');
    readonly channelLogo = input('');
    readonly archivePlaybackAvailable = input(false);
    readonly archiveDays = input(0);
    readonly activeProgram = input<EpgProgram | null>(null);
    readonly isLivePlayback = input(true);
    readonly loading = input(false);
    readonly emptyReason = input<string | null>(null);
    readonly selectedDate = input<string | null>(null);
    readonly collapsed = input(false);
    readonly summary = input<LiveEpgPanelSummary | null>(null);
    readonly summaryLabelKey = input('');
    readonly guideAvailable = input(false);
    readonly programActivated = output<{
        program?: EpgProgram;
        type: 'timeshift' | 'live';
    }>();
    readonly returnToLive = output<void>();
    readonly selectedDateChange = output<string>();
    readonly openEpgSettings = output<void>();
    readonly retry = output<void>();
    readonly collapsedChange = output<boolean>();
    readonly openGuide = output<void>();
}
