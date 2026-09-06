import { linkedSignal } from '@angular/core';
import type { EmbeddedMpvSupport } from '@iptvnator/shared/interfaces';

/**
 * The fullscreen channel panel is DOM content over the video. Embedded
 * MPV's native-view engine paints a platform view above the page, where
 * no DOM layer can show, so the panel exists only while the rendered
 * engine is a web player or Embedded MPV's frame-copy canvas. Fails
 * closed until frame-copy has been confirmed. Retain that confirmation
 * while a replacement component probes support, so channel changes do
 * not reset the panel. A confirmed native/unsupported result revokes it.
 */
export function createChannelPanelAvailability(
    embedded: () => boolean,
    support: () => EmbeddedMpvSupport | null
) {
    return linkedSignal<
        { embedded: boolean; support: EmbeddedMpvSupport | null },
        boolean
    >({
        source: () => ({ embedded: embedded(), support: support() }),
        computation: ({ embedded, support }, previous) => {
            if (!embedded) return true;
            if (support === null) {
                return previous?.source.embedded ? previous.value : false;
            }
            return support.supported && support.engine === 'frame-copy';
        },
    });
}
