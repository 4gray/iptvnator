import { isIP } from 'node:net';

/** Preserve playlist syntax while replacing catalog metadata and provider URLs. */
export function syntheticFixture(content) {
    const labels = new Map();
    const word = (value) => {
        if (!labels.has(value)) labels.set(value, labels.size + 1);
        if (/^\d+$/.test(value)) return String(900_000_000 + labels.get(value));
        return (/[^\x00-\x7f]/.test(value) ? 'Синтетический' : 'Synthetic') + labels.get(value);
    };
    const label = (value) => /^\d+$/.test(value) ? word(value) : value.replace(
        /&(?:amp|quot|apos|lt|gt|nbsp);|[\p{L}][\p{L}\p{N}]*/gu,
        (part) => part.startsWith('&') || /^S\d+E\d+$/i.test(part) ? part : word(part));
    const urls = content.replace(/\b[a-z][a-z\d+.-]*:\/\/[^\s"|<>]+/gi, (value) => {
        const url = URL.parse(value);
        if (!url) throw new Error('Fixture contains an invalid URL');
        if (url.hostname.startsWith('[')) url.hostname = '[2001:db8::1]';
        else if (isIP(url.hostname) === 4) url.hostname = '192.0.2.1';
        else url.hostname = 'synthetic.example';
        url.username = url.username ? 'synthetic-user' : '';
        url.password = url.password ? 'synthetic-secret' : '';
        url.pathname = url.pathname.split('/').map((part) => {
            if (!part) return part;
            const extension = part.match(/\.(?:aac|gif|jpe?g|m3u8?|m4[as]|mkv|mp4|mpd|php|png|svg|ts|webp|xml)$/i)?.[0] || '';
            return word(part) + extension;
        }).join('/');
        const params = new URLSearchParams();
        for (const [key, item] of url.searchParams) {
            let replacement = item;
            if (item && !/^\$\{[\w-]+\}$/.test(item)) {
                replacement = item.length > 256 ? 'e'.repeat(item.length) : word(item);
            }
            const name = /^(?:jwt|token|user-agent)$/i.test(key) ? key : word(key);
            params.append(name, replacement);
        }
        url.search = params.toString();
        url.hash = '';
        return url.href;
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
