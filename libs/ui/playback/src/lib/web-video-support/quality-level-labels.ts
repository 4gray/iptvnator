/** Rendition facts an engine can report for one quality level. */
export interface QualityLevelFacts {
    height?: number | null;
    width?: number | null;
    bitrate?: number | null;
}

/**
 * Builds display labels for a source's quality levels, shared by the hls.js,
 * Shaka, and Video.js quality projections so every engine renders the same
 * vocabulary: "1080p" from the frame height, a bitrate ("4.5 Mbps") when no
 * dimension is known, and a positional fallback otherwise. When two levels
 * would collide on the same base label (same height at different bitrates),
 * every colliding label carries its bitrate as a disambiguating suffix.
 */
export function buildQualityLevelLabels(
    levels: readonly QualityLevelFacts[]
): string[] {
    const baseLabels = levels.map((level, index) => baseLabel(level, index));
    const occurrences = new Map<string, number>();
    for (const label of baseLabels) {
        occurrences.set(label, (occurrences.get(label) ?? 0) + 1);
    }

    return baseLabels.map((label, index) => {
        if ((occurrences.get(label) ?? 0) <= 1) {
            return label;
        }
        const bitrate = formatBitrate(levels[index]?.bitrate);
        return bitrate ? `${label} (${bitrate})` : label;
    });
}

function baseLabel(level: QualityLevelFacts, index: number): string {
    const height = readPositive(level.height);
    if (height !== null) {
        return `${height}p`;
    }

    // Height can be absent while width survives (some panels only fill
    // RESOLUTION partially); a 16:9 projection is close enough for a label.
    const width = readPositive(level.width);
    if (width !== null) {
        return `${Math.round((width * 9) / 16)}p`;
    }

    return formatBitrate(level.bitrate) ?? `Level ${index + 1}`;
}

function formatBitrate(bitrate: number | null | undefined): string | null {
    const value = readPositive(bitrate);
    if (value === null) {
        return null;
    }
    if (value >= 1_000_000) {
        const mbps = value / 1_000_000;
        const rendered = mbps >= 10 ? Math.round(mbps).toString() : mbps.toFixed(1);
        return `${rendered} Mbps`;
    }
    return `${Math.round(value / 1000)} kbps`;
}

function readPositive(value: number | null | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.round(value)
        : null;
}
