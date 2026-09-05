/** Retires queued imports as well as workers already parsing a removed URL. */
const generations = new Map<string, number>();
export function epgSourceGeneration(url: string): number {
    const key = url.trim();
    if (!generations.has(key)) generations.set(key, 0);
    return generations.get(key)!;
}
export function retireEpgSource(url: string): void {
    generations.set(url.trim(), epgSourceGeneration(url) + 1);
}
export function requestedEpgSources(): string[] {
    return [...generations.keys()];
}
