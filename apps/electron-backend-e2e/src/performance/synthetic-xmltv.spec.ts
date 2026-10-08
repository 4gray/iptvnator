import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { SYNTHETIC_TITLE_VOCABULARY } from './synthetic-charset';
import {
    createSyntheticXmltvFixture,
    SUPPORTED_SYNTHETIC_XMLTV_PROGRAMME_COUNTS,
    SYNTHETIC_XMLTV_PROGRAMME_COUNT,
    SYNTHETIC_XMLTV_PROGRAMMES_PER_CHANNEL,
} from './synthetic-xmltv';

const GOLDEN_SHA256 = {
    latin1: {
        10_000: 'e9d0ca0f7b73efc5cdee42cb2c4ee5bb4564b274b5042b13f8cd0d965d5011bc',
        50_000: '08b955c84822b7eb0d825a73eef6a6abc88b6d372c2dd32ad25d3969d667fd49',
        100_000:
            '932f0ba7089cab9e205a78142a245ebb497826ee7f1f4819603d77eba8e95a9e',
    },
    cyrillic: {
        10_000: '5b0df408e90c77bebe296fe1cc7e97cec5b929ebc7ad21b7480a6849a29f912b',
        50_000: 'bb1a0ca9fe874ab847b062c768868d76da750366aaa680bc712cb4cb7bfbf809',
        100_000:
            'cd637f4a25d47592116417a64bbb8c5b48d87f5bb5b0b4693f7af6c7603a8859',
    },
} as const;

describe('synthetic XMLTV performance fixture', () => {
    it('generates each supported schedule deterministically', () => {
        assert.deepEqual(
            SUPPORTED_SYNTHETIC_XMLTV_PROGRAMME_COUNTS,
            [10_000, 50_000, 100_000]
        );
        assert.equal(SYNTHETIC_XMLTV_PROGRAMME_COUNT, 50_000);

        for (const charset of ['latin1', 'cyrillic'] as const) {
            for (const programmeCount of SUPPORTED_SYNTHETIC_XMLTV_PROGRAMME_COUNTS) {
                const fixture = createSyntheticXmltvFixture(programmeCount, {
                    charset,
                });

                assert.equal(fixture.charset, charset);
                assert.equal(fixture.programmeCount, programmeCount);
                assert.equal(
                    fixture.channelCount,
                    programmeCount / SYNTHETIC_XMLTV_PROGRAMMES_PER_CHANNEL
                );
                assert.equal(
                    fixture.sha256,
                    GOLDEN_SHA256[charset][programmeCount]
                );
            }
        }
    });

    it('reports exact metadata and element counts', () => {
        for (const charset of ['latin1', 'cyrillic'] as const) {
            const fixture = createSyntheticXmltvFixture(10_000, { charset });

            assert.equal(
                fixture.bytes,
                Buffer.byteLength(fixture.body, 'utf8')
            );
            assert.equal(
                fixture.sha256,
                createHash('sha256').update(fixture.body, 'utf8').digest('hex')
            );
            assert.equal(countOf(fixture.body, '<channel '), 100);
            assert.equal(countOf(fixture.body, '<programme '), 10_000);
            assert.ok(fixture.body.startsWith('<?xml version="1.0"'));
            assert.ok(fixture.body.endsWith('</tv>\n'));
        }
    });

    it('defaults to 50k programmes with an ASCII-only latin1 body', () => {
        const fixture = createSyntheticXmltvFixture();

        assert.equal(fixture.charset, 'latin1');
        assert.equal(fixture.programmeCount, 50_000);
        // UTF-8 byte length equals UTF-16 length only for ASCII-only text.
        assert.equal(fixture.bytes, fixture.body.length);
    });

    it('keeps the cyrillic layout identical apart from titles', () => {
        const latin = createSyntheticXmltvFixture(10_000);
        const cyrillic = createSyntheticXmltvFixture(10_000, {
            charset: 'cyrillic',
        });
        const latinTitles = SYNTHETIC_TITLE_VOCABULARY.latin1;
        const cyrillicTitles = SYNTHETIC_TITLE_VOCABULARY.cyrillic;

        assert.equal(cyrillic.body.length, latin.body.length);
        const translated = [
            [cyrillicTitles.channel, latinTitles.channel],
            [cyrillicTitles.programme, latinTitles.programme],
            [
                `lang="${cyrillicTitles.language}"`,
                `lang="${latinTitles.language}"`,
            ],
        ].reduce(
            (text, [search, replacement]) =>
                text.split(search).join(replacement),
            cyrillic.body
        );
        assert.equal(translated, latin.body);
        const firstTitle = cyrillic.body.indexOf('<title lang="ru">');
        assert.ok(firstTitle > 0);
        assert.ok(
            cyrillic.body.charCodeAt(firstTitle + '<title lang="ru">'.length) >
                0xff
        );
    });

    it('schedules consecutive half-hour programmes per channel', () => {
        const lines = createSyntheticXmltvFixture(10_000).body.split('\n');
        const firstProgramme = lines.find((line) =>
            line.includes('<programme ')
        );

        assert.equal(
            firstProgramme,
            '  <programme start="20260101000000 +0000" stop="20260101003000 +0000" channel="synthetic.000001"><title lang="en">Synthetic Programme 000001-0001</title><desc lang="en">Synthetic description for slot 1.</desc><category lang="en">Synthetic</category></programme>'
        );
        assert.ok(
            lines.includes(
                '  <programme start="20260103013000 +0000" stop="20260103020000 +0000" channel="synthetic.000100"><title lang="en">Synthetic Programme 000100-0100</title><desc lang="en">Synthetic description for slot 100.</desc><category lang="en">Synthetic</category></programme>'
            )
        );
    });

    it('rejects unsupported programme counts and charsets', () => {
        assert.throws(
            () => createSyntheticXmltvFixture(12_345),
            /Unsupported synthetic XMLTV programme count/
        );
        assert.throws(
            () =>
                createSyntheticXmltvFixture(10_000, {
                    charset: 'arabic' as never,
                }),
            /Unsupported synthetic charset/
        );
    });
});

function countOf(body: string, needle: string): number {
    let count = 0;
    for (
        let index = body.indexOf(needle);
        index !== -1;
        index = body.indexOf(needle, index + needle.length)
    ) {
        count += 1;
    }
    return count;
}
