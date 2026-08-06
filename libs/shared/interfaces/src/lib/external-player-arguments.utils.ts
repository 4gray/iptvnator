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

export interface EmbeddedMpvExtraOption {
    key: string;
    value: string;
}

const EMBEDDED_MPV_OPTION_LINE = /^[a-zA-Z0-9][a-zA-Z0-9-]*=.+$/;

export function parseEmbeddedMpvExtraOptions(
    value: ExternalPlayerArgumentsInput
): EmbeddedMpvExtraOption[] {
    return parseExternalPlayerArguments(value)
        .filter((line) => EMBEDDED_MPV_OPTION_LINE.test(line))
        .map((line) => {
            const separatorIndex = line.indexOf('=');
            return {
                key: line.slice(0, separatorIndex).trim(),
                value: line.slice(separatorIndex + 1).trim(),
            };
        })
        .filter((pair) => pair.key.length > 0);
}

export function normalizeEmbeddedMpvExtraOptions(
    value: ExternalPlayerArgumentsInput
): string {
    return parseEmbeddedMpvExtraOptions(value)
        .map((pair) => `${pair.key}=${pair.value}`)
        .join('\n');
}
