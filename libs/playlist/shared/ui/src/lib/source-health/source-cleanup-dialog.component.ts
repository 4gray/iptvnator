import { Component, DestroyRef, computed, effect, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import {
    MAT_DIALOG_DATA,
    MatDialogModule,
    MatDialogRef,
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { TranslatePipe } from '@ngx-translate/core';
import {
    SourceCleanupContext,
    SourceCleanupService,
} from '@iptvnator/portal/shared/data-access';
import { PlaylistMeta, sourceHealthType } from '@iptvnator/shared/interfaces';

export interface SourceCleanupDialogData extends SourceCleanupContext {
    playlists: readonly PlaylistMeta[];
}
@Component({
    selector: 'app-source-cleanup-dialog',
    imports: [
        DatePipe,
        MatDialogModule,
        MatButtonModule,
        MatCheckboxModule,
        MatProgressBarModule,
        TranslatePipe,
    ],
    providers: [SourceCleanupService],
    template: ` <h2 mat-dialog-title>
            {{ 'SOURCE_CLEANUP.TITLE' | translate }}
        </h2>
        <mat-dialog-content>
            <p>{{ 'SOURCE_CLEANUP.SCOPE' | translate }}</p>
            <p>{{ 'SOURCE_CLEANUP.CONSEQUENCES' | translate }}</p>
            @if (model.phase() === 'checking' || model.phase() === 'deleting') {
                <mat-progress-bar mode="determinate" [value]="progress()" />
            }
            <p role="status" aria-live="polite">
                {{ 'SOURCE_CLEANUP.SUMMARY' | translate: summary() }}
            </p>
            @if (locked()) {
                <p role="status">
                    {{
                        'SOURCE_CLEANUP.DELETE_PROGRESS'
                            | translate
                                : {
                                      done: model.processed(),
                                      total: model.totalSelected(),
                                  }
                    }}
                </p>
            }
            @if (!locked()) {
                <div class="selection-actions">
                    <button
                        mat-button
                        [disabled]="checking()"
                        (click)="model.selectAll(true)"
                    >
                        {{ 'SOURCE_CLEANUP.SELECT_ALL' | translate }}
                    </button>
                    <button
                        mat-button
                        [disabled]="checking()"
                        (click)="model.selectAll(false)"
                    >
                        {{ 'SOURCE_CLEANUP.SELECT_NONE' | translate }}
                    </button>
                </div>
            }
            @for (group of groups(); track group.key) {
                @if (group.entries.length) {
                    <h3>
                        {{ 'SOURCE_CLEANUP.GROUP.' + group.key | translate }}
                    </h3>
                    @for (entry of group.entries; track entry.playlist._id) {
                        <div
                            class="source-row"
                            [attr.data-source-id]="entry.playlist._id"
                            [attr.data-status]="entry.status"
                        >
                            <mat-checkbox
                                [checked]="entry.selected"
                                [disabled]="
                                    locked() ||
                                    !model.candidate(entry) ||
                                    data.protected(entry.playlist._id)
                                "
                                (change)="
                                    model.select(
                                        entry.playlist._id,
                                        $event.checked
                                    )
                                "
                            >
                                <span class="source-title">{{
                                    entry.playlist.title ||
                                        entry.playlist.filename ||
                                        ('SOURCE_CLEANUP.UNTITLED' | translate)
                                }}</span>
                            </mat-checkbox>
                            <div class="source-meta">
                                <span>{{ type(entry.playlist) }}</span>
                                @if (entry.status === 'ready') {
                                    <span>{{
                                        'SOURCE_HEALTH.REASON.' +
                                            entry.health?.reason | translate
                                    }}</span>
                                } @else {
                                    <span>{{
                                        'SOURCE_CLEANUP.STATUS.' + entry.status
                                            | translate
                                    }}</span>
                                }
                                @if (entry.health?.checkedAt) {
                                    <time>{{
                                        entry.health?.checkedAt
                                            | date: 'shortTime'
                                    }}</time>
                                }
                                @if (entry.warning) {
                                    <span>{{
                                        'SOURCE_CLEANUP.CLEANUP_WARNING'
                                            | translate
                                    }}</span>
                                }
                            </div>
                            @if (
                                !locked() &&
                                entry.status !== 'deleted' &&
                                entry.status !== 'skipped'
                            ) {
                                <button
                                    mat-button
                                    (click)="model.recheck(entry)"
                                >
                                    {{ 'SOURCE_HEALTH.RECHECK' | translate }}
                                </button>
                            }
                        </div>
                    }
                }
            }
        </mat-dialog-content>
        <mat-dialog-actions align="end">
            @if (locked()) {
                <button
                    mat-button
                    [disabled]="model.stopRequested()"
                    (click)="model.stop()"
                >
                    {{ 'SOURCE_CLEANUP.STOP' | translate }}
                </button>
            } @else {
                <button mat-button mat-dialog-close>
                    {{ 'SOURCE_CLEANUP.CLOSE' | translate }}
                </button>
                <button
                    mat-flat-button
                    [disabled]="!selectedCount() || checking()"
                    (click)="model.removeSelected()"
                >
                    {{
                        'SOURCE_CLEANUP.DELETE'
                            | translate: { count: selectedCount() }
                    }}
                </button>
            }
        </mat-dialog-actions>`,
    styles: [
        `
            :host {
                display: block;
            }
            mat-dialog-content {
                min-width: 0;
            }
            .selection-actions {
                display: flex;
                flex-wrap: wrap;
            }
            h3 {
                font-size: 14px;
                margin: 18px 0 6px;
            }
            .source-row {
                display: grid;
                grid-template-columns: minmax(0, 1fr) auto;
                padding: 8px 0;
                border-bottom: 1px solid var(--mat-sys-outline-variant);
            }
            .source-title {
                overflow-wrap: anywhere;
            }
            .source-meta {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                margin-left: 40px;
                font-size: 12px;
                color: var(--mat-sys-on-surface-variant);
            }
            .source-row > button {
                grid-column: 2;
                grid-row: 1 / span 2;
                align-self: center;
            }
            .source-meta {
                grid-column: 1;
            }
        `,
    ],
})
export class SourceCleanupDialogComponent {
    readonly data = inject<SourceCleanupDialogData>(MAT_DIALOG_DATA);
    readonly model = inject(SourceCleanupService);
    private readonly ref = inject(MatDialogRef<SourceCleanupDialogComponent>);
    readonly type = sourceHealthType;
    readonly locked = computed(() => this.model.phase() === 'deleting');
    readonly checking = computed(() =>
        this.model.entries().some((e) => e.status === 'checking')
    );
    readonly selectedCount = computed(
        () =>
            this.model
                .entries()
                .filter(
                    (e) =>
                        e.selected &&
                        this.model.candidate(e) &&
                        !this.data.protected(e.playlist._id)
                ).length
    );
    readonly summary = computed(() => {
        const entries = this.model.entries();
        return {
            total: entries.length,
            checked: entries.filter((e) => e.status !== 'checking').length,
            available: entries.filter((e) => e.health?.state === 'active')
                .length,
            deleted: entries.filter((e) => e.status === 'deleted').length,
            skipped: entries.filter((e) => e.status === 'skipped').length,
            failed: entries.filter((e) => e.status === 'failed').length,
        };
    });
    readonly progress = computed(() =>
        this.locked()
            ? (100 * this.model.processed()) /
              Math.max(1, this.model.totalSelected())
            : (100 * this.summary().checked) / Math.max(1, this.summary().total)
    );
    readonly groups = computed(() => {
        const entries = this.model.entries();
        return [
            {
                key: 'confirmed',
                entries: entries.filter(
                    (e) => e.status === 'ready' && e.health?.confirmedInactive
                ),
            },
            {
                key: 'uncertain',
                entries: entries.filter(
                    (e) =>
                        e.status === 'checking' ||
                        (e.status === 'ready' &&
                            !e.health?.confirmedInactive &&
                            e.health?.state !== 'active')
                ),
            },
            {
                key: 'skipped',
                entries: entries.filter((e) => e.status === 'skipped'),
            },
            {
                key: 'results',
                entries: entries.filter((e) =>
                    ['deleting', 'deleted', 'failed'].includes(e.status)
                ),
            },
        ];
    });
    constructor() {
        effect(() => {
            this.ref.disableClose = this.locked();
        });
        inject(DestroyRef).onDestroy(() => this.model.dispose());
        void this.model.start(this.data.playlists, this.data);
    }
}
