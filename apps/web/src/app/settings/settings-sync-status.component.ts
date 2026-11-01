import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    input,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { map } from 'rxjs';

export function formatSyncTime(timestamp: number, language: string): string {
    const locale =
        ({ by: 'be', ary: 'ar', zhtw: 'zh-TW' } as Record<string, string>)[
            language
        ] ?? language;
    const options: Intl.DateTimeFormatOptions = {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    };
    try {
        return new Intl.DateTimeFormat(locale || 'en', options).format(
            timestamp
        );
    } catch {
        return new Intl.DateTimeFormat('en', options).format(timestamp);
    }
}

@Component({
    selector: 'app-settings-sync-status',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [MatIconModule, TranslateModule],
    template: `
        <div class="sync-summary">
            <span
                class="sync-status"
                [class.sync-status--success]="success()"
                [class.sync-status--error]="error()"
                role="status"
            >
                <mat-icon aria-hidden="true">{{ icon() }}</mat-icon>
                <span [attr.data-test-id]="testId()">{{
                    stateKey() | translate
                }}</span>
            </span>
            @if (formattedTime(); as time) {
                <span class="sync-time">
                    {{ 'SOURCE_SYNC.LAST_SYNC' | translate }}
                    <time [attr.datetime]="isoTime()">{{ time }}</time>
                </span>
            }
        </div>
    `,
    styleUrl: './settings-sync-status.component.scss',
})
export class SettingsSyncStatusComponent {
    readonly state = input.required<string>();
    readonly stateKey = input.required<string>();
    readonly lastSync = input<number | Date | null>(null);
    readonly testId = input.required<string>();
    private readonly translate = inject(TranslateService);
    private readonly language = toSignal(
        this.translate.onLangChange.pipe(map((event) => event.lang)),
        {
            initialValue: this.translate.currentLang || 'en',
        }
    );
    readonly success = computed(() =>
        ['connected', 'ready'].includes(this.state())
    );
    readonly error = computed(() =>
        ['offline', 'locked', 'conflict', 'incompatible'].includes(this.state())
    );
    readonly icon = computed(() =>
        this.success()
            ? 'check_circle'
            : this.error()
              ? 'error_outline'
              : 'sync'
    );
    readonly isoTime = computed(() => {
        const value = this.lastSync();
        const timestamp = value instanceof Date ? value.getTime() : value;
        return timestamp !== null && Number.isFinite(timestamp)
            ? new Date(timestamp).toISOString()
            : null;
    });
    readonly formattedTime = computed(() =>
        this.isoTime()
            ? formatSyncTime(
                  new Date(this.isoTime()!).getTime(),
                  this.language()
              )
            : null
    );
}
