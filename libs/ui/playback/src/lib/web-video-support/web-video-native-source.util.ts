import { getPlaybackMediaExtensionFromUrl } from '@iptvnator/playback/util';

/** Helpers for driving the native `<video>` element source list. */

const MP4_FAMILY_EXTENSIONS: ReadonlySet<string> = new Set(['mp4', 'm4v']);

export function clearNativeVideoSources(element: HTMLVideoElement): void {
    element.removeAttribute('src');
    element.replaceChildren();
}

/**
 * MIME hint for a native `<source>`, given only to MP4-family files.
 *
 * The hint is a filter, not a description: the browser skips a `<source>`
 * whose type its `canPlayType()` rejects, and a container it demuxes (mkv,
 * webm, mov, avi) is not necessarily one it advertises there. Those sources
 * stay unhinted so the browser sniffs the bytes instead.
 */
export function resolveNativeSourceMimeType(url: string): string | undefined {
    return MP4_FAMILY_EXTENSIONS.has(getPlaybackMediaExtensionFromUrl(url))
        ? 'video/mp4'
        : undefined;
}

/**
 * Replaces the element's sources with a single `<source>` without loading it;
 * callers bind their controls source first, then call `element.load()`.
 */
export function setNativeVideoSource(
    element: HTMLVideoElement,
    url: string,
    type?: string
): void {
    clearNativeVideoSources(element);
    const source = document.createElement('source');
    source.src = url;
    if (type) {
        source.type = type;
    }
    element.appendChild(source);
}
