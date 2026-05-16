import {
    decodeTextBytes,
    normalizeTextValuesDeep,
    repairMojibakeText,
} from './text-encoding.utils';

describe('text encoding utilities', () => {
    it('keeps valid UTF-8 text with accented characters intact', () => {
        const bytes = new TextEncoder().encode('Cinema, città e qualità');

        expect(decodeTextBytes(bytes)).toBe('Cinema, città e qualità');
    });

    it('decodes Windows-1252 payloads when the charset is declared', () => {
        const bytes = new Uint8Array([
            0x41, 0x7a, 0x69, 0x6f, 0x6e, 0x65, 0x20, 0x65, 0x20, 0xe8,
            0x6c, 0x69, 0x74, 0x65, 0x20, 0x96, 0x20, 0x63, 0x69, 0x6e,
            0x65, 0x6d, 0x61,
        ]);

        expect(decodeTextBytes(bytes, 'text/plain; charset=windows-1252')).toBe(
            'Azione e èlite – cinema'
        );
    });

    it('repairs common UTF-8 decoded as Windows-1252 mojibake', () => {
        expect(repairMojibakeText('Film per bambini e cittÃ ')).toBe(
            'Film per bambini e città'
        );
        expect(repairMojibakeText('Lâ€™ultimo film')).toBe('L’ultimo film');
    });

    it('normalizes strings inside nested API payloads', () => {
        expect(
            normalizeTextValuesDeep({
                categories: [
                    {
                        category_name: 'IT - NovitÃ ',
                        nested: { title: 'QualitÃ  4K' },
                    },
                ],
            })
        ).toEqual({
            categories: [
                {
                    category_name: 'IT - Novità',
                    nested: { title: 'Qualità 4K' },
                },
            ],
        });
    });
});
