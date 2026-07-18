/** Helpers for driving the native `<video>` element source list. */

export function clearNativeVideoSources(element: HTMLVideoElement): void {
    element.removeAttribute('src');
    element.replaceChildren();
}

/**
 * Replaces the element's sources with a single `<source>` without loading it;
 * callers bind their controls source first, then call `element.load()`.
 */
export function setNativeVideoSource(
    element: HTMLVideoElement,
    url: string,
    type: string
): void {
    clearNativeVideoSources(element);
    const source = document.createElement('source');
    source.src = url;
    source.type = type;
    element.appendChild(source);
}
