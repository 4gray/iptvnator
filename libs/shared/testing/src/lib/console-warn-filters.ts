export function installDuplicateVideoJsQualityLevelsWarnFilter(): void {
    const originalConsoleWarn = console.warn.bind(console);

    console.warn = (...args: unknown[]) => {
        const message = args
            .filter((arg): arg is string => typeof arg === 'string')
            .join(' ');

        if (isDuplicateVideoJsQualityLevelsWarning(message)) {
            return;
        }

        originalConsoleWarn(...args);
    };
}

function isDuplicateVideoJsQualityLevelsWarning(message: string): boolean {
    return message.includes('A plugin named "qualityLevels" already exists.');
}
