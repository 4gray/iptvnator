/** Preserve playlist syntax while replacing catalog metadata with synthetic values. */
export function syntheticFixture(content) {
    const labels = new Map();
    const word = (value) => {
        if (/^S\d+E\d+$/i.test(value)) return value;
        if (!labels.has(value)) labels.set(value, labels.size + 1);
        return (/[^\x00-\x7f]/.test(value) ? 'Синтетический' : 'Synthetic') + labels.get(value);
    };
    const label = (value) => value.replace(/&(?:amp|quot|apos|lt|gt|nbsp);|[\p{L}][\p{L}\p{N}]*/gu,
        (part) => part.startsWith('&') ? part : word(part));
    const urls = content.replace(/\b[a-z][a-z\d+.-]*:\/\/[^\s"'|]+/gi, (value) => {
        try {
            const url = new URL(value);
            if (/[a-z]/i.test(url.hostname)) url.hostname = 'synthetic.example';
            url.username = url.username ? 'synthetic-user' : '';
            url.password = url.password ? 'synthetic-secret' : '';
            url.pathname = url.pathname.split('/').map((part) => {
                if (!part || /^\d+$/.test(part)) return part;
                const extension = part.match(/\.[a-z\d]+$/i)?.[0] || '';
                return word(part) + extension;
            }).join('/');
            for (const [key, item] of url.searchParams) {
                if (item && !/^\d+$/.test(item) && !item.includes('${')) {
                    url.searchParams.set(key, item.length > 256 ? 'e'.repeat(item.length) : word(item));
                }
            }
            url.hash = '';
            return url.href;
        } catch {
            return value;
        }
    });
    const metadata = urls.replace(/^([ \t]*)(#EXTINF:[^\r\n]*|#EXTGRP:[^\r\n]*)/gmi, (_, indent, line) => {
        const attributes = line.replace(/((?:tvg-id|tvg-name|group-title)\s*=\s*")([^"]*)(")/gi,
            (_, before, value, after) => before + label(value) + after);
        if (/^#EXTGRP:/i.test(attributes)) return indent + '#EXTGRP:' + label(attributes.slice(8));
        let quoted = false;
        for (let i = 0; i < attributes.length; i++) {
            if (attributes[i] === '"') quoted = !quoted;
            if (attributes[i] === ',' && !quoted) return indent + attributes.slice(0, i + 1) + label(attributes.slice(i + 1));
        }
        // The reference parser treats the first comma after an unclosed attribute as the name boundary.
        const comma = attributes.indexOf(',');
        return indent + (quoted && comma >= 0 ? attributes.slice(0, comma + 1) + label(attributes.slice(comma + 1)) : attributes);
    });
    return metadata.replace(/^[^\r\n]+/gm, (line) => {
        const text = line.trim();
        if (!text || /^[#|]/.test(text) || /^[a-z][a-z\d+.-]*:\/\//i.test(text)) return line;
        return label(line);
    });
}
