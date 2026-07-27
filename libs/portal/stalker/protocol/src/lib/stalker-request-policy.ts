import {
    STALKER_APPLICATION_OPERATIONS,
    STALKER_MANAGED_REQUEST_HEADERS,
    STALKER_RESERVED_REQUEST_PARAMETERS,
} from './stalker-protocol.constants';

export { STALKER_APPLICATION_OPERATIONS };

interface StalkerApplicationRequestInput {
    operation: string;
    parameters: Readonly<Record<string, unknown>>;
    headers?: Readonly<Record<string, string>>;
}

interface StalkerRequestAccepted {
    kind: 'accepted';
}

interface StalkerRequestRejected {
    kind: 'rejected';
    reason:
        | 'unsupported-operation'
        | 'reserved-parameter'
        | 'reserved-header';
    field?: string;
}

const APPLICATION_OPERATION_SET = new Set<string>(
    Object.values(STALKER_APPLICATION_OPERATIONS)
);
const RESERVED_PARAMETER_SET = new Set<string>(
    STALKER_RESERVED_REQUEST_PARAMETERS
);
const MANAGED_HEADER_SET = new Set<string>(STALKER_MANAGED_REQUEST_HEADERS);

export function validateStalkerApplicationRequest(
    input: StalkerApplicationRequestInput
): StalkerRequestAccepted | StalkerRequestRejected {
    if (!APPLICATION_OPERATION_SET.has(input.operation)) {
        return { kind: 'rejected', reason: 'unsupported-operation' };
    }

    for (const parameter of Object.keys(input.parameters)) {
        if (RESERVED_PARAMETER_SET.has(parameter.toLowerCase())) {
            return {
                field: parameter,
                kind: 'rejected',
                reason: 'reserved-parameter',
            };
        }
    }

    for (const header of Object.keys(input.headers ?? {})) {
        if (MANAGED_HEADER_SET.has(header.toLowerCase())) {
            return {
                field: header,
                kind: 'rejected',
                reason: 'reserved-header',
            };
        }
    }

    return { kind: 'accepted' };
}
