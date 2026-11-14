import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import {
    listenForChannelDrops,
    MULTIVIEW_CHANNEL_DRAG_TYPE,
    MULTIVIEW_DROP_TARGET_CLASS,
    MultiviewChannelDrag,
} from './multiview-channel-drag';

const item = { uid: 'xtream::playlist-1::live:7' } as UnifiedCollectionItem;

class FakeTransfer {
    private readonly data = new Map<string, string>();
    effectAllowed = 'none';
    dropEffect = 'none';
    get types(): string[] {
        return [...this.data.keys()];
    }
    setData(type: string, value: string): void {
        this.data.set(type, value);
    }
    getData(type: string): string {
        return this.data.get(type) ?? '';
    }
}

function dragEvent(type: string, transfer: FakeTransfer | null): DragEvent {
    const event = new Event(type, {
        bubbles: true,
        cancelable: true,
    }) as DragEvent;
    Object.defineProperty(event, 'dataTransfer', { value: transfer });
    return event;
}

describe('MultiviewChannelDrag', () => {
    it('carries a channel through the drag by token, once', () => {
        const drag = new MultiviewChannelDrag();
        const transfer = new FakeTransfer();

        drag.start(item, transfer as unknown as DataTransfer);

        expect(transfer.types).toEqual([MULTIVIEW_CHANNEL_DRAG_TYPE]);
        expect(drag.carries(transfer as unknown as DataTransfer)).toBe(true);
        expect(drag.take(transfer as unknown as DataTransfer)).toBe(item);
        expect(drag.take(transfer as unknown as DataTransfer)).toBeNull();
    });

    it('ignores a drop that carries something else', () => {
        const drag = new MultiviewChannelDrag();
        drag.start(item, new FakeTransfer() as unknown as DataTransfer);
        const other = new FakeTransfer();
        other.setData('text/plain', 'x');

        expect(drag.carries(other as unknown as DataTransfer)).toBe(false);
        expect(drag.take(other as unknown as DataTransfer)).toBeNull();
    });
});

describe('listenForChannelDrops', () => {
    let element: HTMLElement;
    let drag: MultiviewChannelDrag;
    let transfer: FakeTransfer;
    const drop = jest.fn();
    let enabled = true;

    beforeEach(() => {
        element = document.createElement('div');
        drag = new MultiviewChannelDrag();
        transfer = new FakeTransfer();
        drag.start(item, transfer as unknown as DataTransfer);
        drop.mockReset();
        enabled = true;
    });

    it('accepts a dragged channel and hands it over on drop', () => {
        listenForChannelDrops(element, drag, { enabled: () => enabled, drop });

        const over = dragEvent('dragover', transfer);
        element.dispatchEvent(over);
        expect(over.defaultPrevented).toBe(true);
        expect(element.classList).toContain(MULTIVIEW_DROP_TARGET_CLASS);

        element.dispatchEvent(dragEvent('drop', transfer));
        expect(drop).toHaveBeenCalledWith(item);
        expect(element.classList).not.toContain(MULTIVIEW_DROP_TARGET_CLASS);
    });

    it('is no drop target while disabled or for other drags', () => {
        listenForChannelDrops(element, drag, { enabled: () => enabled, drop });
        enabled = false;
        const over = dragEvent('dragover', transfer);
        element.dispatchEvent(over);
        element.dispatchEvent(dragEvent('drop', transfer));

        expect(over.defaultPrevented).toBe(false);
        expect(drop).not.toHaveBeenCalled();
    });

    it('stops listening when removed', () => {
        const remove = listenForChannelDrops(element, drag, {
            enabled: () => true,
            drop,
        });
        remove();

        element.dispatchEvent(dragEvent('drop', transfer));
        expect(drop).not.toHaveBeenCalled();
    });
});
