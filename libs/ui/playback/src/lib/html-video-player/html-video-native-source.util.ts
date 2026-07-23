/** DOM helpers for the native <video> source fallback of the HTML5 player. */
export function clearNativeVideoSources(element: HTMLVideoElement): void {
    element.removeAttribute('src');
    element.replaceChildren();
}

export function replaceNativeVideoSource(
    element: HTMLVideoElement,
    url: string,
    type: string,
    beforeLoad?: () => void
): void {
    clearNativeVideoSources(element);
    const source = document.createElement('source');
    source.src = url;
    source.type = type;
    element.appendChild(source);
    beforeLoad?.();
    element.load();
}
