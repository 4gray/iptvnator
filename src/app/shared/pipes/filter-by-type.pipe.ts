import { Pipe, PipeTransform } from '@angular/core';
import { FavoriteItem } from '../../xtream-tauri/services/favorite-item.interface';

@Pipe({
    name: 'filterByType',
    standalone: true,
})
export class FilterByTypePipe implements PipeTransform {
    transform(items: FavoriteItem[] | null, type: string): FavoriteItem[] {
        if (!items) return [];
        return items.filter((item) => item.type === type);
    }
}
