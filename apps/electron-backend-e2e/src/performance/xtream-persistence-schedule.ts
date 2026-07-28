import type { XtreamValidatedIterationResult } from './xtream-summary-contract';

export function assertUniqueXtreamPersistencePaths(
    iterations: readonly XtreamValidatedIterationResult[]
): void {
    const paths = new Set<string>();
    for (const iteration of iterations) {
        const path = iteration.persistence.pathSha256;
        if (paths.has(path)) {
            throw new Error(
                'Xtream benchmark requires a unique raw persistence path per iteration'
            );
        }
        paths.add(path);
    }
}
