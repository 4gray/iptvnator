/** Retires queued imports as well as workers already parsing a removed URL. */
const generations = new Map<string, number>();
const requests = new Map<string, symbol>();
export function epgSourceGeneration(url: string): number {
    return generations.get(url.trim()) ?? 0;
}
export function requestEpgSource(url: string): number {
    requests.set(url.trim(), Symbol());
    return epgSourceGeneration(url);
}
export function retireEpgSource(url: string): void {
    generations.set(url.trim(), epgSourceGeneration(url) + 1);
}
export function requestedEpgSources(): Map<string, symbol> {
    return new Map(requests);
}
export function forgetEpgSourceRequest(
    url: string,
    request: symbol | undefined
): void {
    // A request received during cleanup still needs reconciliation next time.
    if (requests.get(url.trim()) === request) requests.delete(url.trim());
}
