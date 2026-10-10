/**
 * Maps a position in a string or template literal's cooked text (what
 * `literal.text` returns) to its line in the source file. Escapes such as
 * `\n` or `\u{…}`, line continuations and CRLF make the cooked text differ
 * from the source, so counting the cooked newlines would point at the wrong
 * line, possibly outside the component.
 */
export function literalLineResolver(literal, sourceFile) {
    const contentStart = literal.getStart(sourceFile) + 1;
    const raw = sourceFile.text.slice(contentStart, literal.getEnd() - 1);
    const rawOffsets = cookedToRawOffsets(raw);
    const lineAt = (position) =>
        sourceFile.getLineAndCharacterOfPosition(position).line;

    if (rawOffsets.length !== literal.text.length + 1) {
        // An escape this mapping does not model: keep to the first line.
        const startLine = lineAt(contentStart);
        return () => startLine;
    }
    return (offset) =>
        lineAt(
            contentStart +
                rawOffsets[Math.min(Math.max(offset, 0), rawOffsets.length - 1)]
        );
}

/** Offset in `raw` of each cooked UTF-16 unit, plus the end offset. */
function cookedToRawOffsets(raw) {
    const offsets = [];
    let index = 0;
    while (index < raw.length) {
        if (raw[index] === '\r' && raw[index + 1] === '\n') {
            // A template literal cooks CRLF to one LF.
            offsets.push(index);
            index += 2;
        } else if (raw[index] !== '\\') {
            offsets.push(index);
            index += 1;
        } else {
            const { length, units } = escapeAt(raw, index);
            for (let unit = 0; unit < units; unit += 1) {
                offsets.push(index);
            }
            index += length;
        }
    }
    offsets.push(raw.length);
    return offsets;
}

/** Source length and cooked UTF-16 length of the escape at `index`. */
function escapeAt(raw, index) {
    const next = raw[index + 1];
    if (next === '\r') {
        // Line continuation: nothing reaches the cooked text.
        return { length: raw[index + 2] === '\n' ? 3 : 2, units: 0 };
    }
    if (next === '\n' || next === ' ' || next === ' ') {
        return { length: 2, units: 0 };
    }
    if (next === 'x') {
        return { length: 4, units: 1 };
    }
    if (next === 'u' && raw[index + 2] === '{') {
        const close = raw.indexOf('}', index);
        const codePoint = parseInt(raw.slice(index + 3, close), 16);
        return { length: close - index + 1, units: codePoint > 0xffff ? 2 : 1 };
    }
    if (next === 'u') {
        return { length: 6, units: 1 };
    }
    return { length: 2, units: 1 };
}
