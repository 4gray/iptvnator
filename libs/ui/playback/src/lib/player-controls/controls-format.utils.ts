export function formatTime(value: number | null | undefined): string {
    const safeValue = Math.max(0, Math.floor(value ?? 0));
    const hours = Math.floor(safeValue / 3600);
    const minutes = Math.floor((safeValue % 3600) / 60);
    const seconds = safeValue % 60;

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(
            seconds
        ).padStart(2, '0')}`;
    }

    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function volumeIcon(value: number): string {
    if (value <= 0) {
        return 'volume_off';
    }
    return value < 0.5 ? 'volume_down' : 'volume_up';
}

export function volumeLabel(value: number): string {
    return `Volume ${Math.round(value * 100)}%`;
}

/** Rounds and formats a playback rate as e.g. `1.5×` for tooltips. */
export function speedLabel(speed: number): string {
    const value = Math.round(speed * 100) / 100;
    return `${value}×`;
}

export function readStoredVolume(): number {
    const rawValue = Number(localStorage.getItem('volume') ?? '1');
    if (Number.isNaN(rawValue)) {
        return 1;
    }
    return Math.max(0, Math.min(1, rawValue));
}

export function persistVolume(value: number): void {
    localStorage.setItem('volume', String(value));
}
