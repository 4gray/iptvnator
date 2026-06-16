import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';
import test from 'node:test';
import {
    assertPortAvailable,
    coordinateChildProcesses,
    isIptvnatorWebResponse,
    waitForIptvnatorWebServer,
} from './serve-electron-dev.runtime.mjs';

test('accepts only a successful IPTVnator HTML response', () => {
    const body = '<title>IPTVnator</title><app-root></app-root>';
    assert.equal(isIptvnatorWebResponse(200, 'text/html', body), true);
    assert.equal(isIptvnatorWebResponse(503, 'text/html', body), false);
    assert.equal(isIptvnatorWebResponse(200, 'application/json', body), false);
    assert.equal(
        isIptvnatorWebResponse(
            200,
            'text/html',
            '<title>Other app</title><app-root></app-root>'
        ),
        false
    );
});

test('rejects a port already owned by another process', async (context) => {
    const server = createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    context.after(() => server.close());
    const address = server.address();

    await assert.rejects(
        assertPortAvailable(address.port),
        /127\.0\.0\.1:.+ is unavailable \(EADDRINUSE\)/
    );
});

test('allows IPv4 startup when IPv6 loopback is unavailable', async () => {
    const probedHosts = [];
    await assert.doesNotReject(
        assertPortAvailable(4200, async (host) => {
            probedHosts.push(host);
            if (host === '::1') {
                const error = new Error('IPv6 loopback is unavailable.');
                error.code = 'EADDRNOTAVAIL';
                throw error;
            }
        })
    );
    assert.deepEqual(probedHosts, ['127.0.0.1', '::1']);
});

test('rejects when the owned web process exits before readiness', async () => {
    const webChild = new EventEmitter();
    const readiness = waitForIptvnatorWebServer(
        new URL('http://localhost:4200/'),
        webChild,
        {
            timeoutMs: 1_000,
            pollIntervalMs: 1,
            requestPage: () => new Promise(() => undefined),
        }
    );
    webChild.emit('exit', 1, null);
    await assert.rejects(readiness, /exited before readiness \(code 1\)/);
});

test('waits past non-success responses until IPTVnator is ready', async () => {
    const webChild = new EventEmitter();
    const body = '<title>IPTVnator</title><app-root></app-root>';
    const responses = [
        { statusCode: 503, contentType: 'text/html', body },
        { statusCode: 200, contentType: 'text/html', body },
    ];

    await waitForIptvnatorWebServer(
        new URL('http://localhost:4200/'),
        webChild,
        {
            timeoutMs: 1_000,
            pollIntervalMs: 1,
            requestPage: async () => responses.shift(),
        }
    );
    assert.equal(responses.length, 0);
});

test('terminates both children once on SIGINT without re-signalling', () => {
    const processRef = new EventEmitter();
    processRef.exitCode = undefined;
    const webChild = createChild();
    const electronChild = createChild();

    coordinateChildProcesses(webChild, electronChild, processRef);
    processRef.emit('SIGINT');
    electronChild.emit('exit', null, 'SIGINT');

    assert.deepEqual(webChild.killedWith, ['SIGINT']);
    assert.deepEqual(electronChild.killedWith, ['SIGINT']);
    assert.equal(processRef.exitCode, 130);
    assert.equal(processRef.listenerCount('SIGINT'), 0);
    assert.equal(processRef.listenerCount('SIGTERM'), 0);
});

test('stops the sibling when either child exits', () => {
    const processRef = new EventEmitter();
    processRef.exitCode = undefined;
    const webChild = createChild();
    const electronChild = createChild();

    coordinateChildProcesses(webChild, electronChild, processRef);
    electronChild.exitCode = 2;
    electronChild.emit('exit', 2, null);

    assert.deepEqual(webChild.killedWith, ['SIGTERM']);
    assert.deepEqual(electronChild.killedWith, []);
    assert.equal(processRef.exitCode, 2);
});

function createChild() {
    const child = new EventEmitter();
    child.exitCode = null;
    child.signalCode = null;
    child.killedWith = [];
    child.kill = (signal) => {
        child.killedWith.push(signal);
        return true;
    };
    return child;
}
