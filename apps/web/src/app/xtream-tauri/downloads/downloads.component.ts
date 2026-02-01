import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    OnInit,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import {
    DownloadItem,
    DownloadsService,
} from '../../services/downloads.service';

@Component({
    selector: 'app-downloads',
    templateUrl: './downloads.component.html',
    styleUrls: ['./downloads.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        MatButtonModule,
        MatIconModule,
        MatProgressBarModule,
        MatTooltipModule,
        TranslatePipe,
    ],
})
export class DownloadsComponent implements OnInit {
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    readonly downloadsService = inject(DownloadsService);

    readonly downloads = this.downloadsService.downloads;
    readonly downloadFolder = this.downloadsService.downloadFolder;
    readonly isAvailable = this.downloadsService.isAvailable;
    readonly hasDownloads = this.downloadsService.hasDownloads;
    readonly activeCount = this.downloadsService.activeCount;

    /** Filter downloads for current playlist and sort by newest first */
    readonly filteredDownloads = computed(() => {
        const playlistId = this.route.snapshot.params['id'];
        const downloads = playlistId
            ? this.downloads().filter((d) => d.playlistId === playlistId)
            : this.downloads();

        // Sort by createdAt descending (newest first)
        return [...downloads].sort((a, b) => {
            const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return dateB - dateA;
        });
    });

    ngOnInit() {
        const playlistId = this.route.snapshot.params['id'];
        this.downloadsService.loadDownloads(playlistId);
    }

    getProgress(item: DownloadItem): number {
        return this.downloadsService.getProgressPercent(item);
    }

    formatBytes(bytes: number | undefined): string {
        if (!bytes) return '0 B';
        return this.downloadsService.formatBytes(bytes);
    }

    getStatusIcon(status: string): string {
        switch (status) {
            case 'queued':
                return 'schedule';
            case 'downloading':
                return 'downloading';
            case 'completed':
                return 'check_circle';
            case 'failed':
                return 'error';
            case 'canceled':
                return 'cancel';
            default:
                return 'help';
        }
    }

    getStatusColor(status: string): string {
        switch (status) {
            case 'queued':
                return 'status-queued';
            case 'downloading':
                return 'status-downloading';
            case 'completed':
                return 'status-completed';
            case 'failed':
            case 'canceled':
                return 'status-failed';
            default:
                return '';
        }
    }

    async cancel(item: DownloadItem) {
        await this.downloadsService.cancelDownload(item.id);
    }

    async retry(item: DownloadItem) {
        await this.downloadsService.retryDownload(item.id);
    }

    async remove(item: DownloadItem) {
        await this.downloadsService.removeDownload(item.id);
    }

    async play(item: DownloadItem) {
        if (item.filePath) {
            await this.downloadsService.playDownload(item.filePath);
        }
    }

    async reveal(item: DownloadItem) {
        if (item.filePath) {
            await this.downloadsService.revealFile(item.filePath);
        }
    }

    async changeFolder() {
        await this.downloadsService.selectFolder();
    }

    async clearCompleted() {
        const playlistId = this.route.snapshot.params['id'];
        await this.downloadsService.clearCompleted(playlistId);
    }

    goBack() {
        this.router.navigate(['..'], { relativeTo: this.route });
    }

    formatEpisodeLabel(item: DownloadItem): string {
        if (item.contentType !== 'episode') return '';
        const s = item.seasonNumber?.toString().padStart(2, '0') || '00';
        const e = item.episodeNumber?.toString().padStart(2, '0') || '00';
        return `S${s}E${e}`;
    }
}
