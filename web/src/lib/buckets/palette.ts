/**
 * Categorical bucket colors — saturated enough to read on both basemap
 * flavors, distinct from the green chrome accent. Cycles past 12.
 */
export const BUCKET_COLORS = [
	'#1f6feb', // blue
	'#2da44e', // green
	'#d7263d', // red
	'#8250df', // purple
	'#0fa3a3', // teal
	'#d6409f', // magenta
	'#c9a227', // ochre
	'#5a9e32', // leaf
	'#3b4cc0', // indigo
	'#c1622b', // rust
	'#6e7781', // slate
	'#9c5d30' // umber
] as const;

export const UNASSIGNED_COLOR = '#9a9890';

export function bucketColor(index: number): string {
	return BUCKET_COLORS[index % BUCKET_COLORS.length];
}
