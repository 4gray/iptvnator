import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBar } from '@angular/material/progress-bar';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import {
    EpgImportProgress,
    EpgProgressService,
} from '../../services/epg-progress.service';

@Component({
    selector: 'app-epg-progress-panel',
    standalone: true,
    imports: [
        CommonModule,
        MatButtonModule,
        MatIconModule,
        MatTooltip,
        MatProgressBar,
        TranslateModule,
    ],
    templateUrl: './epg-progress-panel.component.html',
    styleUrl: './epg-progress-panel.component.scss',
})
export class EpgProgressPanelComponent {
    private epgProgress = inject(EpgProgressService);

    readonly imports = this.epgProgress.imports;
    readonly isVisible = this.epgProgress.isVisible;
    readonly queuedCount = this.epgProgress.queuedCount;
    readonly activeCount = this.epgProgress.activeCount;

    /** Active and completed imports (not queued) */
    get activeImports() {
        return this.imports().filter((i) => i.status !== 'queued');
    }

    /** Queued imports waiting to be processed */
    get queuedImports() {
        return this.imports()
            .filter((i) => i.status === 'queued')
            .sort((a, b) => (a.queuePosition ?? 0) - (b.queuePosition ?? 0));
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
            const urlObj = new URL(url);
            return urlObj.hostname + urlObj.pathname.split('/').pop();
        } catch {
            return url.length > 40 ? url.substring(0, 40) + '...' : url;
        }
    }

    dismiss(url: string): void {
        this.epgProgress.dismiss(url);
    }

    dismissAll(): void {
        this.epgProgress.dismissAll();
    }
}
