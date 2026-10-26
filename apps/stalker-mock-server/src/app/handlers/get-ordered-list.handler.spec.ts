import { Request, Response } from 'express';
import { getPortalData } from '../data-store';
import { handleGetOrderedList } from './get-ordered-list.handler';
jest.mock('../data-store', () => ({ getPortalData: jest.fn() }));
const items = Array.from({ length: 40 }, (_, i) => ({
    id: String(i),
    name: `Title ${String(39 - i).padStart(2, '0')}`,
    added: String(1700000000 + i),
    category_id: '1',
}));
beforeEach(() => {
    jest.mocked(getPortalData).mockReturnValue({
        vod: new Map([['1', items]]),
        series: new Map([['1', items]]),
    } as unknown as ReturnType<typeof getPortalData>);
});
function page(type: string, sortby: string, p: number, search = '') {
    let result: { js: { data: typeof items; total_items: number } };
    handleGetOrderedList(
        {
            query: { type, sortby, p: String(p), search },
            headers: {},
        } as unknown as Request,
        {
            json: (body: typeof result) => {
                result = body;
            },
        } as Response
    );
    return result!.js;
}
it.each(['vod', 'series'])(
    '%s sorts all titles before paging and retains order within search',
    (type) => {
        const first = page(type, 'added', 1);
        const second = page(type, 'added', 2);
        expect(first.data.map((x) => x.id)).toEqual(
            Array.from({ length: 14 }, (_, i) => String(39 - i))
        );
        expect(second.data[0].id).toBe('25');
        expect(page(type, 'name', 1).data[0].name).toBe('Title 00');
        expect(page(type, 'added', 1, 'Title 3').total_items).toBe(10);
        expect(page(type, 'added', 1, 'Title 3').data[0].id).toBe('9');
        expect(page(type, '', 1).data[0].id).toBe('0');
        expect(items[0].id).toBe('0');
    }
);
