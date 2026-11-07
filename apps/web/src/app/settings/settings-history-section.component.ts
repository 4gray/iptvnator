import {
    ChangeDetectionStrategy,
    Component,
    EnvironmentInjector,
    inject,
    signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { TranslateModule } from '@ngx-translate/core';
import { loadHistoryRuntime } from '../services/history-sync.providers';
import type {
    HistorySyncRuntime,
    HistoryPreview,
} from '../services/history-sync-runtime';
@Component({
    selector: 'app-settings-history-section',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [MatButtonModule, MatCheckboxModule, TranslateModule],
    templateUrl: './settings-history-section.component.html',
    styleUrl: './settings-favorites-section.component.scss',
})
export class SettingsHistorySectionComponent {
    readonly runtime = signal<HistorySyncRuntime | null>(null);
    readonly busy = signal(false);
    readonly failed = signal(false);
    readonly preview = signal<HistoryPreview | null>(null);
    readonly count = () =>
        this.preview()?.sources.reduce(
            (sum, source) => sum + source.items.length,
            0
        ) ?? 0;
    constructor() {
        void loadHistoryRuntime(inject(EnvironmentInjector))
            .then((runtime) => this.runtime.set(runtime))
            .catch(() => this.failed.set(true));
    }
    async toggle(change: { checked: boolean; source: { checked: boolean } }) {
        await this.action(() => this.runtime()!.setEnabled(change.checked));
        change.source.checked = this.runtime()?.enabled() ?? false;
        this.preview.set(null);
    }
    async previewImport() {
        await this.action(async () =>
            this.preview.set(await this.runtime()!.previewImport())
        );
    }
    async importHistory() {
        await this.action(async () => {
            await this.runtime()!.importHistory(this.preview()!);
            this.preview.set(null);
        });
    }
    async parked(send: boolean) {
        await this.action(() => this.runtime()!.parked(send));
    }
    async refresh() {
        await this.action(() => this.runtime()!.refresh());
    }
    private async action(run: () => Promise<unknown>) {
        if (this.busy() || !this.runtime()) return;
        this.busy.set(true);
        this.failed.set(false);
        try {
            await run();
        } catch {
            this.failed.set(true);
        } finally {
            this.busy.set(false);
        }
    }
}
