import { describe, expect, it } from 'vitest';
import { fmtM, fmtMin, nameLine } from './walk.svelte';

describe('nameLine', () => {
	it('shows a single resident', () => {
		expect(nameLine(['Kees Visser'])).toBe('Kees Visser');
	});

	it('shows both when a couple share an address', () => {
		// the case worth seeing on screen, so it is never collapsed
		expect(nameLine(['Roos Smits', 'Teun Smits'])).toBe('Roos Smits, Teun Smits');
	});

	it('collapses three or more, keeping the first', () => {
		expect(nameLine(['Niels Jansen', 'Anna Jansen', 'Sanne Jansen'])).toBe(
			'Niels Jansen + 2 more'
		);
	});

	it('counts correctly past three', () => {
		expect(nameLine(['A', 'B', 'C', 'D', 'E'])).toBe('A + 4 more');
	});

	it('is empty when no name column was shown', () => {
		expect(nameLine([])).toBe('');
	});
});

describe('fmtM', () => {
	it('rounds metres', () => {
		expect(fmtM(0)).toBe('0 m');
		expect(fmtM(38.4)).toBe('38 m');
		expect(fmtM(999)).toBe('999 m');
	});

	it('switches to kilometres, with a decimal while it still helps', () => {
		expect(fmtM(1000)).toBe('1.0 km');
		expect(fmtM(5240)).toBe('5.2 km');
		expect(fmtM(12000)).toBe('12 km');
	});
});

describe('fmtMin', () => {
	it('reads in minutes under an hour', () => {
		expect(fmtMin(0)).toBe('0 min');
		expect(fmtMin(90)).toBe('2 min');
		expect(fmtMin(3540)).toBe('59 min');
	});

	it('reads in hours and minutes beyond', () => {
		expect(fmtMin(3600)).toBe('1 u 0');
		expect(fmtMin(5400)).toBe('1 u 30');
	});
});
