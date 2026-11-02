import { EpgChannelMetadataLookup } from './epg-channel-metadata.lookup';
import { EpgCurrentProgramsLookup } from './epg-current-programs.lookup';
import { EpgScopedBatchLookup } from './epg-scoped-batch.lookup';
import { EpgSingleProgramLookup } from './epg-single-program.lookup';
import type { EpgLookupContext } from './epg-lookup-context';

/** Read helpers load on demand; importing guide sources does not need them. */
export function createEpgLookups(context: EpgLookupContext) {
    const single = new EpgSingleProgramLookup(context);
    return {
        single,
        current: new EpgCurrentProgramsLookup(
            context,
            single,
            new EpgScopedBatchLookup(context)
        ),
        metadata: new EpgChannelMetadataLookup(
            context.bridge,
            context.guard,
            context.globalSourceUrls
        ),
    };
}

export type EpgLookups = ReturnType<typeof createEpgLookups>;
