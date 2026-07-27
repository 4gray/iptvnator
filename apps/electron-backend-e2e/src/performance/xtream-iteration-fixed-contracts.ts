import { XTREAM_ITERATION_KIND } from './xtream-benchmark-contract';
import { isExactRecord } from './xtream-exact-schema';
import { XTREAM_NOT_APPLICABLE } from './xtream-summary-contract';

export function assertXtreamFixedIterationContracts(
    raw: Record<string, unknown>
): void {
    const playlist = raw['playlistRefreshWorker'];
    const catalog = raw['catalogVerification'];
    const validity = raw['validity'];
    if (
        !isExactRecord(playlist, ['instantiated', 'reason']) ||
        playlist['instantiated'] !== false ||
        playlist['reason'] !== XTREAM_NOT_APPLICABLE.PLAYLIST_REFRESH_WORKER ||
        !isExactRecord(catalog, [
            'databaseStateValid',
            'fixtureIdentityValid',
            'providerCategoryCount',
            'providerItemCount',
            'verifiedAfterCapture',
        ]) ||
        ![
            catalog['databaseStateValid'],
            catalog['fixtureIdentityValid'],
            catalog['verifiedAfterCapture'],
        ].every((entry) => entry === true) ||
        catalog['providerCategoryCount'] !== 100 ||
        catalog['providerItemCount'] !== 100_000 ||
        !isExactRecord(validity, [
            'actionContractValid',
            'catalogContractValid',
            'databaseWorkerCount',
            'dbPhaseContractValid',
            'diagnosticArtifactsValid',
            'lateDatabaseRequestCount',
            'playlistWorkerCount',
            'rendererTargetCount',
        ]) ||
        ![
            validity['actionContractValid'],
            validity['catalogContractValid'],
            validity['dbPhaseContractValid'],
        ].every((entry) => entry === true) ||
        validity['databaseWorkerCount'] !== 1 ||
        validity['playlistWorkerCount'] !== 0 ||
        validity['rendererTargetCount'] !== 1 ||
        validity['lateDatabaseRequestCount'] !== 0 ||
        validity['diagnosticArtifactsValid'] !==
            (raw['kind'] === XTREAM_ITERATION_KIND.DIAGNOSTIC ? true : null)
    ) {
        throw new Error('invalid');
    }
}
