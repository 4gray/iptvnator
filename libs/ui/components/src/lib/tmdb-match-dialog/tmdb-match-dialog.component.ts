import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    computed,
    inject,
    signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
    TmdbApiService,
    TmdbRuntimeService,
    TmdbEnrichmentService,
    TmdbMatchService,
    tmdbSearchLanguageForTitle,
    tmdbPosterUrl,
    toTmdbLanguage,
    type TmdbMatchChoice,
    type TmdbMatchContext,
    type TmdbSearchResult,
} from '@iptvnator/services';
import { cleanTitleForSearch } from '@iptvnator/shared/interfaces';
import { DialogShellComponent } from '../dialog-shell/dialog-shell.component';
import { DialogFooterDirective } from '../dialog-shell/dialog-shell.directives';
import { provideFormFieldDefaults } from '../form-field-defaults/form-field-defaults';

const DisplayNames = (
    Intl as unknown as {
        DisplayNames: new (
            locales: string[],
            options: { type: 'region' | 'language' }
        ) => { of(code: string): string | undefined };
    }
).DisplayNames;

type Mode = 'auto' | 'manual' | 'provider';

@Component({
    selector: 'app-tmdb-match-dialog',
    providers: [provideFormFieldDefaults()],
    imports: [
        FormsModule,
        MatButtonModule,
        MatFormFieldModule,
        MatInputModule,
        MatIcon,
        TranslatePipe,
        DialogShellComponent,
        DialogFooterDirective,
    ],
    templateUrl: './tmdb-match-dialog.component.html',
    styleUrl: './tmdb-match-dialog.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TmdbMatchDialogComponent {
    readonly data = inject<TmdbMatchContext>(MAT_DIALOG_DATA);
    private readonly dialog = inject(MatDialogRef<TmdbMatchDialogComponent>);
    private readonly matches = inject(TmdbMatchService);
    private readonly api = inject(TmdbApiService);
    private readonly runtime = inject(TmdbRuntimeService);
    private readonly enrichment = inject(TmdbEnrichmentService);
    private readonly translate = inject(TranslateService);
    readonly previous = this.matches.read(this.data.identity);
    readonly mode = signal<Mode>('manual');
    readonly selection = signal<TmdbMatchChoice | null>(this.previous);
    readonly query = signal(cleanTitleForSearch(this.data.title));
    readonly results = signal<TmdbSearchResult[]>([]);
    readonly loading = signal(false);
    readonly saving = signal(false);
    readonly error = signal<'search' | 'save' | null>(null);
    readonly searched = signal(false);
    readonly failedPosters = signal<ReadonlySet<number>>(new Set());
    readonly modes: Mode[] = ['auto', 'manual', 'provider'];
    readonly modeLabels: Record<Mode, string> = {
        auto: 'TMDB_MATCH.MODE_AUTO',
        manual: 'TMDB_MATCH.MODE_MANUAL',
        provider: 'TMDB_MATCH.MODE_PROVIDER',
    };
    readonly canSave = computed(
        () =>
            !this.saving() &&
            (this.mode() !== 'manual' || this.selection()?.mode === 'manual')
    );
    readonly currentMode = this.previous?.mode ?? 'auto';
    readonly currentId =
        this.previous?.mode === 'manual'
            ? this.previous.tmdbId
            : this.previous?.mode === 'provider'
              ? null
              : this.data.tmdbId;
    readonly currentTitle =
        this.previous?.mode === 'manual'
            ? this.previous.title
            : this.data.title;
    readonly poster = tmdbPosterUrl;
    private request = 0;
    private timer?: ReturnType<typeof setTimeout>;

    constructor() {
        inject(DestroyRef).onDestroy(() => {
            ++this.request;
            clearTimeout(this.timer);
        });
        void this.search();
    }

    setMode(mode: Mode): void {
        this.mode.set(mode);
        this.error.set(null);
        if (mode === 'manual' && !this.loading() && !this.searched())
            void this.search();
    }

    setQuery(value: string): void {
        this.query.set(value);
        this.selection.set(null);
        ++this.request;
        clearTimeout(this.timer);
        this.results.set([]);
        this.error.set(null);
        this.searched.set(false);
        this.loading.set(value.trim().length >= 2);
        this.timer = setTimeout(() => void this.search(), 300);
    }

    async search(): Promise<void> {
        clearTimeout(this.timer);
        const query = this.query().trim();
        const request = ++this.request;
        if (query.length < 2) {
            this.loading.set(false);
            return;
        }
        this.loading.set(true);
        this.error.set(null);
        try {
            if (!this.runtime.isEnabled()) throw new Error('TMDB unavailable');
            const language = tmdbSearchLanguageForTitle(
                query,
                this.runtime.appLanguage()
            );
            const rows =
                this.data.identity.mediaType === 'tv'
                    ? await this.api.searchTv(
                          query,
                          null,
                          language,
                          this.runtime.apiKey()
                      )
                    : await this.api.searchMovie(
                          query,
                          null,
                          language,
                          this.runtime.apiKey()
                      );
            if (request !== this.request) return;
            this.results.set(rows);
            this.searched.set(true);
        } catch {
            if (request === this.request) this.error.set('search');
        } finally {
            if (request === this.request) this.loading.set(false);
        }
    }

    title(row: TmdbSearchResult): string {
        return (
            row.title ||
            row.name ||
            row.original_title ||
            row.original_name ||
            String(row.id)
        );
    }

    originalTitle(row: TmdbSearchResult): string | null {
        const original = row.original_title || row.original_name;
        return original && original !== this.title(row) ? original : null;
    }

    facts(row: TmdbSearchResult): string {
        const locale = toTmdbLanguage(this.translate.currentLang);
        const date = row.release_date || row.first_air_date;
        const countries = row.origin_country ?? [];
        const names = new DisplayNames([locale], {
            type: 'region',
        });
        const language = row.original_language;
        const languageNames = new DisplayNames([locale], { type: 'language' });
        return [
            date?.slice(0, 4),
            ...countries.map((code) => names.of(code)),
            countries.length
                ? null
                : language
                  ? languageNames.of(language)
                  : null,
        ]
            .filter(Boolean)
            .join(' · ');
    }

    isSelected(id: number): boolean {
        const choice = this.selection();
        return choice?.mode === 'manual' && choice.tmdbId === id;
    }

    select(row: TmdbSearchResult): void {
        this.selection.set({
            mode: 'manual',
            tmdbId: row.id,
            title: this.title(row),
        });
        this.error.set(null);
    }

    posterFailed(id: number): void {
        this.failedPosters.update((ids) => new Set([...ids, id]));
    }

    async save(): Promise<void> {
        if (!this.canSave()) return;
        this.saving.set(true);
        this.error.set(null);
        this.dialog.disableClose = true;
        try {
            const choice =
                this.mode() === 'auto'
                    ? null
                    : this.mode() === 'provider'
                      ? { mode: 'provider' as const }
                      : this.selection();
            if (choice?.mode === 'manual') {
                if (
                    !this.runtime.isEnabled() ||
                    !(await this.enrichment.getDetailsForMatch(
                        this.data.identity.mediaType,
                        choice.tmdbId
                    ))
                ) {
                    throw new Error('TMDB details unavailable');
                }
            }
            await this.matches.save(this.data.identity, choice);
            this.dialog.close(true);
        } catch {
            this.error.set('save');
        } finally {
            this.saving.set(false);
            this.dialog.disableClose = false;
        }
    }

    cancel(): void {
        this.dialog.close();
    }
}
