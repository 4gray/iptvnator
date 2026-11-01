import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import {
    ChangeDetectionStrategy,
    Component,
    EnvironmentInjector,
    inject,
    signal,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { SettingsSyncStatusComponent } from './settings-sync-status.component';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { TranslateModule } from '@ngx-translate/core';
import { activityConsentKey } from '../services/activity-consent';
import { loadActivityRuntime } from '../services/activity-sync.providers';
import {
    activityAddressKey,
    type ActivityAddress,
} from '@iptvnator/shared/interfaces/activity-sync';
import type { ActivitySyncRuntime } from '../services/activity-sync-runtime';

@Component({
    selector: 'app-settings-activity-section',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        SettingsSyncStatusComponent,
        MatIconModule,
        MatButtonModule,
        MatCheckboxModule,
        TranslateModule,
    ],
    templateUrl: './settings-activity-section.component.html',
    styleUrl: './settings-activity-section.component.scss',
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
        this.failed.set(false);
        try {
            await activity.setEnabled(change.checked);
        } catch {
            this.failed.set(true);
        } finally {
            change.source.checked = activity.enabled();
        }
    }
    async previewImport(): Promise<void> {
        if (this.busy()) return;
        this.busy.set(true);
        this.failed.set(false);
        try {
            this.preview.set(await this.runtime()!.previewImport());
        } catch {
            this.failed.set(true);
        } finally {
            this.busy.set(false);
        }
    }
    async importPositions(): Promise<void> {
        if (this.busy()) return;
        this.busy.set(true);
        this.failed.set(false);
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

    async refresh(): Promise<void> {
        await this.runAction(() => this.runtime()!.refresh());
    }
    async resolve(address: ActivityAddress, local: boolean): Promise<void> {
        await this.runAction(() => this.runtime()!.resolve(address, local));
    }
    async parked(send: boolean): Promise<void> {
        await this.runAction(() => this.runtime()!.parked(send));
    }
    private async runAction(action: () => Promise<unknown>): Promise<void> {
        if (this.busy() || !this.runtime() || this.runtime()!.busy()) return;
        this.busy.set(true);
        this.failed.set(false);
        try {
            await action();
        } catch {
            this.failed.set(true);
        } finally {
            this.busy.set(false);
        }
    }
}
