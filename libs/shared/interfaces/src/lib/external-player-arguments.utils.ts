export type ExternalPlayerArgumentsInput =
    | string
    | readonly unknown[]
    | null
    | undefined;

export function parseExternalPlayerArguments(
    value: ExternalPlayerArgumentsInput
): string[] {
    if (Array.isArray(value)) {
        return value.map((argument) => String(argument).trim()).filter(Boolean);
    }

    if (typeof value !== 'string') {
        return [];
    }

    return value
        .split(/\r?\n/)
        .map((argument) => argument.trim())
        .filter(Boolean);
}

export function normalizeExternalPlayerArguments(
    value: ExternalPlayerArgumentsInput
): string {
    return parseExternalPlayerArguments(value).join('\n');
}
