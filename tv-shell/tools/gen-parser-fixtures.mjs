#!/usr/bin/env node
/**
 * Generates the M3U parser fixtures used by the Android JVM unit tests:
 * every input is run through the real iptv-playlist-parser fork (the one
 * IPTVnator bundles) and the JSON result becomes the expected output of the
 * Java port.
 *
 *   node tools/gen-parser-fixtures.mjs --parser ../iptv-playlist-parser
 */
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def) => {
    const i = args.indexOf(name);
    return i === -1 ? def : args[i + 1];
};
function findParserDir() {
    const candidates = [
        opt('--parser', null),
        join(__dirname, '..', '..', 'node_modules', 'iptv-playlist-parser'),
        join(__dirname, '..', '..', 'iptv-playlist-parser'),
    ].filter(Boolean);
    for (const candidate of candidates) if (existsSync(join(candidate, 'src', 'index.js'))) return resolve(candidate);
    throw new Error('iptv-playlist-parser not found; pass --parser <dir> (pnpm install in the IPTVnator repo, or git clone https://github.com/4gray/iptv-playlist-parser)');
}
const PARSER_DIR = findParserDir();
const OUT = resolve(opt('--out', join(__dirname, '..', 'android', 'backend', 'src', 'test', 'resources', 'm3u-fixtures')));
const parser = require(join(PARSER_DIR, 'src', 'index.js'));
mkdirSync(OUT, { recursive: true });

const inputs = {};
// 1. the fork's own test playlists
const inputDir = join(PARSER_DIR, 'tests', '__data__', 'input');
for (const file of readdirSync(inputDir)) {
    if (file.endsWith('.m3u')) inputs['repo_' + file.replace(/\.m3u$/, '')] = readFileSync(join(inputDir, file), 'utf8');
}
// 2. the edge cases from tests/edge-cases.test.js, plus IPTVnator's contract spec
const bigJwt = 'e'.repeat(2100);
Object.assign(inputs, {
    edge_no_comma: '#EXTM3U\n#EXTINF:-1 tvg-id="one"\nhttp://x/1.ts',
    edge_all_attributes:
        '#EXTM3U\n#EXTINF:-1 tvg-id="id" tvg-name="nm" tvg-logo="lg" tvg-url="tu" tvg-rec="3" tvg-shift="-1" group-title="grp" referrer="ref" user-agent="ua" catchup="shift" catchup-days="7" catchup-source="cs" timeshift="2" lang="eng" radio="true",Full\nhttp://x/full.ts',
    edge_first_attr_empty: '#EXTM3U\n#EXTINF:-1 tvg-id="" tvg-id="second",Dup\nhttp://x/1.ts',
    edge_suffix_match: '#EXTM3U\n#EXTINF:-1 http-user-agent="HU" user-agent="U",Coll\nhttp://x/1.ts',
    edge_header_empty_attr: '#EXTM3U x-tvg-url="" url-tvg="http://epg/x.xml"\n#EXTINF:-1,A\nhttp://x/1.ts',
    edge_bare_extgrp: '#EXTM3U\n#EXTINF:-1 group-title="Kept",A\n#EXTGRP:\nhttp://x/1.ts',
    edge_extgrp_value: '#EXTM3U\n#EXTINF:-1 group-title="Old",A\n#EXTGRP:"New Group"\nhttp://x/1.ts',
    edge_pipe_only_line: '#EXTM3U\n#EXTINF:-1,A\n|User-Agent=UA\nhttp://x/real.ts',
    edge_blank_and_comments: '#EXTM3U\n#EXTINF:-1,A\n# note\n\n# second note\nhttp://x/1.ts',
    edge_trailing_extinf: '#EXTM3U\n#EXTINF:-1,Tail',
    edge_trailing_extinf_comment: '#EXTM3U\n#EXTINF:-1,Tail\n# dangling note',
    edge_crlf: '#EXTM3U\r\n#EXTINF:-1 tvg-id="crlf" radio="true",CRLF\r\nhttp://x/1.ts|User-Agent=UA\r\n',
    edge_bom: '﻿#EXTM3U\n#EXTINF:-1,A\nhttp://x/1.ts',
    edge_leading_blank: '\n\n  #EXTM3U\n#EXTINF:-1,A\nhttp://x/1.ts',
    edge_lowercase_header: '#extm3u\n#EXTINF:-1,A\nhttp://x/1.ts',
    edge_blank_only: '\n\n   \n',
    edge_no_header: '#EXTINF:-1,A\nhttp://x/1.ts',
    edge_junk_after_header: '#EXTM3U\n\u0000\u0001 garbage ,,, "" ="\n#EXTINF:-1 tvg-id="a" broken="x,Name with, commas\nhttp://x/1.ts?a=1&user-agent=X|Referer=http://r\n#EXTINF\n#EXTINF:\nhttp://orphan\n',
    edge_extvlcopt: '#EXTM3U\n#EXTINF:-1 user-agent="FromAttr",A\n#EXTVLCOPT:http-user-agent="VLC UA"\n#EXTVLCOPT:http-referrer=http://ref/\nhttp://x/1.ts',
    edge_kodiprop_before_extinf: '#EXTM3U\n#KODIPROP:inputstream.adaptive.license_type=clearkey\n#KODIPROP:inputstream.adaptive.license_key=kid123:key456\n#EXTINF:-1,Encrypted\nhttp://example.com/enc.mpd\n#EXTINF:-1,Plain\nhttp://example.com/plain.m3u8\n',
    edge_kodiprop_between: '#EXTM3U\n#EXTINF:-1,Mixed\n#KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha\n#EXTVLCOPT:http-referrer=http://ref\nhttp://x/1.mpd',
    edge_stray_kodiprop_at_end: '#EXTM3U\n#EXTINF:-1,A\nhttp://x/1.ts\n#KODIPROP:inputstream.adaptive.license_type=clearkey\n',
    contract_long_url: `#EXTM3U\n#EXTINF:-1 group-title="Anime & Geek" tvg-id="one" tvg-name="Beyblade",Beyblade\nhttps://cfd.pluto.tv/v2/stitch/hls/channel/one/master.m3u8?jwt=${bigJwt}&masterJWTPassthrough=true\n#EXTINF:-1 group-title="TV Brasileira" tvg-id="two" tvg-name="TV Cultura",TV Cultura\nhttps://cfd.pluto.tv/v2/stitch/hls/channel/two/master.m3u8?jwt=${bigJwt}&masterJWTPassthrough=true\n`,
    contract_directives: '#EXTM3U\n#EXTINF:-1 tvg-id="one",Channel One\n# stray comment\n#EXT-X-SESSION-DATA:DATA-ID="com.example",VALUE="x"\nhttp://example.com/one.m3u8\n#EXTINF:-1 tvg-id="two",Channel Two\nhttp://example.com/two.m3u8\n',
    contract_radio: '#EXTM3U\n#EXTINF:-1 radio="true" tvg-id="r1",Radio One\nhttp://example.com/radio1\n#EXTINF:-1 tvg-id="tv1",TV One\nhttp://example.com/tv1\n',
    contract_pipe: '#EXTM3U\n#EXTINF:-1,Piped\nhttp://example.com/stream.ts|User-Agent=CustomUA&Referer=http://ref.example\n',
    unicode_names: '#EXTM3U\n#EXTINF:-1 tvg-id="fr1" group-title="Télé française",Chaîne n°1 – « Été »\nhttp://x/été.ts\n#EXTINF:-1 group-title="日本",テレビ 東京\nhttp://x/jp.ts\n',
    quotes_in_name: '#EXTM3U\n#EXTINF:-1 tvg-name="Quoted, Name" group-title="G",Say "hi", friend\nhttp://x/1.ts\n',
    tabs_and_spaces: '#EXTM3U\n#EXTINF:-1\ttvg-id="t1"   group-title="G" ,  Spaced  \n   http://x/1.ts   \n',
    extinf_only_attrs_lower: '#EXTM3U\n#EXTINF:-1 TVG-ID="UP" GROUP-TITLE="Upper",Case\nhttp://x/1.ts\n',
    multiple_blank_between_items: '#EXTM3U\n\n\n#EXTINF:-1,A\nhttp://x/a\n\n\n\n#EXTINF:-1,B\nhttp://x/b\n\n',
});

let count = 0;
const index = [];
for (const [name, content] of Object.entries(inputs)) {
    let expected;
    try {
        expected = { ok: true, result: parser.parse(content) };
    } catch (error) {
        expected = { ok: false, error: error.message };
    }
    writeFileSync(join(OUT, name + '.m3u'), content, 'utf8');
    writeFileSync(join(OUT, name + '.expected.json'), JSON.stringify(expected, null, 1), 'utf8');
    index.push(name);
    count += 1;
}
writeFileSync(join(OUT, 'index.txt'), index.join('\n') + '\n');
console.log(`wrote ${count} fixtures to ${OUT}`);
