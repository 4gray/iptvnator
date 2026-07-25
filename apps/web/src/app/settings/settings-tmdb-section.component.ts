import {
    Component,
    effect,
    inject,
    input,
    signal,
    untracked,
    ViewEncapsulation,
} from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslateModule } from '@ngx-translate/core';
import { TmdbApiService, TmdbCacheService } from '@iptvnator/services';
import type { TmdbCacheStats } from '@iptvnator/shared/interfaces';

type TmdbKeyTestState = 'idle' | 'testing' | 'success' | 'error';

@Component({
    selector: 'app-settings-tmdb-section',
    imports: [
        MatButtonModule,
        MatCheckboxModule,
        MatFormFieldModule,
        MatIconModule,
        MatInputModule,
        MatProgressSpinnerModule,
        ReactiveFormsModule,
        TranslateModule,
    ],
    templateUrl: './settings-tmdb-section.component.html',
    encapsulation: ViewEncapsulation.None,
    styles: [
        `
            app-settings-tmdb-section {
                display: contents;
            }

            .tmdb-key-test {
                align-items: center;
                display: flex;
                flex-wrap: wrap;
                gap: 12px;
                margin-top: 8px;
            }

            .tmdb-key-test__result {
                align-items: center;
                display: inline-flex;
                font-size: 0.875rem;
                gap: 4px;

                mat-icon {
                    font-size: 18px;
                    height: 18px;
                    width: 18px;
                }
            }

            .tmdb-key-test__result--success {
                color: #4caf50;
            }

            .tmdb-key-test__result--error {
                color: #f44336;
            }

            .tmdb-cache__size {
                font-variant-numeric: tabular-nums;
            }
        `,
    ],
})
export class SettingsTmdbSectionComponent {
    private readonly tmdbApi = inject(TmdbApiService);
    private readonly tmdbCache = inject(TmdbCacheService);

    readonly form = input.required<FormGroup>();
    readonly activeSection = input.required<string>();

    readonly keyTestState = signal<TmdbKeyTestState>('idle');
    readonly cacheStats = signal<TmdbCacheStats | null>(null);
    readonly isClearing = signal(false);

    constructor() {
        // Sizing the cache is a full table scan, so it waits until the
        // user is actually looking at this section.
        effect(() => {
            if (this.activeSection() !== 'tmdb') {
                return;
            }
            untracked(() => {
                if (this.cacheStats() === null) {
                    void this.refreshCacheStats();
                }
            });
        });
    }

    get enteredApiKey(): string {
        return (this.form().value.tmdb?.apiKey ?? '').trim();
    }

    async testApiKey(): Promise<void> {
        const apiKey = this.enteredApiKey;
        if (!apiKey || this.keyTestState() === 'testing') {
            return;
        }

        this.keyTestState.set('testing');
        const isValid = await this.tmdbApi.validateApiKey(apiKey);
        this.keyTestState.set(isValid ? 'success' : 'error');
    }

    async clearCache(): Promise<void> {
        if (this.isClearing()) {
            return;
        }
        this.isClearing.set(true);
        try {
            await this.tmdbCache.clear();
            await this.refreshCacheStats();
        } finally {
            this.isClearing.set(false);
        }
    }

    /** "12.4 MB" — cache payloads are JSON, so decimal units read right */
    formatBytes(bytes: number): string {
        if (bytes < 1024) {
            return `${bytes} B`;
        }
        const units = ['KB', 'MB', 'GB'];
        let value = bytes / 1024;
        let unit = 0;
        while (value >= 1024 && unit < units.length - 1) {
            value /= 1024;
            unit++;
        }
        return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
    }

    private async refreshCacheStats(): Promise<void> {
        this.cacheStats.set(await this.tmdbCache.getStats());
    }

}
