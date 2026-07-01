import {
    ChangeDetectionStrategy,
    Component,
    input,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * Presentational long-press diagnostic overlay — the `.player-debug` panel. Off by default; the
 * container toggles `visible` on a long-press of the
 * video surface. It surfaces the playback failure axis on a device with no devtools (e.g. an iPad
 * running the PWA): the single most valuable row is `isolated`, because iptvnator may be deployed
 * without COOP/COEP → `crossOriginIsolated=false` → no SharedArrayBuffer → a dead decoder with no
 * console to diagnose it. The remaining rows (tier/format/status/clock) report the rest of the axis.
 */
@Component({
    selector: 'app-ferrite-debug-overlay',
    template: `
        @if (visible()) {
            <div class="ferrite-debug">
                <div class="ferrite-debug-row">
                    <span>{{ 'FERRITE_PLAYER.DEBUG_ISOLATED' | translate }}</span>
                    <b [class.ok]="isolated()" [class.bad]="!isolated()">
                        {{
                            (isolated()
                                ? 'FERRITE_PLAYER.DEBUG_ISOLATED_YES'
                                : 'FERRITE_PLAYER.DEBUG_ISOLATED_NO'
                            ) | translate
                        }}
                    </b>
                </div>
                <div class="ferrite-debug-row">
                    <span>{{ 'FERRITE_PLAYER.DEBUG_TIER' | translate }}</span
                    ><b>{{ tier() }}</b>
                </div>
                <div class="ferrite-debug-row">
                    <span>{{ 'FERRITE_PLAYER.DEBUG_FORMAT' | translate }}</span
                    ><b>{{ format() }}</b>
                </div>
                <div class="ferrite-debug-row">
                    <span>{{ 'FERRITE_PLAYER.DEBUG_STATUS' | translate }}</span
                    ><b>{{ status() }}</b>
                </div>
                <div class="ferrite-debug-row">
                    <span>{{ 'FERRITE_PLAYER.DEBUG_CLOCK' | translate }}</span
                    ><b>{{ clock() }}</b>
                </div>
            </div>
        }
    `,
    styleUrls: ['./ferrite-debug-overlay.component.scss'],
    imports: [TranslatePipe],
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FerriteDebugOverlayComponent {
    readonly visible = input(false);
    readonly isolated = input(false);
    readonly tier = input('—');
    readonly format = input('—');
    readonly status = input('—');
    readonly clock = input('—');
}
