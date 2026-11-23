export type VideoFitMode = 'original' | 'crop' | 'stretch';

// Session-local: fullscreen owners survive engine remounts, not app restarts.
export const videoFitModes = new WeakMap<HTMLElement, VideoFitMode>();

const fitProperties = {
    width: '100%',
    height: '100%',
    'min-width': '0',
    'min-height': '0',
    'max-width': 'none',
    'max-height': 'none',
    'object-position': 'center',
};

/** Fill the existing video viewport; CSS recalculates on resize/fullscreen. */
export function applyVideoFit(video: HTMLVideoElement, mode: VideoFitMode): () => void {
    if (mode === 'original') return () => undefined;
    const values = { ...fitProperties, 'object-fit': mode === 'crop' ? 'cover' : 'fill' };
    const previous = Object.keys(values).map((property) => ({
        property,
        value: video.style.getPropertyValue(property),
        priority: video.style.getPropertyPriority(property),
    }));
    for (const [property, value] of Object.entries(values)) {
        video.style.setProperty(property, value, 'important');
    }
    return () => {
        for (const { property, value, priority } of previous) {
            if (value) video.style.setProperty(property, value, priority);
            else video.style.removeProperty(property);
        }
    };
}
