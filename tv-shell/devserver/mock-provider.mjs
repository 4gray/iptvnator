#!/usr/bin/env node
/**
 * Tiny stand-in for an IPTV provider, used only to exercise the shell locally:
 *   GET /player_api.php?username&password[&action]   (Xtream Codes API subset)
 *   GET /sample.m3u                                  (M3U playlist)
 *   GET /live|movie|series/...                        (a short WebM clip, if available)
 *
 * Usage: node mock-provider.mjs [--port 43331] [--video path/to/clip.webm]
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def) => {
    const i = args.indexOf(name);
    return i === -1 ? def : args[i + 1];
};
const PORT = Number(opt('--port', '43331'));
const VIDEO = opt('--video', join(__dirname, 'clip.webm'));
const BASE = `http://127.0.0.1:${PORT}`;

const liveCategories = [
    { category_id: '101', category_name: 'News', parent_id: 0 },
    { category_id: '102', category_name: 'Sports', parent_id: 0 },
    { category_id: '103', category_name: 'Kids', parent_id: 0 },
];
const vodCategories = [
    { category_id: '201', category_name: 'Action', parent_id: 0 },
    { category_id: '202', category_name: 'Comedy', parent_id: 0 },
];
const seriesCategories = [{ category_id: '301', category_name: 'Drama Series', parent_id: 0 }];

const liveStreams = [];
let num = 1;
for (const cat of liveCategories) {
    for (let i = 1; i <= 6; i++) {
        const id = 10000 + liveStreams.length;
        liveStreams.push({
            num: num++,
            name: `${cat.category_name} Channel ${i}`,
            stream_type: 'live',
            stream_id: id,
            stream_icon: '',
            epg_channel_id: `ch${id}`,
            added: '1700000000',
            category_id: cat.category_id,
            custom_sid: '',
            direct_source: '',
            tv_archive: 0,
            tv_archive_duration: 0,
            rating_imdb: '',
        });
    }
}
const vodStreams = [];
for (const cat of vodCategories) {
    for (let i = 1; i <= 8; i++) {
        const id = 20000 + vodStreams.length;
        vodStreams.push({
            num: id,
            name: `${cat.category_name} Movie ${i}`,
            stream_type: 'movie',
            stream_id: id,
            stream_icon: '',
            rating: '7.5',
            rating_5based: 3.8,
            added: '1700000000',
            category_id: cat.category_id,
            container_extension: 'mp4',
            custom_sid: '',
            direct_source: '',
        });
    }
}
const series = [];
for (let i = 1; i <= 5; i++) {
    series.push({
        num: 30000 + i,
        name: `Drama Show ${i}`,
        series_id: 30000 + i,
        cover: '',
        plot: 'A drama.',
        cast: '',
        director: '',
        genre: 'Drama',
        releaseDate: '2020-01-01',
        last_modified: '1700000000',
        rating: '8',
        rating_5based: 4,
        backdrop_path: [],
        youtube_trailer: '',
        episode_run_time: '45',
        category_id: '301',
    });
}

function seriesInfo(seriesId) {
    const show = series.find((s) => String(s.series_id) === String(seriesId)) ?? series[0];
    const episodes = {};
    for (let season = 1; season <= 2; season++) {
        episodes[String(season)] = Array.from({ length: 4 }, (_, i) => ({
            id: String(show.series_id * 100 + season * 10 + i + 1),
            episode_num: i + 1,
            title: `S${season}E${i + 1}`,
            container_extension: 'mp4',
            info: { duration: '00:45:00', plot: 'An episode.' },
            season,
            added: '1700000000',
            direct_source: '',
        }));
    }
    return {
        seasons: [1, 2].map((n) => ({ season_number: n, name: `Season ${n}`, cover: '', air_date: '2020-01-01', episode_count: 4, overview: '' })),
        info: { ...show },
        episodes,
    };
}

function accountInfo(username, password) {
    const now = Math.floor(Date.now() / 1000);
    return {
        user_info: {
            username,
            password,
            message: '',
            auth: 1,
            status: 'Active',
            exp_date: String(now + 86400 * 365),
            is_trial: '0',
            active_cons: '1',
            created_at: String(now - 86400 * 365),
            max_connections: '2',
            allowed_output_formats: ['m3u8', 'ts'],
        },
        server_info: {
            url: `127.0.0.1`,
            port: String(PORT),
            https_port: '',
            server_protocol: 'http',
            rtmp_port: '',
            timezone: 'UTC',
            timestamp_now: now,
            time_now: new Date().toISOString().replace('T', ' ').slice(0, 19),
        },
    };
}

function sampleM3u() {
    const lines = ['#EXTM3U x-tvg-url="http://127.0.0.1/guide.xml"'];
    for (const cat of liveCategories) {
        for (let i = 1; i <= 60; i++) {
            lines.push(`#EXTINF:-1 tvg-id="m3u-${cat.category_id}-${i}" tvg-name="${cat.category_name} ${i}" tvg-logo="" group-title="${cat.category_name}",${cat.category_name} ${i}`);
            lines.push(`${BASE}/live/user/pass/${cat.category_id}${i}.ts`);
        }
    }
    lines.push('#EXTINF:-1 group-title="Special" radio="true",Radio One');
    lines.push(`${BASE}/radio/one`);
    lines.push('#EXTINF:-1 group-title="Special",Piped with headers');
    lines.push(`${BASE}/live/user/pass/piped.ts|User-Agent=CustomUA&Referer=http://ref.example`);
    lines.push('#KODIPROP:inputstream.adaptive.license_type=clearkey');
    lines.push('#KODIPROP:inputstream.adaptive.license_key=00112233445566778899aabbccddeeff:ffeeddccbbaa99887766554433221100');
    lines.push('#EXTINF:-1 group-title="Special",ClearKey DASH');
    lines.push(`${BASE}/dash/enc.mpd`);
    return lines.join('\n') + '\n';
}

createServer((req, res) => {
    const url = new URL(req.url, BASE);
    const q = url.searchParams;
    if (url.pathname === '/player_api.php') {
        const username = q.get('username') || '';
        const password = q.get('password') || '';
        if (username !== 'user' || password !== 'pass') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ user_info: { auth: 0, status: 'Disabled' } }));
        }
        const action = q.get('action') || '';
        let body;
        switch (action) {
            case '':
            case 'get_account_info':
                body = accountInfo(username, password);
                break;
            case 'get_live_categories':
                body = liveCategories;
                break;
            case 'get_vod_categories':
                body = vodCategories;
                break;
            case 'get_series_categories':
                body = seriesCategories;
                break;
            case 'get_live_streams':
                body = q.get('category_id') ? liveStreams.filter((s) => s.category_id === q.get('category_id')) : liveStreams;
                break;
            case 'get_vod_streams':
                body = q.get('category_id') ? vodStreams.filter((s) => s.category_id === q.get('category_id')) : vodStreams;
                break;
            case 'get_series':
                body = q.get('category_id') ? series.filter((s) => s.category_id === q.get('category_id')) : series;
                break;
            case 'get_series_info':
                body = seriesInfo(q.get('series_id'));
                break;
            case 'get_vod_info': {
                const id = q.get('vod_id');
                const movie = vodStreams.find((v) => String(v.stream_id) === String(id)) ?? vodStreams[0];
                body = { info: { movie_image: '', plot: 'A movie.', duration: '01:30:00', rating: '7.5' }, movie_data: { ...movie, container_extension: 'mp4' } };
                break;
            }
            case 'get_short_epg':
            case 'get_simple_data_table':
                body = { epg_listings: [] };
                break;
            default:
                body = [];
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(body));
    }
    if (url.pathname === '/sample.m3u') {
        res.writeHead(200, { 'Content-Type': 'audio/x-mpegurl' });
        return res.end(sampleM3u());
    }
    if (/^\/(live|movie|series|radio|dash)\//.test(url.pathname)) {
        if (existsSync(VIDEO)) {
            const data = readFileSync(VIDEO);
            res.writeHead(200, { 'Content-Type': 'video/webm', 'Content-Length': data.length, 'Accept-Ranges': 'none' });
            return res.end(data);
        }
        res.writeHead(404);
        return res.end();
    }
    res.writeHead(404);
    res.end();
}).listen(PORT, '127.0.0.1', () => console.log(`mock provider: ${BASE}  (Xtream user/pass, M3U at /sample.m3u)`));
