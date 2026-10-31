import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import {
    ChangeDetectionStrategy,
    Component,
    EnvironmentInjector,
    inject,
    signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { TranslateModule } from '@ngx-translate/core';
import { activityConsentKey } from '../services/activity-consent';
import { loadActivityRuntime } from '../services/activity-sync.providers';
import { activityAddressKey } from '@iptvnator/shared/interfaces/activity-sync';
import type { ActivitySyncRuntime } from '../services/activity-sync-runtime';

@Component({
    selector: 'app-settings-activity-section',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DatePipe, MatButtonModule, MatCheckboxModule, TranslateModule],
    template: `
        <section class="settings-group" data-test-id="activity-sync-settings">
            <header class="settings-group__header">
                <h2>{{ 'ACTIVITY_SYNC.TITLE' | translate }}</h2>
                <p>{{ 'ACTIVITY_SYNC.SHARED_HINT' | translate }}</p>
            </header>
            <div class="settings-card activity-fields">
                @if (runtime(); as activity) {
                    <mat-checkbox
                        [checked]="activity.enabled()"
                        [disabled]="activity.busy()"
                        (change)="setActivityEnabled($event)"
                        data-test-id="activity-sync-enabled"
                    >
                        {{ 'ACTIVITY_SYNC.ENABLE' | translate }}
                    </mat-checkbox>
                    <p>{{ 'ACTIVITY_SYNC.IMPORT_HINT' | translate }}</p>
                    <p>{{ 'ACTIVITY_SYNC.LOCAL_HINT' | translate }}</p>
                    <p role="status" data-test-id="activity-sync-state">
                        {{ activity.stateKey() | translate }}
                    </p>
                    @if (activity.lastSync(); as time) {
                        <p>
                            {{ 'SOURCE_SYNC.LAST_SYNC' | translate }}:
                            {{ time | date: 'short' }}
                        </p>
                    }
                    @if (activity.error() || failed()) {
                        <p role="alert">
                            {{ 'ACTIVITY_SYNC.ERROR' | translate }}
                        </p>
                    }
                    @if (activity.enabled()) {
                        <div class="activity-actions">
                            <button
                                mat-button
                                type="button"
                                (click)="activity.refresh()"
                            >
                                {{ 'SOURCE_SYNC.REFRESH' | translate }}
                            </button>
                            <button
                                mat-button
                                type="button"
                                (click)="previewImport()"
                                [disabled]="busy()"
                                data-test-id="activity-import-preview"
                            >
                                {{ 'ACTIVITY_SYNC.PREVIEW_IMPORT' | translate }}
                            </button>
                        </div>
                        @if (activity.pending()) {
                            <p>
                                {{
                                    'ACTIVITY_SYNC.PENDING'
                                        | translate
                                            : { count: activity.pending() }
                                }}
                            </p>
                            <div class="activity-actions">
                                <button
                                    mat-button
                                    type="button"
                                    (click)="activity.parked(true)"
                                >
                                    {{
                                        'ACTIVITY_SYNC.SEND_PENDING' | translate
                                    }}
                                </button>
                                <button
                                    mat-button
                                    type="button"
                                    (click)="activity.parked(false)"
                                >
                                    {{
                                        'ACTIVITY_SYNC.KEEP_PENDING_LOCAL'
                                            | translate
                                    }}
                                </button>
                            </div>
                        }
                        @for (
                            conflict of activity.conflicts();
                            track addressKey(conflict.address)
                        ) {
                            <div
                                class="activity-conflict"
                                data-test-id="activity-conflict"
                            >
                                <p>
                                    {{ 'ACTIVITY_SYNC.CONFLICT' | translate }} ·
                                    {{
                                        conflict.record.position
                                            ?.activityTitle ?? ''
                                    }}
                                    ·
                                    {{
                                        conflict.record.position?.seasonNumber
                                            ? 'S' +
                                              conflict.record.position
                                                  ?.seasonNumber +
                                              ' E' +
                                              conflict.record.position
                                                  ?.episodeNumber
                                            : ('ACTIVITY_SYNC.MOVIE'
                                              | translate)
                                    }}
                                    · {{ conflict.address.content.id }}
                                </p>
                                <p>
                                    {{
                                        'ACTIVITY_SYNC.LOCAL_POSITION'
                                            | translate
                                    }}:
                                    {{
                                        conflict.record.position
                                            ?.positionSeconds ?? 0
                                    }}
                                    s ·
                                    {{
                                        'ACTIVITY_SYNC.SERVER_POSITION'
                                            | translate
                                    }}:
                                    {{
                                        conflict.record.conflict?.resume
                                            ?.positionSeconds ?? 0
                                    }}
                                    s
                                </p>
                                <div class="activity-actions">
                                    <button
                                        mat-button
                                        type="button"
                                        (click)="
                                            activity.resolve(
                                                conflict.address,
                                                false
                                            )
                                        "
                                        data-test-id="activity-keep-server"
                                    >
                                        {{
                                            'ACTIVITY_SYNC.KEEP_SERVER'
                                                | translate
                                        }}
                                    </button>
                                    <button
                                        mat-button
                                        type="button"
                                        (click)="
                                            activity.resolve(
                                                conflict.address,
                                                true
                                            )
                                        "
                                        data-test-id="activity-use-local"
                                    >
                                        {{
                                            'ACTIVITY_SYNC.USE_LOCAL'
                                                | translate
                                        }}
                                    </button>
                                </div>
                            </div>
                        }
                        @if (preview(); as items) {
                            <p>
                                {{
                                    'ACTIVITY_SYNC.IMPORT_PREVIEW'
                                        | translate
                                            : {
                                                  count: count(),
                                                  sources: items.length,
                                              }
                                }}
                            </p>
                            <p>
                                {{
                                    'ACTIVITY_SYNC.IMPORT_CONFLICT_HINT'
                                        | translate
                                }}
                            </p>
                            <div class="activity-actions">
                                <button
                                    mat-button
                                    type="button"
                                    (click)="preview.set(null)"
                                >
                                    {{ 'CANCEL' | translate }}
                                </button>
                                <button
                                    mat-flat-button
                                    type="button"
                                    (click)="importPositions()"
                                    [disabled]="busy() || !count()"
                                    data-test-id="activity-import-confirm"
                                >
                                    {{ 'SETTINGS.IMPORT_DATA' | translate }}
                                </button>
                            </div>
                        }
                        @if (unresolved()) {
                            <p role="status">
                                {{
                                    'ACTIVITY_SYNC.UNRESOLVED'
                                        | translate: { count: unresolved() }
                                }}
                            </p>
                        }
                    }
                } @else if (failed()) {
                    <p role="alert">{{ 'ACTIVITY_SYNC.ERROR' | translate }}</p>
                }
            </div>
        </section>
    `,
    styles: [
        `
            :host {
                display: block;
            }
            .activity-fields {
                display: grid;
                gap: 12px;
                padding: 20px;
            }
            .activity-actions {
                display: flex;
                flex-wrap: wrap;
                gap: 12px;
            }
            .activity-conflict {
                display: grid;
                gap: 8px;
                padding: 12px;
                background: var(--app-hover-overlay);
            }
            button,
            mat-checkbox {
                app-region: no-drag;
            }
        `,
    ],
})
export class SettingsActivitySectionComponent {
    readonly addressKey = activityAddressKey;
    readonly runtime = signal<ActivitySyncRuntime | null>(null);
    readonly failed = signal(false);
    readonly busy = signal(false);
    readonly preview = signal<
        { sourceId: string; items: PlaybackPositionData[] }[] | null
    >(null);
    readonly unresolved = signal(0);
    readonly count = () =>
        this.preview()?.reduce(
            (count, source) => count + source.items.length,
            0
        ) ?? 0;
    constructor() {
        if (!activityConsentKey()) return;
        void loadActivityRuntime(inject(EnvironmentInjector))
            .then((service) => this.runtime.set(service))
            .catch(() => this.failed.set(true));
    }
    async setActivityEnabled(change: {
        checked: boolean;
        source: { checked: boolean };
    }): Promise<void> {
        const activity = this.runtime();
        if (!activity) return;
        try {
            await activity.setEnabled(change.checked);
        } catch {
            this.failed.set(true);
        } finally {
            change.source.checked = activity.enabled();
        }
    }
    async previewImport(): Promise<void> {
        this.busy.set(true);
        try {
            this.preview.set(await this.runtime()!.previewImport());
        } catch {
            this.failed.set(true);
        } finally {
            this.busy.set(false);
        }
    }
    async importPositions(): Promise<void> {
        this.busy.set(true);
        try {
            this.unresolved.set(
                await this.runtime()!.importPositions(this.preview() ?? [])
            );
            this.preview.set(null);
        } catch {
            this.failed.set(true);
        } finally {
            this.busy.set(false);
        }
    }
}
