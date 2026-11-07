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
import { syntheticFixture } from './synthetic-fixtures.mjs';

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
for (const file of readdirSync(inputDir).sort()) {
    if (file.endsWith('.m3u')) inputs['repo_' + file.replace(/\.m3u$/, '')] = readFileSync(join(inputDir, file), 'utf8');
}
// 2. the edge cases from tests/edge-cases.test.js, plus IPTVnator's contract spec
const bigJwt = 'e'.repeat(2100);
Object.assign(inputs, {
    edge_no_comma: "#EXTM3U\n#EXTINF:-1 tvg-id=\"Synthetic2\"\nhttp://synthetic.example/Synthetic1.ts",
    edge_all_attributes:
        "#EXTM3U\n#EXTINF:-1 tvg-id=\"Synthetic2\" tvg-name=\"Synthetic3\" tvg-logo=\"lg\" tvg-url=\"tu\" tvg-rec=\"3\" tvg-shift=\"-1\" group-title=\"Synthetic4\" referrer=\"ref\" user-agent=\"ua\" catchup=\"shift\" catchup-days=\"7\" catchup-source=\"cs\" timeshift=\"2\" lang=\"eng\" radio=\"true\",Synthetic5\nhttp://synthetic.example/Synthetic1.ts",
    edge_first_attr_empty: "#EXTM3U\n#EXTINF:-1 tvg-id=\"\" tvg-id=\"Synthetic2\",Synthetic3\nhttp://synthetic.example/Synthetic1.ts",
    edge_suffix_match: "#EXTM3U\n#EXTINF:-1 http-user-agent=\"HU\" user-agent=\"U\",Synthetic2\nhttp://synthetic.example/Synthetic1.ts",
    edge_header_empty_attr: "#EXTM3U x-tvg-url=\"\" url-tvg=\"http://synthetic.example/Synthetic1.xml\"\n#EXTINF:-1,Synthetic3\nhttp://synthetic.example/Synthetic2.ts",
    edge_bare_extgrp: "#EXTM3U\n#EXTINF:-1 group-title=\"Synthetic2\",Synthetic3\n#EXTGRP:\nhttp://synthetic.example/Synthetic1.ts",
    edge_extgrp_value: "#EXTM3U\n#EXTINF:-1 group-title=\"Synthetic2\",Synthetic3\n#EXTGRP:\"Synthetic4 Synthetic5\"\nhttp://synthetic.example/Synthetic1.ts",
    edge_pipe_only_line: "#EXTM3U\n#EXTINF:-1,Synthetic2\n|User-Agent=UA\nhttp://synthetic.example/Synthetic1.ts",
    edge_blank_and_comments: "#EXTM3U\n#EXTINF:-1,Synthetic2\n# note\n\n# second note\nhttp://synthetic.example/Synthetic1.ts",
    edge_trailing_extinf: "#EXTM3U\n#EXTINF:-1,Synthetic1",
    edge_trailing_extinf_comment: "#EXTM3U\n#EXTINF:-1,Synthetic1\n# dangling note",
    edge_crlf: "#EXTM3U\r\n#EXTINF:-1 tvg-id=\"Synthetic2\" radio=\"true\",Synthetic3\r\nhttp://synthetic.example/Synthetic1.ts|User-Agent=UA\r\n",
    edge_bom: "﻿#EXTM3U\n#EXTINF:-1,Synthetic2\nhttp://synthetic.example/Synthetic1.ts",
    edge_leading_blank: "\n\n  #EXTM3U\n#EXTINF:-1,Synthetic2\nhttp://synthetic.example/Synthetic1.ts",
    edge_lowercase_header: "#extm3u\n#EXTINF:-1,Synthetic2\nhttp://synthetic.example/Synthetic1.ts",
    edge_blank_only: '\n\n   \n',
    edge_no_header: "#EXTINF:-1,Synthetic2\nhttp://synthetic.example/Synthetic1.ts",
    edge_junk_after_header: "#EXTM3U\n\u0000\u0001 Synthetic4 ,,, \"\" =\"\n#EXTINF:-1 tvg-id=\"Synthetic3\" broken=\"x,Name with, commas\nhttp://synthetic.example/Synthetic1.ts?a=1&user-agent=Synthetic2|Referer=http://synthetic.example/\n#EXTINF\n#EXTINF:\nhttp://synthetic.example/\n",
    edge_extvlcopt: "#EXTM3U\n#EXTINF:-1 user-agent=\"FromAttr\",Synthetic2\n#EXTVLCOPT:http-user-agent=\"VLC UA\"\n#EXTVLCOPT:http-referrer=http://synthetic.example/\nhttp://synthetic.example/Synthetic1.ts",
    edge_kodiprop_before_extinf: "#EXTM3U\n#KODIPROP:inputstream.adaptive.license_type=clearkey\n#KODIPROP:inputstream.adaptive.license_key=kid123:key456\n#EXTINF:-1,Synthetic3\nhttp://synthetic.example/Synthetic1.mpd\n#EXTINF:-1,Synthetic4\nhttp://synthetic.example/Synthetic2.m3u8\n",
    edge_kodiprop_between: "#EXTM3U\n#EXTINF:-1,Synthetic2\n#KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha\n#EXTVLCOPT:http-referrer=http://synthetic.example/\nhttp://synthetic.example/Synthetic1.mpd",
    edge_stray_kodiprop_at_end: "#EXTM3U\n#EXTINF:-1,Synthetic2\nhttp://synthetic.example/Synthetic1.ts\n#KODIPROP:inputstream.adaptive.license_type=clearkey\n",
    contract_long_url: `#EXTM3U\n#EXTINF:-1 group-title=\"Synthetic7 & Synthetic8\" tvg-id=\"Synthetic5\" tvg-name=\"Synthetic9\",Synthetic9\nhttps://synthetic.example/Synthetic1/Synthetic2/Synthetic3/Synthetic4/Synthetic5/Synthetic6.m3u8?jwt=${bigJwt}&Synthetic10=Synthetic11\n#EXTINF:-1 group-title=\"Synthetic7 Synthetic8\" tvg-id=\"Synthetic5\" tvg-name=\"Synthetic7 Synthetic9\",Synthetic7 Synthetic9\nhttps://synthetic.example/Synthetic1/Synthetic2/Synthetic3/Synthetic4/Synthetic5/Synthetic6.m3u8?jwt=${bigJwt}&Synthetic1=Synthetic2\n`,
    contract_directives: "#EXTM3U\n#EXTINF:-1 tvg-id=\"Synthetic3\",Synthetic4 Synthetic5\n# stray comment\n#EXT-X-SESSION-DATA:DATA-ID=\"com.example\",VALUE=\"x\"\nhttp://synthetic.example/Synthetic1.m3u8\n#EXTINF:-1 tvg-id=\"Synthetic6\",Synthetic4 Synthetic7\nhttp://synthetic.example/Synthetic2.m3u8\n",
    contract_radio: "#EXTM3U\n#EXTINF:-1 radio=\"true\" tvg-id=\"Synthetic3\",Synthetic4 Synthetic5\nhttp://synthetic.example/Synthetic1\n#EXTINF:-1 tvg-id=\"Synthetic2\",Synthetic6 Synthetic5\nhttp://synthetic.example/Synthetic2\n",
    contract_pipe: "#EXTM3U\n#EXTINF:-1,Synthetic2\nhttp://synthetic.example/Synthetic1.ts|User-Agent=CustomUA&Referer=http://synthetic.example/\n",
    unicode_names: "#EXTM3U\n#EXTINF:-1 tvg-id=\"Synthetic3\" group-title=\"Синтетический4 Синтетический5\",Синтетический6 Synthetic7°1 – « Синтетический8 »\nhttp://synthetic.example/Synthetic1.ts\n#EXTINF:-1 group-title=\"Синтетический9\",Синтетический10 Синтетический11\nhttp://synthetic.example/Synthetic2.ts\n",
    quotes_in_name: "#EXTM3U\n#EXTINF:-1 tvg-name=\"Synthetic2, Synthetic3\" group-title=\"Synthetic4\",Synthetic5 \"Synthetic6\", Synthetic7\nhttp://synthetic.example/Synthetic1.ts\n",
    tabs_and_spaces: "#EXTM3U\n#EXTINF:-1\ttvg-id=\"Synthetic2\"   group-title=\"Synthetic3\" ,  Synthetic4  \n   http://synthetic.example/Synthetic1.ts   \n",
    extinf_only_attrs_lower: "#EXTM3U\n#EXTINF:-1 TVG-ID=\"Synthetic2\" GROUP-TITLE=\"Synthetic3\",Synthetic4\nhttp://synthetic.example/Synthetic1.ts\n",
    multiple_blank_between_items: "#EXTM3U\n\n\n#EXTINF:-1,Synthetic3\nhttp://synthetic.example/Synthetic1\n\n\n\n#EXTINF:-1,Synthetic4\nhttp://synthetic.example/Synthetic2\n\n",
});

let count = 0;
const index = [];
for (const [name, source] of Object.entries(inputs)) {
    const content = syntheticFixture(source);
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
