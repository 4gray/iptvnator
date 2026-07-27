interface ActiveXtreamRequest {
    readonly controller: AbortController;
    readonly sessionId?: string;
}

interface XtreamCancellationResult {
    readonly cancelled: number;
    readonly success: boolean;
}

export function cancelXtreamSessionRequests(
    activeRequests: Iterable<ActiveXtreamRequest>,
    sessionId: string
): XtreamCancellationResult {
    if (!sessionId) {
        return { success: false, cancelled: 0 };
    }
    let cancelled = 0;
    for (const activeRequest of activeRequests) {
        if (activeRequest.sessionId === sessionId) {
            activeRequest.controller.abort();
            cancelled += 1;
        }
    }
    return { success: cancelled > 0, cancelled };
}
