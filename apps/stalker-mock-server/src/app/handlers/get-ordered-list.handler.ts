import { Request, Response } from 'express';
import { getPortalData } from '../data-store.js';
import { extractMac } from './get-categories.handler.js';
import { RawChannel, RawSeriesItem, RawVodItem } from '../data-generator.js';

const PAGE_SIZE = 14;

type AnyItem = RawChannel | RawVodItem | RawSeriesItem;

/**
 * Stalker get_ordered_list — returns paginated content for a category.
 *
 * Query params:
 *   type:     itv | vod | series
 *   category: category_id (or "*" for all)
 *   genre:    same as category for itv
 *   p:        page number (1-based)
 *   search:   optional search phrase
 */
export function handleGetOrderedList(req: Request, res: Response): void {
    const mac = extractMac(req);
    const type = (req.query['type'] as string) ?? 'vod';
    const categoryId = (req.query['category'] as string) ?? '*';
    const page = parseInt((req.query['p'] as string) ?? '1', 10);
    const search = ((req.query['search'] as string) ?? '').toLowerCase();
    const data = getPortalData(mac);

    let allItems: AnyItem[] = [];

    if (type === 'itv') {
        if (categoryId === '*') {
            for (const items of data.channels.values()) {
                allItems.push(...items);
            }
        } else {
            allItems = data.channels.get(categoryId) ?? [];
        }
    } else if (type === 'series') {
        if (categoryId === '*') {
            for (const items of data.series.values()) {
                allItems.push(...items);
            }
        } else {
            allItems = data.series.get(categoryId) ?? [];
        }
    } else {
        // vod (default)
        if (categoryId === '*') {
            for (const items of data.vod.values()) {
                allItems.push(...items);
            }
        } else {
            allItems = data.vod.get(categoryId) ?? [];
        }
    }

    // Apply search filter
    if (search) {
        allItems = allItems.filter((item) => {
            const name = ('name' in item ? item.name : '') ?? '';
            return name.toLowerCase().includes(search);
        });
    }

    const totalItems = allItems.length;
    const totalPages = Math.ceil(totalItems / PAGE_SIZE);
    const offset = (page - 1) * PAGE_SIZE;
    const pageItems = allItems.slice(offset, offset + PAGE_SIZE);

    res.json({
        js: {
            data: pageItems,
            total_items: totalItems,
            max_page_items: PAGE_SIZE,
            cur_page: page,
            total_pages: totalPages,
            selected_item: 0,
        },
    });
}
