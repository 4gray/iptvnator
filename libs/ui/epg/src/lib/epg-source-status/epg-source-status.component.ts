import {
    Component,
    OnInit,
    computed,
    effect,
    inject,
    input,
    signal,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { EpgProgressService } from '@iptvnator/epg/data-access';
import { RuntimeCapabilitiesService } from '@iptvnator/services';

type BadgeStatus =
    | 'loading'
    | 'queued'
    | 'fresh'
    | 'stale'
    | 'error'
    | 'unknown';

@Component({
    selector: 'app-epg-source-status',
    standalone: true,
    imports: [
        MatIconModule,
        MatProgressSpinnerModule,
        MatTooltipModule,
        TranslatePipe,
    ],
    templateUrl: './epg-source-status.component.html',
    styleUrl: './epg-source-status.component.scss',
})
export class EpgSourceStatusComponent implements OnInit {
    readonly url = input.required<string>();

    private readonly epgProgress = inject(EpgProgressService);
    private readonly runtime = inject(RuntimeCapabilitiesService);

    private readonly freshnessLoaded = signal(false);
    private readonly isFresh = signal(false);

    readonly status = computed<BadgeStatus>(() => {
        const progress = this.epgProgress
            .imports()
            .find((item) => item.url === this.url());

        if (progress) {
            if (progress.status === 'loading') return 'loading';
            if (progress.status === 'queued') return 'queued';
            if (progress.status === 'error') return 'error';
            if (progress.status === 'complete') return 'fresh';
        }

        if (!this.freshnessLoaded()) return 'unknown';
        return this.isFresh() ? 'fresh' : 'stale';
    });

    readonly errorMessage = computed(() =>
        this.epgProgress
            .imports()
            .find((item) => item.url === this.url())?.error
    );

    constructor() {
        // Optimistically mark as fresh when a live fetch completes for our URL,
        // so the badge updates without waiting for another IPC round-trip.
        effect(() => {
            const progress = this.epgProgress
                .imports()
                .find((item) => item.url === this.url());
            if (progress?.status === 'complete') {
                this.freshnessLoaded.set(true);
                this.isFresh.set(true);
            }
        });
    }

    async ngOnInit(): Promise<void> {
        if (!this.runtime.supportsEpg) {
            return;
        }
        const url = this.url();
        if (!url) return;

        const result = await window.electron.checkEpgFreshness([url], 12);
        this.isFresh.set(result.freshUrls.includes(url));
        this.freshnessLoaded.set(true);
    }
}
