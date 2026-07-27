function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isCpuProfile(value: unknown): boolean {
    if (!isRecord(value)) {
        return false;
    }
    const startTime = value['startTime'];
    const endTime = value['endTime'];
    const nodes = value['nodes'];
    const samples = value['samples'];
    const timeDeltas = value['timeDeltas'];
    if (
        !isNonNegativeSafeInteger(startTime) ||
        !isNonNegativeSafeInteger(endTime) ||
        endTime <= startTime ||
        !Array.isArray(nodes) ||
        nodes.length === 0 ||
        !Array.isArray(samples) ||
        samples.length === 0 ||
        !Array.isArray(timeDeltas) ||
        timeDeltas.length !== samples.length
    ) {
        return false;
    }

    const nodeIds = new Set<number>();
    for (const node of nodes) {
        if (!isCpuProfileNode(node) || nodeIds.has(node['id'])) {
            return false;
        }
        nodeIds.add(node['id']);
    }
    if (
        nodes.some((node) =>
            (node as Record<string, unknown>)['children'] instanceof Array
                ? (
                      (node as Record<string, unknown>)[
                          'children'
                      ] as unknown[]
                  ).some(
                      (childId) =>
                          !isNonNegativeSafeInteger(childId) ||
                          !nodeIds.has(childId)
                  )
                : false
        ) ||
        samples.some(
            (sampleId) =>
                !isNonNegativeSafeInteger(sampleId) ||
                !nodeIds.has(sampleId)
        )
    ) {
        return false;
    }

    const duration = endTime - startTime;
    let elapsed = 0;
    for (const delta of timeDeltas) {
        if (!Number.isSafeInteger(delta)) {
            return false;
        }
        elapsed += delta as number;
        if (
            !Number.isSafeInteger(elapsed) ||
            elapsed < 0 ||
            elapsed > duration
        ) {
            return false;
        }
    }
    return elapsed > 0;
}

export function readCpuProfileDurationMicros(value: unknown): number | null {
    if (!isCpuProfile(value)) {
        return null;
    }
    const profile = value as Record<string, number>;
    return profile['endTime'] - profile['startTime'];
}

export function isHeapSnapshot(value: unknown): boolean {
    if (
        !isRecord(value) ||
        !isRecord(value['snapshot']) ||
        !isRecord(value['snapshot']['meta'])
    ) {
        return false;
    }
    const meta = value['snapshot']['meta'];
    const nodeFields = meta['node_fields'];
    const nodeTypes = meta['node_types'];
    const edgeFields = meta['edge_fields'];
    const edgeTypes = meta['edge_types'];
    const nodes = value['nodes'];
    const edges = value['edges'];
    const strings = value['strings'];
    return (
        isNonEmptyStringArray(nodeFields) &&
        isHeapTypeTable(nodeTypes, nodeFields.length) &&
        isNonEmptyStringArray(edgeFields) &&
        isHeapTypeTable(edgeTypes, edgeFields.length) &&
        Array.isArray(nodes) &&
        nodes.length > 0 &&
        nodes.length % nodeFields.length === 0 &&
        Array.isArray(edges) &&
        edges.length > 0 &&
        edges.length % edgeFields.length === 0 &&
        Array.isArray(strings) &&
        strings.length > 0
    );
}

export function isRendererTrace(value: unknown): boolean {
    if (!isRecord(value)) {
        return false;
    }
    const events = value['traceEvents'];
    return (
        Array.isArray(events) &&
        events.length > 0 &&
        events.every(
            (event) =>
                isRecord(event) &&
                isNonEmptyString(event['name']) &&
                isNonEmptyString(event['ph']) &&
                isNonNegativeFiniteNumber(event['ts'])
        )
    );
}

function isHeapTypeTable(value: unknown, fieldCount: number): boolean {
    return (
        Array.isArray(value) &&
        value.length === fieldCount &&
        value.every(
            (entry) =>
                isNonEmptyString(entry) || isNonEmptyStringArray(entry)
        )
    );
}

function isCpuProfileNode(
    value: unknown
): value is Record<string, unknown> & { readonly id: number } {
    if (
        !isRecord(value) ||
        !isNonNegativeSafeInteger(value['id']) ||
        !isRecord(value['callFrame'])
    ) {
        return false;
    }
    const callFrame = value['callFrame'];
    const scriptId = callFrame['scriptId'];
    const children = value['children'];
    const hitCount = value['hitCount'];
    return (
        typeof callFrame['functionName'] === 'string' &&
        (typeof scriptId === 'string' ||
            isNonNegativeSafeInteger(scriptId)) &&
        typeof callFrame['url'] === 'string' &&
        Number.isSafeInteger(callFrame['lineNumber']) &&
        Number.isSafeInteger(callFrame['columnNumber']) &&
        (children === undefined ||
            (Array.isArray(children) &&
                children.every(isNonNegativeSafeInteger))) &&
        (hitCount === undefined || isNonNegativeSafeInteger(hitCount))
    );
}

function isNonEmptyStringArray(value: unknown): value is readonly string[] {
    return (
        Array.isArray(value) &&
        value.length > 0 &&
        value.every(isNonEmptyString)
    );
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
    return (
        typeof value === 'number' && Number.isFinite(value) && value >= 0
    );
}
