/**
 * Serial depth of the bridge calls on the way to a journey's end
 * (`renderer.ipcSerialDepthToFirstCard`, see performance-journeys.md).
 *
 * Input is the capture's timeline: one `start` per bridge invocation and one
 * `end` per completion, in the order the renderer sent them. The preload
 * sends a call's completion before the caller's continuation runs, and
 * renderer-to-main IPC is ordered, so a call that the renderer issued
 * because another one resolved always appears after that call's `end`.
 *
 * The depth of a call is 1 + the largest depth of the calls that ended
 * before it started. The serial depth is the largest depth among calls that
 * ended within the timeline: the length of the longest chain in which each
 * call started after the previous one completed. Calls still in flight at the
 * end of the timeline are excluded; the journey's end did not wait for them.
 *
 * Trace events carry no call id. When several calls of one method are in
 * flight, a completion is attributed to the deepest of them (`depth`) and,
 * in a second pass, to the shallowest (`depthLowerBound`). The two agree
 * unless concurrent calls of one method sit at different depths.
 *
 * `chain` follows one longest chain back from its last call; at each step
 * the predecessor is the latest completion at the largest depth before the
 * call started. It shows which methods form the chain, not causality: the
 * timeline cannot tell which completion a start actually waited for.
 */
export interface JourneyIpcTimelineEvent {
    readonly method: string;
    readonly phase: 'end' | 'start';
}

export interface JourneyIpcSerialDepth {
    /** Methods of one longest chain, first call first. */
    readonly chain: readonly string[];
    readonly depth: number;
    readonly depthLowerBound: number;
    /** Calls started within the timeline that had not completed at its end. */
    readonly inFlightAtEnd: number;
}

interface TimelineCall {
    readonly depth: number;
    readonly method: string;
    readonly parent: TimelineCall | null;
}

type Attribution = 'deepest' | 'shallowest';

function walk(
    timeline: readonly JourneyIpcTimelineEvent[],
    attribution: Attribution
): { deepest: TimelineCall | null; inFlight: number } {
    const inFlight = new Map<string, TimelineCall[]>();
    let deepest: TimelineCall | null = null;
    let inFlightCount = 0;
    for (const event of timeline) {
        const pending = inFlight.get(event.method) ?? [];
        if (event.phase === 'start') {
            pending.push({
                depth: (deepest?.depth ?? 0) + 1,
                method: event.method,
                parent: deepest,
            });
            inFlight.set(event.method, pending);
            inFlightCount += 1;
            continue;
        }
        if (pending.length === 0) {
            throw new Error(
                `journey-ipc-serial-depth-unmatched-end:${event.method}`
            );
        }
        let chosen = 0;
        for (let index = 1; index < pending.length; index += 1) {
            const better =
                attribution === 'deepest'
                    ? pending[index].depth > pending[chosen].depth
                    : pending[index].depth < pending[chosen].depth;
            if (better) {
                chosen = index;
            }
        }
        const [call] = pending.splice(chosen, 1);
        inFlightCount -= 1;
        // Ties go to the latest completion: the call a later start most
        // plausibly waited on, which is what `chain` reports.
        if (deepest === null || call.depth >= deepest.depth) {
            deepest = call;
        }
    }
    return { deepest, inFlight: inFlightCount };
}

export function computeJourneyIpcSerialDepth(
    timeline: readonly JourneyIpcTimelineEvent[]
): JourneyIpcSerialDepth {
    const upper = walk(timeline, 'deepest');
    const lower = walk(timeline, 'shallowest');
    const chain: string[] = [];
    for (let call = upper.deepest; call !== null; call = call.parent) {
        chain.unshift(call.method);
    }
    return Object.freeze({
        chain: Object.freeze(chain),
        depth: upper.deepest?.depth ?? 0,
        depthLowerBound: lower.deepest?.depth ?? 0,
        inFlightAtEnd: upper.inFlight,
    });
}
