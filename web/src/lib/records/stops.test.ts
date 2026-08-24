import { describe, expect, it } from 'vitest';
import { groupStops, stopAddress, stopKey } from './stops';
import type { Rec } from './records.svelte';

const rec = (p: Partial<Rec> & { id: string }): Rec => ({
	extra: {},
	geocode: 'ok',
	lat: 51.44,
	lon: 3.57,
	...p
});

describe('stopKey', () => {
	it('ignores case and stray whitespace', () => {
		const a = rec({ id: 'a', street: 'Badhuisstraat', houseNumber: '34', postcode: '4381 LR' });
		const b = rec({ id: 'b', street: '  badhuisstraat ', houseNumber: '34', postcode: '4381 lr' });
		expect(stopKey(a)).toBe(stopKey(b));
	});

	it('collapses runs of whitespace inside a street name', () => {
		const a = rec({ id: 'a', street: 'Boulevard De Ruyter', houseNumber: '1' });
		const b = rec({ id: 'b', street: 'Boulevard  De   Ruyter', houseNumber: '1' });
		expect(stopKey(a)).toBe(stopKey(b));
	});

	it('keeps separately numbered flats apart', () => {
		// one entrance, two letterboxes — deliberately two stops
		const a = rec({ id: 'a', street: 'Scheldestraat', houseNumber: '1-205' });
		const b = rec({ id: 'b', street: 'Scheldestraat', houseNumber: '1-206' });
		expect(stopKey(a)).not.toBe(stopKey(b));
	});

	it('keeps a house number suffix significant', () => {
		const a = rec({ id: 'a', street: 'Glacisstraat', houseNumber: '44' });
		const b = rec({ id: 'b', street: 'Glacisstraat', houseNumber: '44c' });
		expect(stopKey(a)).not.toBe(stopKey(b));
	});

	it('separates the same house number on different postcodes', () => {
		const a = rec({ id: 'a', street: 'Kerkstraat', houseNumber: '2', postcode: '4381 AA' });
		const b = rec({ id: 'b', street: 'Kerkstraat', houseNumber: '2', postcode: '4388 BB' });
		expect(stopKey(a)).not.toBe(stopKey(b));
	});

	it('never merges records that cannot be addressed', () => {
		// a coords-only upload has nothing to group on; merging on a missing
		// key would silently fuse unrelated deliveries
		const a = rec({ id: 'a' });
		const b = rec({ id: 'b' });
		expect(stopKey(a)).not.toBe(stopKey(b));
		expect(stopKey(a)).toContain('a');
	});

	it('treats a street with no house number as unaddressable', () => {
		const a = rec({ id: 'a', street: 'Badhuisstraat' });
		const b = rec({ id: 'b', street: 'Badhuisstraat' });
		expect(stopKey(a)).not.toBe(stopKey(b));
	});
});

describe('groupStops', () => {
	it('collapses a household into one door, keeping every card', () => {
		const stops = groupStops([
			rec({ id: 'a', street: 'Badhuisstraat', houseNumber: '34' }),
			rec({ id: 'b', street: 'Badhuisstraat', houseNumber: '34' }),
			rec({ id: 'c', street: 'Badhuisstraat', houseNumber: '36' })
		]);
		expect(stops).toHaveLength(2);
		expect(stops[0].recIds).toEqual(['a', 'b']);
		expect(stops[1].recIds).toEqual(['c']);
	});

	it('preserves upload order of doors and of cards within a door', () => {
		const stops = groupStops([
			rec({ id: 'z', street: 'B', houseNumber: '1' }),
			rec({ id: 'a', street: 'A', houseNumber: '1' }),
			rec({ id: 'y', street: 'B', houseNumber: '1' })
		]);
		expect(stops.map((s) => s.recIds)).toEqual([['z', 'y'], ['a']]);
	});

	it('drops records that have not been geocoded', () => {
		const stops = groupStops([
			rec({ id: 'a', street: 'A', houseNumber: '1' }),
			rec({ id: 'b', street: 'B', houseNumber: '2', lat: undefined, lon: undefined })
		]);
		expect(stops.map((s) => s.recIds)).toEqual([['a']]);
	});

	it('takes the first card’s coordinate when geocoding disagrees', () => {
		// rows at one address can land a metre or two apart; picking one beats
		// averaging into a point that matches no building
		const stops = groupStops([
			rec({ id: 'a', street: 'A', houseNumber: '1', lat: 51.44, lon: 3.57 }),
			rec({ id: 'b', street: 'A', houseNumber: '1', lat: 51.4401, lon: 3.5701 })
		]);
		expect(stops).toHaveLength(1);
		expect([stops[0].lat, stops[0].lon]).toEqual([51.44, 3.57]);
	});

	it('carries the address through for display', () => {
		const [stop] = groupStops([
			rec({ id: 'a', street: 'Badhuisstraat', houseNumber: '34', city: 'Vlissingen' })
		]);
		expect(stopAddress(stop)).toBe('Badhuisstraat 34');
		expect(stop.city).toBe('Vlissingen');
	});

	it('falls back to the key when there is no address to show', () => {
		const [stop] = groupStops([rec({ id: 'a' })]);
		expect(stopAddress(stop)).toBe(stop.key);
	});

	it('handles an empty upload', () => {
		expect(groupStops([])).toEqual([]);
	});
});
