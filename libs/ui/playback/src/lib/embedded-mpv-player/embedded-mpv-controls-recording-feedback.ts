import type { TranslateService } from '@ngx-translate/core';

export const RECORDING_FEEDBACK = {
    RAW: 'raw',
    TRANSLATED: 'translated',
} as const;

export const RECORDING_TRANSLATION = {
    START_FAILED: 'EMBEDDED_MPV.PLAYER.RECORDING_FAILED_TO_START',
    STOP_FAILED: 'EMBEDDED_MPV.PLAYER.RECORDING_FAILED_TO_STOP',
    SAVED_TO: 'EMBEDDED_MPV.PLAYER.SAVED_TO',
} as const;

type RecordingTranslationKey =
    (typeof RECORDING_TRANSLATION)[keyof typeof RECORDING_TRANSLATION];

interface RawRecordingFeedback {
    readonly kind: typeof RECORDING_FEEDBACK.RAW;
    readonly text: string;
}

interface TranslatedRecordingFeedback {
    readonly kind: typeof RECORDING_FEEDBACK.TRANSLATED;
    readonly key: RecordingTranslationKey;
    readonly params?: Readonly<Record<string, string>>;
}

export type RecordingFeedback =
    | RawRecordingFeedback
    | TranslatedRecordingFeedback;

export function resolveRecordingFeedback(
    feedback: RecordingFeedback | null,
    translate: TranslateService
): string | null {
    if (!feedback) {
        return null;
    }
    return feedback.kind === RECORDING_FEEDBACK.RAW
        ? feedback.text
        : translate.instant(feedback.key, feedback.params);
}
