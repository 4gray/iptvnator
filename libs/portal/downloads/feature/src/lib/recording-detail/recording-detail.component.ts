import { DatePipe } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { RecordingsService } from '@iptvnator/services';
import {
    DetailActionsTemplateDirective,
    DetailMetaTemplateDirective,
    DetailTagsTemplateDirective,
    PortalDetailShellComponent,
} from '@iptvnator/ui/components';
import { map } from 'rxjs';
import { formatDownloadBytes } from '../download-queue.component';
import type { RecordingItemActionType } from '../recording-actions';
import { RecordingManagerActionsService } from '../recording-manager-actions.service';
import { recordingDurationSeconds } from '../recording-manager.viewmodel';

/**
 * Focused detail for one live-TV recording
 * (`/workspace/downloads/recording/:recordingId`). Rendered on the shared
 * portal-detail-shell like the offline download details; the workspace shell
 * hides the context panel and route search for this route.
 */
@Component({
    selector: 'app-recording-detail',
    templateUrl: './recording-detail.component.html',
    styleUrls: [
        '../../../../../../ui/components/src/lib/styles/detail-view.scss',
        './recording-detail.component.scss',
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [RecordingManagerActionsService],
    imports: [
        DatePipe,
        DetailActionsTemplateDirective,
        DetailMetaTemplateDirective,
        DetailTagsTemplateDirective,
        MatButtonModule,
        MatIcon,
        MatMenuModule,
        PortalDetailShellComponent,
        TranslatePipe,
    ],
})
export class RecordingDetailComponent {
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly recordings = inject(RecordingsService);
    private readonly actions = inject(RecordingManagerActionsService);

    private readonly returnUrl: string | null =
        (this.router.getCurrentNavigation()?.extras.state?.[
            'returnUrl'
        ] as string) ?? null;

    readonly pendingIds = this.actions.pendingIds;
    readonly recordingId = toSignal(
        this.route.paramMap.pipe(
            map((params) => Number(params.get('recordingId')))
        ),
        { initialValue: Number(this.route.snapshot.params['recordingId']) }
    );
    readonly item = computed(
        () =>
            this.recordings
                .recordings()
                .find((row) => row.id === this.recordingId()) ?? null
    );
    readonly isMissing = computed(
        () => this.item()?.fileAvailability === 'missing'
    );
    readonly isFailed = computed(() => this.item()?.status === 'failed');
    readonly isActive = computed(() => this.item()?.status === 'recording');
    readonly title = computed(() => {
        const item = this.item();
        return item ? item.programTitle?.trim() || item.channelName : '';
    });
    readonly displayTitleNeedsTime = computed(
        () => !this.item()?.programTitle?.trim()
    );
    readonly durationSeconds = computed(() => {
        const item = this.item();
        return item ? recordingDurationSeconds(item) : null;
    });
    readonly durationLabel = computed(() => {
        const total = this.durationSeconds();
        if (total === null || total <= 0) {
            return '';
        }
        const hours = Math.floor(total / 3600);
        const minutes = Math.round((total % 3600) / 60);
        if (hours > 0) {
            return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
        }
        return `${Math.max(1, minutes)} min`;
    });
    readonly sizeLabel = computed(() => {
        const bytes = this.item()?.fileSizeBytes;
        return bytes ? formatDownloadBytes(bytes) : '';
    });
    /** ≥2 covered programs — the boundary-crossing case worth listing. */
    readonly coveredPrograms = computed(() => {
        const programs = this.item()?.programs ?? [];
        return programs.length >= 2 ? programs : [];
    });

    constructor() {
        void this.recordings.loadRecordings();
        // Row gone after an authoritative load (removed here, removed
        // elsewhere, or a bogus id) → return to the manager.
        effect(() => {
            if (
                this.recordings.hasLoadedRecordings() &&
                this.recordings.hasAuthoritativeRecordingList() &&
                !this.recordings.isLoadingRecordings() &&
                this.item() === null
            ) {
                this.goBack();
            }
        });
    }

    goBack(): void {
        void this.router.navigateByUrl(
            this.returnUrl ?? '/workspace/downloads'
        );
    }

    runAction(type: RecordingItemActionType): void {
        const item = this.item();
        if (!item) {
            return;
        }
        void this.actions.run({ type, item });
    }

    isPending(): boolean {
        const item = this.item();
        return item !== null && this.pendingIds().has(item.id);
    }
}
