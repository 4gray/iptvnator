import { AppConfig } from '../../../environments/environment';

export interface Logger {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
}

export function createLogger(scope: string): Logger {
    const prefix = `[${scope}]`;
    const debugEnabled = !AppConfig.production;

    return {
        debug: (...args: unknown[]) => {
            if (debugEnabled) {
                console.debug(prefix, ...args);
            }
        },
        info: (...args: unknown[]) => {
            if (debugEnabled) {
                console.info(prefix, ...args);
            }
        },
        warn: (...args: unknown[]) => {
            console.warn(prefix, ...args);
        },
        error: (...args: unknown[]) => {
            console.error(prefix, ...args);
        },
    };
}
