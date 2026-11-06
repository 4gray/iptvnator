import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { fetchText } from '../devserver/backend-logic.mjs';

test('redirects retain identity on the same origin and drop it across origins', async () => {
    const observed = [];
    const destination = createServer((req, res) => {
        observed.push(req.headers);
        res.end('synthetic response');
    });
    const source = createServer((req, res) => {
        if (req.url === '/same') res.writeHead(302, { Location: '/target' }).end();
        else if (req.url === '/cross') res.writeHead(302, { Location: `http://127.0.0.1:${destination.address().port}/target` }).end();
        else { observed.push(req.headers); res.end('synthetic response'); }
    });
    for (const server of [destination, source]) await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
        const headers = { aUtHoRiZaTiOn: 'Bearer synthetic-token', Cookie: 'mac=synthetic-mac', SN: 'synthetic-serial', 'Proxy-Authorization': 'synthetic-proxy', Host: 'synthetic-source.example', 'User-Agent': 'synthetic-agent' };
        const base = `http://127.0.0.1:${source.address().port}`;
        await fetchText(base + '/same', { headers });
        await fetchText(base + '/cross', { headers });
        assert.equal(observed[0].authorization, headers.aUtHoRiZaTiOn);
        assert.equal(observed[0].cookie, headers.Cookie);
        assert.equal(observed[0].sn, headers.SN);
        assert.equal(observed[0]['proxy-authorization'], headers['Proxy-Authorization']);
        assert.equal(observed[0].host, headers.Host);
        for (const key of ['authorization', 'cookie', 'proxy-authorization', 'sn']) assert.equal(observed[1][key], undefined);
        assert.notEqual(observed[1].host, headers.Host);
        assert.equal(observed[1]['user-agent'], headers['User-Agent']);
        assert.equal(headers.Cookie, 'mac=synthetic-mac');
    } finally {
        await Promise.all([source, destination].map((server) => new Promise((resolve) => server.close(resolve))));
    }
});
