import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    input,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslateService } from '@ngx-translate/core';
import { normalizeDateLocale } from '@iptvnator/pipes';
import { injectTranslationTick } from '@iptvnator/services';
import {
    getPlaylistSourceIcon,
    PlaylistMeta,
    resolvePlaylistSourceKind,
    SourceReachability,
    SourceStatus,
} from '@iptvnator/shared/interfaces';

/**
 * The health reason shown for each reachability when the check left no
 * cause, as in a browser build's "checking" status.
 */
const REACHABILITY_REASON: Record<SourceReachability, string> = {
    ok: 'available',
    bad: 'network',
    expired: 'expired',
    checking: 'checking',
    unknown: 'unknown',
};

/**
 * The provider icon on a rounded tile, with the status dot at its corner:
 * green answers, red does not, orange is an expired account, grey is not
 * checked yet. Local files have no dot.
 */
@Component({
    selector: 'app-source-tile',
    imports: [MatIcon, MatTooltip],
    template: `
        <mat-icon class="source-tile__icon" aria-hidden="true">{{
            icon()
        }}</mat-icon>
        @if (status(); as status) {
            <span
                class="source-tile__dot"
                role="img"
                [attr.data-state]="dotState()"
                [class.source-tile__dot--pending]="status.pending"
                [attr.aria-label]="description()"
                [matTooltip]="description()"
            ></span>
        }
    `,
    styleUrl: './source-tile.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        class: 'source-tile',
        '[class.source-tile--sm]': "size() === 'sm'",
        '[class.source-tile--md]': "size() === 'md'",
        '[class.source-tile--lg]': "size() === 'lg'",
    },
})
export class SourceTileComponent {
    private readonly translate = inject(TranslateService);
    private readonly languageTick = injectTranslationTick();

    readonly playlist =
        input.required<
            Pick<PlaylistMeta, 'macAddress' | 'serverUrl' | 'url'>
        >();
    readonly status = input<SourceStatus | null>(null);
    /** 28px (trigger), 32px (switcher) or 36px (Sources page). */
    readonly size = input<'sm' | 'md' | 'lg'>('lg');

    readonly icon = computed(() => getPlaylistSourceIcon(this.playlist()));
    readonly dotState = computed(() => {
        const reachability = this.status()?.reachability;
        return reachability === 'checking' ? 'unknown' : reachability;
    });
    readonly description = computed(() => {
        this.languageTick();
        const status = this.status();
        if (!status) {
            return '';
        }
        const reason = status.pending
            ? 'checking'
            : (status.reason ?? REACHABILITY_REASON[status.reachability]);
        const label = this.translate.instant(`SOURCE_HEALTH.REASON.${reason}`);
        // An M3U check reaches the playlist URL, not its channels.
        const scope =
            resolvePlaylistSourceKind(this.playlist()) === 'm3u'
                ? this.translate.instant('SOURCE_HEALTH.M3U_SCOPE')
                : '';
        const time = status.checkedAt
            ? new Date(status.checkedAt).toLocaleString(
                  normalizeDateLocale(this.translate.currentLang || 'en'),
                  {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                  }
              )
            : '';
        return [label, scope, time].filter(Boolean).join(' · ');
    });
}
