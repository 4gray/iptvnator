import {
    PLAYER_SUSPENDED_ATTRIBUTE,
    watchPlayerSuspension,
} from './controls-suspension';

/** MutationObserver callbacks are microtasks. */
const flush = () => Promise.resolve();

describe('watchPlayerSuspension', () => {
    let container: HTMLElement;
    let host: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        host = document.createElement('div');
        container.appendChild(host);
        document.body.appendChild(container);
    });

    afterEach(() => container.remove());

    it('reports when an ancestor suspends the player', async () => {
        const onSuspend = jest.fn();
        const dispose = watchPlayerSuspension(host, onSuspend);

        container.setAttribute(PLAYER_SUSPENDED_ATTRIBUTE, '');
        await flush();

        expect(onSuspend).toHaveBeenCalledTimes(1);
        dispose();
    });

    it('ignores the attribute being removed and other subtrees', async () => {
        const onSuspend = jest.fn();
        const sibling = document.createElement('div');
        document.body.appendChild(sibling);
        container.setAttribute(PLAYER_SUSPENDED_ATTRIBUTE, '');
        const dispose = watchPlayerSuspension(host, onSuspend);

        container.removeAttribute(PLAYER_SUSPENDED_ATTRIBUTE);
        sibling.setAttribute(PLAYER_SUSPENDED_ATTRIBUTE, '');
        await flush();

        expect(onSuspend).not.toHaveBeenCalled();
        dispose();
        sibling.remove();
    });

    it('stops reporting once disposed', async () => {
        const onSuspend = jest.fn();
        watchPlayerSuspension(host, onSuspend)();

        container.setAttribute(PLAYER_SUSPENDED_ATTRIBUTE, '');
        await flush();

        expect(onSuspend).not.toHaveBeenCalled();
    });
});
