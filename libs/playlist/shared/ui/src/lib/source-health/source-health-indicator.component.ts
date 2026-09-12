import {
    Component,
    Injector,
    computed,
    effect,
    inject,
    input,
} from '@angular/core';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslateService } from '@ngx-translate/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { startWith } from 'rxjs';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { SourceHealthService } from '@iptvnator/portal/shared/data-access';
import { PlaylistMeta, sourceHealthType } from '@iptvnator/shared/interfaces';

@Component({
    selector: 'app-source-health-indicator',
    imports: [MatTooltip],
    template: `@if (supported()) {
        <span
            class="health-dot"
            [attr.data-state]="snapshot()?.state ?? 'unknown'"
            [matTooltip]="description()"
            [attr.aria-label]="description()"
            role="img"
        ></span>
    }`,
    styles: [
        `
            :host {
                display: inline-flex;
                vertical-align: middle;
            }
            .health-dot {
                display: block;
                width: 9px;
                height: 9px;
                border-radius: 50%;
                background: var(--mat-sys-on-surface-variant);
                border: 2px solid var(--mat-sys-surface);
            }
            [data-state='active'] {
                background: #4caf50;
            }
            [data-state='expired'] {
                background: #ff9800;
            }
            [data-state='inactive'] {
                background: #f44336;
            }
            [data-state='checking'] {
                opacity: 0.45;
            }
        `,
    ],
})
export class SourceHealthIndicatorComponent {
    readonly playlist = input.required<PlaylistMeta>();
    readonly enabled = input(true);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly injector = inject(Injector);
    private readonly translate = inject(TranslateService);
    private readonly language = toSignal(
        this.translate.onLangChange.pipe(startWith(null))
    );
    readonly supported = computed(
        () =>
            this.runtime.supportsSourceHealth &&
            !!sourceHealthType(this.playlist())
    );
    readonly snapshot = computed(() =>
        this.supported()
            ? this.injector.get(SourceHealthService).get(this.playlist())
            : undefined
    );
    readonly description = computed(() => {
        this.language();
        const snapshot = this.snapshot();
        const reason =
            snapshot?.state === 'checking'
                ? 'checking'
                : (snapshot?.reason ?? 'unknown');
        const label = this.translate.instant(`SOURCE_HEALTH.REASON.${reason}`);
        const time = snapshot?.checkedAt
            ? new Date(snapshot.checkedAt).toLocaleTimeString(
                  this.translate.currentLang || 'en'
              )
            : '';
        const scope =
            sourceHealthType(this.playlist()) === 'm3u'
                ? this.translate.instant('SOURCE_HEALTH.M3U_SCOPE')
                : '';
        return [label, scope, time].filter(Boolean).join(' · ');
    });
    constructor() {
        effect((onCleanup) => {
            const p = this.playlist();
            if (!this.enabled() || !this.supported()) return;
            const controller = new AbortController();
            void this.injector
                .get(SourceHealthService)
                .check(p, { signal: controller.signal });
            onCleanup(() => controller.abort());
        });
    }
}
