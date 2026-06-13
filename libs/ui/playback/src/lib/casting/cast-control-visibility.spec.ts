import { CastControlVisibility } from './cast-control-visibility';

describe('CastControlVisibility', () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    it('keeps the overlay visible when focus moves within its container', () => {
        jest.useFakeTimers();
        const visibility = new CastControlVisibility();
        const container = document.createElement('div');
        const child = document.createElement('button');
        container.appendChild(child);

        visibility.setInteractionActive(true);
        visibility.handleFocusOut({
            currentTarget: container,
            relatedTarget: child,
        } as unknown as FocusEvent);
        jest.advanceTimersByTime(3000);

        expect(visibility.visible()).toBe(true);
        visibility.destroy();
    });

    it('starts hiding when focus leaves the overlay container', () => {
        jest.useFakeTimers();
        const visibility = new CastControlVisibility();
        const container = document.createElement('div');
        const outside = document.createElement('button');

        visibility.setInteractionActive(true);
        visibility.handleFocusOut({
            currentTarget: container,
            relatedTarget: outside,
        } as unknown as FocusEvent);
        jest.advanceTimersByTime(3000);

        expect(visibility.visible()).toBe(false);
        visibility.destroy();
    });
});
