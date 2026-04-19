import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBar } from '@angular/material/progress-bar';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import {
    EpgImportProgress,
    EpgProgressService,
} from '@iptvnator/epg/data-access';

@Component({
    selector: 'app-epg-progress-panel',
    standalone: true,
    imports: [
        MatButtonModule,
        MatIconModule,
        MatTooltip,
        MatProgressBar,
        TranslatePipe,
    ],
    templateUrl: './epg-progress-panel.component.html',
    styleUrl: './epg-progress-panel.component.scss',
})
export class EpgProgressPanelComponent {
    private readonly epgProgress = inject(EpgProgressService);

    readonly imports = this.epgProgress.imports;
    readonly isVisible = this.epgProgress.isVisible;
    readonly queuedCount = this.epgProgress.queuedCount;
    readonly activeCount = this.epgProgress.activeCount;
    readonly minimized = signal(false);

    readonly loadingCount = computed(
        () => this.imports().filter((i) => i.status === 'loading').length
    );

    toggleMinimize(): void {
        this.minimized.update((v) => !v);
    }

    get activeImports() {
        return this.imports().filter((item) => item.status !== 'queued');
    }

    get queuedImports() {
        return this.imports()
            .filter((item) => item.status === 'queued')
            .sort(
                (a, b) => (a.queuePosition ?? 0) - (b.queuePosition ?? 0)
            );
    }

    getStatusIcon(status: EpgImportProgress['status']): string {
        switch (status) {
            case 'queued':
                return 'schedule';
            case 'loading':
                return 'sync';
            case 'complete':
                return 'check_circle';
            case 'error':
                return 'error';
        }
    }

    getStatusClass(status: EpgImportProgress['status']): string {
        return `status-${status}`;
    }

    getDisplayUrl(url: string): string {
        try {
            const urlObject = new URL(url);
            return urlObject.hostname + urlObject.pathname.split('/').pop();
        } catch {
            return url.length > 40 ? `${url.substring(0, 40)}...` : url;
        }
    }

    dismiss(url: string): void {
        this.epgProgress.dismiss(url);
    }

    dismissAll(): void {
        this.epgProgress.dismissAll();
    }

    retry(url: string): void {
        this.epgProgress.retry(url);
    }
}
