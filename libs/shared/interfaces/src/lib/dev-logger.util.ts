export type DevLogFn = (...args: unknown[]) => void;

function isDevLoggingEnabled(): boolean {
    const global = globalThis as typeof globalThis & {
        ngDevMode?: boolean;
        process?: { env?: { NODE_ENV?: string } };
    };

    return (
        global.ngDevMode !== false && global.process?.env?.NODE_ENV !== 'test'
    );
}

export function createDevLogger(scope: string): DevLogFn {
    const prefix = `[${scope}]`;

    return (...args: unknown[]) => {
        if (isDevLoggingEnabled()) {
            console.debug(prefix, ...args);
        }
    };
}
