import { DOCUMENT } from '@angular/common';
import { version as appVersion } from '@package';
import { createDiagnosticReport } from './playback-diagnostic-report.util';
import { ClipboardModule } from '@angular/cdk/clipboard';
import {
    afterRenderEffect,
    ChangeDetectionStrategy,
    ElementRef,
    Component,
    computed,
    inject,
    signal,
    input,
    output,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import {
    type PlaybackDiagnostic,
    type PlaybackRecommendation,
    type PlaybackRecommendationTarget,
} from '@iptvnator/playback/util';
import type {
    ResolvedPortalPlayback,
    VodSourceDescriptor,
} from '@iptvnator/shared/interfaces';
import { VodSourceRowComponent } from '@iptvnator/ui/components';
import type {
    ExternalRecoveryStates,
    ExternalRecoveryTargetState,
} from '../web-player-view/external-playback-recovery';
import {
    getDiagnosticCodecHint,
    getDiagnosticDescriptionKey,
    getDiagnosticDetails,
    getDiagnosticMeta,
    getDiagnosticTitleKey,
} from './playback-diagnostic-view.util';
import {
    getRecommendationIcon,
    getRecommendationKey,
    getExternalRecommendationStatusKey,
    getRecommendationLabelKey as resolveRecommendationLabelKey,
    getRecommendationParams,
    getRecommendationReasonKey,
    getRecommendationTestId,
    isExternalPlayerRecommendation,
    isExternalRecommendationLaunching,
    isTemporaryBuiltInRecommendation,
} from './playback-recommendation-view.util';

/** How many recovery options the error screen shows before it stops helping. */
const ERROR_SCREEN_ALTERNATIVES = 5;

const ANDROID_ACTIONS = {
    builtIn: 'PLAYBACK_DIAGNOSTICS.ACTION_OPEN_BUILT_IN_PLAYER',
    external: 'PORTALS.DETAIL.OPEN_IN_EXTERNAL_PLAYER',
    reconnect: 'PLAYBACK_DIAGNOSTICS.ACTION_RECONNECT',
    retry: 'PLAYBACK_DIAGNOSTICS.ACTION_RETRY',
    return: 'PLAYBACK_DIAGNOSTICS.ACTION_RETURN_TO_WEB_PLAYER',
} as const;

type AndroidRecoveryAction = keyof typeof ANDROID_ACTIONS;

@Component({
    selector: 'app-playback-diagnostic-panel',
    templateUrl: './playback-diagnostic-panel.component.html',
    styleUrl: './playback-diagnostic-panel.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        ClipboardModule,
        MatIconModule,
        MatProgressSpinnerModule,
        MatTooltipModule,
        TranslateModule,
        VodSourceRowComponent,
    ],
    host: { class: 'playback-diagnostic-panel' },
})
export class PlaybackDiagnosticPanelComponent {
    readonly diagnostic = input.required<PlaybackDiagnostic>();
    readonly recommendations =
        input.required<readonly PlaybackRecommendation[]>();
    readonly playback = input.required<ResolvedPortalPlayback>();
    readonly supportsManagedExternalPlayers = input.required<boolean>();
    readonly playbackExternallyTransferable = input.required<boolean>();
    readonly alternativeSources = input<readonly VodSourceDescriptor[]>([]);
    readonly externalStates = input.required<ExternalRecoveryStates>();
    readonly pending = input(false);

    readonly androidRecovery = input<{
        builtIn: boolean;
        external: boolean;
        bothFailed: boolean;
        opening: boolean;
        returning: boolean;
    } | null>(null);
    readonly androidBuiltInRequested = output<void>();
    readonly androidExternalRequested = output<void>();

    readonly androidActions = computed<readonly AndroidRecoveryAction[]>(() => {
        const recovery = this.androidRecovery();
        if (!recovery) return [];
        const { code } = this.diagnostic();
        const formatFailure =
            code === 'unsupported-codec' ||
            code === 'unsupported-container' ||
            code === 'media-decode-error';
        const browserAccess = code === 'browser-access-error';
        const retry = recovery.returning
            ? 'return'
            : code === 'network-error'
              ? 'reconnect'
              : 'retry';
        if (recovery.opening) return [retry];
        const external =
            recovery.external &&
            (formatFailure || browserAccess || recovery.bothFailed);
        if (external && recovery.bothFailed) return ['external', retry];
        if (recovery.builtIn && formatFailure) {
            return external
                ? ['builtIn', 'external', retry]
                : ['builtIn', retry];
        }
        if (external && formatFailure) return ['external', retry];
        if (recovery.builtIn) {
            return external
                ? [retry, 'builtIn', 'external']
                : [retry, 'builtIn'];
        }
        return external ? [retry, 'external'] : [retry];
    });

    readonly androidActionLabels = ANDROID_ACTIONS;
    readonly androidActionIcons: Record<AndroidRecoveryAction, string> = {
        builtIn: 'play_arrow',
        external: 'open_in_new',
        reconnect: 'refresh',
        retry: 'refresh',
        return: 'web',
    };

    activateAndroid(action: AndroidRecoveryAction): void {
        if (action === 'builtIn') this.androidBuiltInRequested.emit();
        else if (action === 'external') this.androidExternalRequested.emit();
        else this.retryRequested.emit();
    }

    readonly retryRequested = output<void>();
    readonly playerRequested = output<PlaybackRecommendationTarget>();
    readonly alternativeSourceRequested = output<string>();
    readonly sourceCheckRequested = output<string>();

    private readonly host: HTMLElement = inject(ElementRef).nativeElement;
    constructor() {
        let previousPrimary: HTMLElement | null = null;
        afterRenderEffect(() => {
            const primary = this.androidActions()[0];
            if (!primary) return;
            const active = this.document.activeElement;
            const button = this.host.querySelector<HTMLButtonElement>(
                '[data-tv-recovery-primary]'
            );
            if (!this.host.contains(active) || active === previousPrimary) {
                button?.focus();
            }
            previousPrimary = button;
        });
        afterRenderEffect(() => {
            this.host.dispatchEvent(
                new CustomEvent('iptvnator:playback-issue', {
                    bubbles: true,
                    detail: { code: this.diagnostic().code },
                })
            );
        });
    }

    private readonly document = inject(DOCUMENT);
    private readonly copyResult = signal<{
        issue: PlaybackDiagnostic;
        success: boolean;
    } | null>(null);
    readonly diagnosticReport = computed(() =>
        createDiagnosticReport(
            this.diagnostic(),
            appVersion,
            this.document.defaultView?.navigator.userAgent ?? ''
        )
    );
    readonly copyStatusKey = computed(() => {
        const result = this.copyResult();
        if (!result || result.issue !== this.diagnostic()) return '';
        return result.success
            ? 'PLAYBACK_DIAGNOSTICS.REPORT_COPIED'
            : 'PLAYBACK_DIAGNOSTICS.COPY_FAILED';
    });

    onReportCopied(success: boolean): void {
        this.copyResult.set({ issue: this.diagnostic(), success });
    }

    readonly visibleAlternatives = computed(() =>
        this.alternativeSources().slice(0, ERROR_SCREEN_ALTERNATIVES)
    );
    readonly hiddenAlternativeCount = computed(() =>
        Math.max(
            0,
            this.alternativeSources().length - ERROR_SCREEN_ALTERNATIVES
        )
    );
    readonly hasExternalPlayerRecommendation = computed(() =>
        this.recommendations().some(isExternalPlayerRecommendation)
    );
    readonly diagnosticHeadlineKey = computed(() => {
        if (this.hasExternalPlayerRecommendation()) {
            return 'PLAYBACK_DIAGNOSTICS.NATIVE_FALLBACK_TITLE';
        }
        return this.playbackExternallyTransferable()
            ? 'PLAYBACK_DIAGNOSTICS.INLINE_FAILURE_TITLE'
            : 'PLAYBACK_DIAGNOSTICS.UNTRANSFERABLE_FAILURE_TITLE';
    });

    readonly getDiagnosticTitleKey = getDiagnosticTitleKey;
    readonly getDiagnosticMeta = getDiagnosticMeta;
    readonly getDiagnosticCodecHint = getDiagnosticCodecHint;
    readonly getDiagnosticDetails = getDiagnosticDetails;
    readonly getRecommendationKey = getRecommendationKey;
    readonly getRecommendationTestId = getRecommendationTestId;
    readonly getRecommendationIcon = getRecommendationIcon;
    readonly getRecommendationParams = getRecommendationParams;
    readonly getRecommendationReasonKey = getRecommendationReasonKey;
    readonly isTemporaryBuiltInRecommendation =
        isTemporaryBuiltInRecommendation;
    readonly isExternalPlayerRecommendation = isExternalPlayerRecommendation;

    getDiagnosticDescriptionKey(issue: PlaybackDiagnostic): string {
        return getDiagnosticDescriptionKey(
            issue,
            this.supportsManagedExternalPlayers(),
            this.playbackExternallyTransferable()
        );
    }

    activate(recommendation: PlaybackRecommendation): void {
        if (this.pending()) {
            return;
        }
        switch (recommendation.action) {
            case 'retry':
                this.retryRequested.emit();
                return;
            case 'player':
                this.playerRequested.emit(recommendation.target);
                return;
            case 'alternative-source':
                return;
        }
    }

    getRecommendationLabelKey(recommendation: PlaybackRecommendation): string {
        return resolveRecommendationLabelKey(
            recommendation,
            this.getExternalState(recommendation)
        );
    }

    getExternalStatusKey(
        recommendation: PlaybackRecommendation
    ): string | null {
        return getExternalRecommendationStatusKey(
            recommendation,
            this.getExternalState(recommendation)
        );
    }

    isExternalLaunching(recommendation: PlaybackRecommendation): boolean {
        return isExternalRecommendationLaunching(
            recommendation,
            this.getExternalState(recommendation)
        );
    }

    private getExternalState(
        recommendation: PlaybackRecommendation
    ): ExternalRecoveryTargetState | undefined {
        return isExternalPlayerRecommendation(recommendation)
            ? this.externalStates()[recommendation.target]
            : undefined;
    }
}
