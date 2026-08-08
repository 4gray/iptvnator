import { ClipboardModule } from '@angular/cdk/clipboard';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
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

    readonly retryRequested = output<void>();
    readonly playerRequested = output<PlaybackRecommendationTarget>();
    readonly alternativeSourceRequested = output<string>();
    readonly sourceCheckRequested = output<string>();

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
