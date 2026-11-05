import type { UserData } from '@iptvnator/tv/util';

export function createSourceSwitcher(options: {
    stop: () => void;
    update: (change: (data: UserData) => UserData) => Promise<void>;
    selected: () => void;
    clearError: (label: string) => void;
    setError: (message: string, retry?: () => void, label?: string) => void;
}) {
    return async function select(
        activeId: string,
        owns = () => true
    ): Promise<boolean> {
        if (!owns()) return false;
        options.stop();
        try {
            await options.update((data) => {
                if (!owns()) return data;
                if (!data.sources.some((source) => source.id === activeId))
                    throw new Error('Source unavailable');
                return { ...data, activeId };
            });
            if (!owns()) return false;
            options.clearError('Retry source selection');
            options.selected();
            return true;
        } catch {
            if (owns())
                options.setError(
                    'Source selection was not saved.',
                    () => void select(activeId),
                    'Retry source selection'
                );
            return false;
        }
    };
}
