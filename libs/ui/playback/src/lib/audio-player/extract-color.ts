/**
 * Extracts the most vibrant dominant color from an image URL.
 *
 * Loads the image in a separate Image object with crossOrigin="anonymous"
 * so the canvas isn't tainted. If the server doesn't support CORS,
 * the extraction silently fails and returns null.
 *
 * Returns a promise that resolves to an `rgb(r, g, b)` string or `null`.
 */
export function extractDominantColor(url: string): Promise<string | null> {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(sampleColor(img));
        img.onerror = () => resolve(null);
        img.src = url;
    });
}

function sampleColor(img: HTMLImageElement): string | null {
    try {
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return null;

        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);

        // Bucket pixels into a 4x4x4 colour grid (64 buckets),
        // then pick the most frequent bucket with enough saturation.
        const buckets = new Map<
            number,
            { r: number; g: number; b: number; count: number }
        >();

        for (let i = 0; i < data.length; i += 16) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3];
            if (a < 128) continue;

            const lum = r * 0.299 + g * 0.587 + b * 0.114;
            if (lum < 30 || lum > 230) continue;

            const key = ((r >> 6) << 4) | ((g >> 6) << 2) | (b >> 6);
            const existing = buckets.get(key);
            if (existing) {
                existing.r += r;
                existing.g += g;
                existing.b += b;
                existing.count++;
            } else {
                buckets.set(key, { r, g, b, count: 1 });
            }
        }

        if (buckets.size === 0) return null;

        let best: { r: number; g: number; b: number; count: number } | null =
            null;
        let bestScore = 0;

        for (const bucket of buckets.values()) {
            const avg = {
                r: bucket.r / bucket.count,
                g: bucket.g / bucket.count,
                b: bucket.b / bucket.count,
            };
            const max = Math.max(avg.r, avg.g, avg.b);
            const min = Math.min(avg.r, avg.g, avg.b);
            const saturation = max === 0 ? 0 : (max - min) / max;
            const score = bucket.count * (0.3 + saturation * 0.7);

            if (score > bestScore) {
                bestScore = score;
                best = bucket;
            }
        }

        if (!best) return null;

        const r = Math.round(best.r / best.count);
        const g = Math.round(best.g / best.count);
        const b = Math.round(best.b / best.count);

        return `rgb(${r}, ${g}, ${b})`;
    } catch {
        return null;
    }
}
