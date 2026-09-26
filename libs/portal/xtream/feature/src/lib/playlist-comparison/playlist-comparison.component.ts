import {
    ChangeDetectionStrategy,
    Component,
    OnInit,
    computed,
    inject,
    signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';
import { PlaylistsService } from '@iptvnator/services';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { firstValueFrom } from 'rxjs';
import {
    compareXtreamCatalogues,
    PlaylistComparisonBucket,
    PlaylistComparisonContentType,
    PlaylistComparisonRow,
    PlaylistComparisonTypeResult,
    XtreamPlaylistComparisonService,
} from '@iptvnator/portal/xtream/data-access';

const TYPES: Array<{ type: PlaylistComparisonContentType; label: string }> = [
    { type: 'movie', label: 'PLAYLIST_COMPARISON.MOVIES' },
    { type: 'series', label: 'PLAYLIST_COMPARISON.SERIES' },
    { type: 'live', label: 'PLAYLIST_COMPARISON.LIVE' },
];
const BUCKET_PROPERTIES: Record<
    PlaylistComparisonBucket,
    'common' | 'onlyA' | 'onlyB' | 'ambiguous'
> = {
    common: 'common',
    'only-a': 'onlyA',
    'only-b': 'onlyB',
    ambiguous: 'ambiguous',
};

@Component({
    selector: 'app-playlist-comparison',
    imports: [MatButtonModule, TranslatePipe],
    templateUrl: './playlist-comparison.component.html',
    styleUrl: './playlist-comparison.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlaylistComparisonComponent implements OnInit {
    private readonly playlistsService = inject(PlaylistsService);
    private readonly comparison = inject(XtreamPlaylistComparisonService);
    private refreshGeneration = 0;
    readonly playlists = signal<PlaylistMeta[]>([]);
    readonly playlistA = signal('');
    readonly playlistB = signal('');
    readonly type = signal<PlaylistComparisonContentType>('movie');
    readonly bucket = signal<PlaylistComparisonBucket>('common');
    readonly result = signal<PlaylistComparisonTypeResult | null>(null);
    readonly unavailable = signal(false);
    readonly failed = signal(false);
    readonly loading = signal(false);
    readonly types = TYPES;
    readonly selectedRows = computed(
        () => this.result()?.[this.bucketToProperty()] ?? []
    );
    async ngOnInit(): Promise<void> {
        const all = await firstValueFrom(
            this.playlistsService.getAllPlaylists()
        );
        this.playlists.set(
            all.filter((playlist) => this.comparison.isXtream(playlist))
        );
    }
    async updateSelection(which: 'a' | 'b', value: string): Promise<void> {
        if (which === 'a') this.playlistA.set(value);
        else this.playlistB.set(value);
        await this.refresh();
    }
    async selectType(type: PlaylistComparisonContentType): Promise<void> {
        this.type.set(type);
        await this.refresh();
    }
    async refresh(): Promise<void> {
        const aId = this.playlistA();
        const bId = this.playlistB();
        const type = this.type();
        const generation = ++this.refreshGeneration;
        this.result.set(null);
        this.unavailable.set(false);
        this.failed.set(false);
        if (!aId || !bId || aId === bId) {
            this.loading.set(false);
            return;
        }
        this.loading.set(true);
        try {
            const [a, b] = await Promise.all([
                this.comparison.catalogue(aId, type),
                this.comparison.catalogue(bId, type),
            ]);
            if (generation !== this.refreshGeneration) return;
            this.unavailable.set(
                a.status !== 'completed' || b.status !== 'completed'
            );
            if (!this.unavailable())
                this.result.set(
                    compareXtreamCatalogues(a.content, b.content, type)
                );
        } catch {
            if (generation !== this.refreshGeneration) return;
            this.failed.set(true);
        } finally {
            if (generation === this.refreshGeneration) this.loading.set(false);
        }
    }
    setBucket(bucket: PlaylistComparisonBucket): void {
        this.bucket.set(bucket);
    }
    rowTitles(row: PlaylistComparisonRow, side: 'a' | 'b'): string {
        return row[side].map((item) => item.title).join(', ') || '—';
    }
    private bucketToProperty(): 'common' | 'onlyA' | 'onlyB' | 'ambiguous' {
        return BUCKET_PROPERTIES[this.bucket()];
    }
}
