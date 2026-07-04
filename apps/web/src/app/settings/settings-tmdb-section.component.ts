import { Component, inject, input, signal, ViewEncapsulation } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslateModule } from '@ngx-translate/core';
import { TmdbApiService } from '@iptvnator/services';

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
        `,
    ],
})
export class SettingsTmdbSectionComponent {
    private readonly tmdbApi = inject(TmdbApiService);

    readonly form = input.required<FormGroup>();
    readonly activeSection = input.required<string>();

    readonly keyTestState = signal<TmdbKeyTestState>('idle');

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
}
