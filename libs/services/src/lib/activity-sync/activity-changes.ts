/** Local renderer invalidation; the durable store remains the source of truth. */
const eventName = 'iptvnator-activity-changed';
export function announceActivityChange(): void {
    window.dispatchEvent(new Event(eventName));
}
export function observeActivityChanges(refresh: () => void): () => void {
    window.addEventListener(eventName, refresh);
    return () => window.removeEventListener(eventName, refresh);
}
