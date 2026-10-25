/** Retires queued imports as well as workers already parsing a removed URL. */
let nextGeneration = 0;
let globalGeneration = 0;
const generations = new Map<string, number>();
const requests = new Map<string, symbol>();
export function epgSourceGeneration(url: string): number {
    return Math.max(globalGeneration, generations.get(url.trim()) ?? 0);
}
export function requestEpgSource(url: string): number {
    requests.set(url.trim(), Symbol());
    return epgSourceGeneration(url);
}
export function retireEpgSource(url: string): void {
    generations.set(url.trim(), ++nextGeneration);
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

/** Also fences freshness reads and batches that have not started a worker. */
export function retireAllEpgSources(): void {
    globalGeneration = ++nextGeneration;
}
