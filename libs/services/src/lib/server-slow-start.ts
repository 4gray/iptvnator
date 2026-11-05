/**
 * A page started from memory reloads once the server answers
 * (`ServerStorageSession`), but a server slower than the start probe would
 * time it out again and reload forever: the reloaded page's probe waits as
 * long as requests do, once.
 */
const SLOW_START_KEY = 'iptvnator-server:slow-start';

export function markSlowStart(): void {
    try {
        sessionStorage.setItem(SLOW_START_KEY, '1');
    } catch {
        // Without session storage the next probe keeps its short wait.
    }
}

/** Whether this page load follows such a reload; asks only once. */
export function takeSlowStart(): boolean {
    try {
        const slow = sessionStorage.getItem(SLOW_START_KEY) !== null;
        sessionStorage.removeItem(SLOW_START_KEY);
        return slow;
    } catch {
        return false;
    }
}
