import { Injectable } from '@angular/core';
import { EmbeddedMpvSubtitleTrack } from '@iptvnator/shared/interfaces';

/** Explicit subtitle choice retained while player components remount. */
@Injectable({ providedIn: 'root' })
export class EmbeddedMpvSubtitlePreferenceService {
    /** Undefined means no viewer choice; null means subtitles were turned off. */
    current: { language?: string; title?: string } | null | undefined;
    revision = 0;

    record(trackId: number, tracks: readonly EmbeddedMpvSubtitleTrack[]): void {
        const chosen = tracks.find((track) => track.id === trackId);
        this.current =
            trackId < 0 || !chosen
                ? null
                : { language: chosen.language, title: chosen.title };
        this.revision += 1;
    }
}
