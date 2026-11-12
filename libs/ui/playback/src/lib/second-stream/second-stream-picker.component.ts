import { CdkTrapFocus } from '@angular/cdk/a11y';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    effect,
    inject,
    input,
    output,
    signal,
    untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { ChannelListItemComponent } from '@iptvnator/ui/components';
import {
    SecondStreamCatalogService,
    SecondStreamCatalog,
    SecondStreamChannel,
    SecondStreamSource,
} from '@iptvnator/portal/shared/data-access';
import { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';
import { EmbeddedMpvOverlayVisibilityService } from '../embedded-mpv-player/embedded-mpv-overlay-visibility.service';

@Component({
    selector: 'app-second-stream-picker',
    templateUrl: './second-stream-picker.component.html',
    styleUrl: './second-stream-picker.component.scss',
    imports: [
        CdkTrapFocus,
        FormsModule,
        MatButtonModule,
        MatIconModule,
        TranslatePipe,
        ChannelListItemComponent,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SecondStreamPickerComponent {
    private readonly catalog = inject(SecondStreamCatalogService);
    readonly returningToOriginal = input(false);
    readonly selected = output<ResolvedPortalPlayback>();
    readonly dismissed = output<void>();
    readonly sources = signal<SecondStreamSource[]>([]);
    readonly source = signal('');
    readonly group = signal<string | null>(null);
    readonly search = signal('');
    readonly loading = signal(true);
    readonly groupLoading = signal(false);
    readonly resolving = signal<string | null>(null);
    readonly error = signal<'load' | 'play' | 'group' | null>(null);
    readonly data = signal<SecondStreamCatalog>({ groups: [], channels: [] });
    readonly limit = signal(100);
    private request = new AbortController();
    private generation = 0;
    private initialized = false;
    readonly filtered = computed(() => {
        const search = this.search().trim().toLocaleLowerCase();
        return this.data().channels.filter(
            (row) =>
                (this.group() === null || row.group === this.group()) &&
                (!search || row.item.name.toLocaleLowerCase().includes(search))
        );
    });
    readonly visible = computed(() => this.filtered().slice(0, this.limit()));

    constructor() {
        const release = inject(
            EmbeddedMpvOverlayVisibilityService
        ).acquireExternalModalSurface();
        inject(DestroyRef).onDestroy(() => {
            this.generation++;
            this.request.abort();
            release();
        });
        effect(() => {
            this.catalog.version();
            untracked(() => void this.reload());
        });
        effect(() => {
            this.search();
            this.group();
            this.limit.set(100);
        });
    }

    changeSource(id: string): void {
        this.source.set(id);
        this.group.set(null);
        this.search.set('');
        void this.reload();
    }

    async reload(): Promise<void> {
        const generation = ++this.generation;
        this.request.abort();
        this.request = new AbortController();
        this.loading.set(true);
        this.groupLoading.set(false);
        this.resolving.set(null);
        this.error.set(null);
        this.data.set({ groups: [], channels: [] });
        try {
            const [sources, data] = await Promise.all([
                this.initialized
                    ? Promise.resolve(this.sources())
                    : this.catalog.sources(),
                this.catalog.load(this.source(), this.request.signal),
            ]);
            if (generation !== this.generation) return;
            this.sources.set(sources);
            this.data.set(data);
            this.initialized = true;
        } catch {
            if (generation === this.generation) this.error.set('load');
        } finally {
            if (generation === this.generation) this.loading.set(false);
        }
    }

    async selectGroup(id: string | null): Promise<void> {
        this.group.set(id);
        const generation = ++this.generation;
        this.request.abort();
        this.request = new AbortController();
        this.resolving.set(null);
        this.error.set(null);
        this.groupLoading.set(false);
        if (id === null || this.data().channels.some((row) => row.group === id))
            return;
        this.groupLoading.set(true);
        try {
            const rows = await this.catalog.loadGroup(
                this.source(),
                id,
                this.request.signal
            );
            if (generation === this.generation)
                this.data.update((data) => ({
                    ...data,
                    channels: [...data.channels, ...rows],
                }));
        } catch {
            if (generation === this.generation) this.error.set('group');
        } finally {
            if (generation === this.generation) this.groupLoading.set(false);
        }
    }

    async choose(row: SecondStreamChannel): Promise<void> {
        if (this.resolving()) return;
        const generation = this.generation;
        this.resolving.set(row.item.uid);
        this.error.set(null);
        try {
            const playback = await this.catalog.resolve(row);
            if (generation === this.generation) this.selected.emit(playback);
        } catch {
            if (generation === this.generation) this.error.set('play');
        } finally {
            if (generation === this.generation) this.resolving.set(null);
        }
    }
}
