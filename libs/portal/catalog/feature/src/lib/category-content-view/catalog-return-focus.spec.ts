import { createCatalogReturnFocus } from './catalog-return-focus';

describe('Catalog return focus', () => {
    let main: HTMLElement;
    let host: HTMLElement;
    let card: HTMLButtonElement;
    let focus: ReturnType<typeof createCatalogReturnFocus>;
    beforeEach(() => {
        window.history.replaceState({ navigationId: 7 }, '');
        main = document.createElement('main');
        main.tabIndex = -1;
        host = document.createElement('div');
        card = document.createElement('button');
        card.dataset['catalogFocusKey'] = 'synthetic-42';
        host.append(card);
        main.append(host);
        document.body.append(main);
        focus = createCatalogReturnFocus(host);
    });
    afterEach(() => main.remove());

    it('restores the same item on a newly rendered list and consumes the anchor once', () => {
        card.focus();
        focus.capture();
        card.remove();
        const replacement = card.cloneNode() as HTMLButtonElement;
        host.append(replacement);
        createCatalogReturnFocus(host).restore();
        expect(document.activeElement).toBe(replacement);
        expect(window.history.state).toEqual({ navigationId: 7 });
        expect(focus.pending()).toBe(false);
    });

    it('keeps focus in an input or modal opened while data was loading', () => {
        card.focus();
        focus.capture();
        const input = document.createElement('input');
        main.append(input);
        input.focus();
        focus.restore();
        expect(document.activeElement).toBe(input);
    });

    it('hands focus back from the initiating header Back control', () => {
        card.focus();
        focus.capture();
        const back = document.createElement('button');
        back.dataset['testId'] = 'workspace-header-back';
        main.prepend(back);
        back.focus();
        focus.recordReturnTrigger();
        focus.restore();
        expect(document.activeElement).toBe(card);
    });

    it('preserves a control focused after the Back return began loading', () => {
        card.focus();
        focus.capture();
        const back = document.createElement('button');
        back.dataset['testId'] = 'workspace-header-back';
        const input = document.createElement('input');
        main.prepend(back, input);
        back.focus();
        focus.recordReturnTrigger();
        input.focus();
        focus.recordReturnTrigger();
        focus.restore();
        expect(document.activeElement).toBe(input);
    });

    it('falls back to main when filtering removed the saved item', () => {
        card.focus();
        focus.capture();
        card.remove();
        focus.restore();
        expect(document.activeElement).toBe(main);
    });

    it('does not focus a list behind an inert drawer', () => {
        card.focus();
        focus.capture();
        card.blur();
        host.setAttribute('inert', '');
        focus.restore();
        expect(document.activeElement).toBe(document.body);
    });

    it('ignores another history URL and preserves router bookkeeping', () => {
        window.history.replaceState(
            {
                navigationId: 9,
                catalogReturnFocus: { url: '/different', key: 'synthetic-42' },
            },
            ''
        );
        expect(focus.pending()).toBe(false);
        focus.restore();
        expect(window.history.state.navigationId).toBe(9);
    });
});
