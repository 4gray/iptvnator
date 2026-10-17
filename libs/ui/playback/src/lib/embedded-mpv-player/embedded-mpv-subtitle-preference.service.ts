import { Injectable } from '@angular/core';

/** Explicit subtitle choice retained while player components remount. */
@Injectable({ providedIn: 'root' })
export class EmbeddedMpvSubtitlePreferenceService {
    /** Undefined means no viewer choice; null means subtitles were turned off. */
    current: { language?: string; title?: string } | null | undefined;
}
