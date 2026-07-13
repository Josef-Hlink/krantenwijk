// The krantenwijk mark: a bundle of green postcards squared up behind a
// white address panel, held by a natural-rubber elastic that wraps around
// the stack. `basisInner` is the single source of truth; every treatment
// derives from it. The inks below are the palette the rest of the site
// draws from.

const G1 = '#4d9861'; // groen 1 — top card
const G2 = '#3d7a4e'; // groen 2 — middle card
const G3 = '#2e5f3c'; // groen 3 — bottom card
const BEIGE = '#d8c39a'; // elastiek — natural rubber
const BEIGE_D = '#b89f74'; // elastiek (om) — the band where it wraps
const WHITE = '#fbfaf6'; // paneel — paper white

export const inks = [
	{ name: 'groen 1', hex: G1,
		role: 'The top card. Lead green: actions, links, the places the eye should land.' },
	{ name: 'groen 2', hex: G2,
		role: 'The middle card. Supporting surfaces, and the address lines on the panel.' },
	{ name: 'groen 3', hex: G3,
		role: 'The bottom card. Text-weight green on light paper; fills on dark.' },
	{ name: 'elastiek', hex: BEIGE,
		role: 'The band. Warm accent for highlights and borders.' },
	{ name: 'elastiek (om)', hex: BEIGE_D,
		role: 'The band where it wraps around. The shadow side: hover and pressed states.' },
	{ name: 'paneel', hex: WHITE,
		role: 'The address panel. Paper white for cards and panels.' },
];

const wrap = (inner: string, viewBox = '0 0 120 120') =>
	`<svg viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${inner}</svg>`;

/* 01 · basis — the mark */
const basisInner = `
	<rect x="28" y="40" width="72" height="48" rx="5" fill="${G3}"/>
	<rect x="25" y="36" width="72" height="48" rx="5" fill="${G2}"/>
	<rect x="22" y="32" width="72" height="48" rx="5" fill="${G1}"/>
	<rect x="29.2" y="44" width="50.4" height="27" rx="2.5" fill="${WHITE}"/>
	<rect x="34" y="50" width="16" height="3" rx="1.5" fill="${G2}" opacity="0.55"/>
	<rect x="34" y="56" width="27" height="3" rx="1.5" fill="${G2}" opacity="0.55"/>
	<rect x="34" y="62" width="20" height="3" rx="1.5" fill="${G2}" opacity="0.55"/>
	<rect x="68" y="32" width="8" height="48" fill="${BEIGE}"/>
	<polygon points="68,80 76,80 82,88 74,88" fill="${BEIGE_D}"/>
`;
const basis = wrap(basisInner);

/** The mark cropped to its bounds, for the masthead and other chrome. */
export const mark = wrap(basisInner, '20 30 82 60');

/* 02 · schaduw */
const schaduw = wrap(`
	<defs><filter id="k-b-sh" x="-20%" y="-20%" width="140%" height="140%">
		<feDropShadow dx="1.5" dy="2.5" stdDeviation="2.2" flood-color="#1a1b1e" flood-opacity="0.35"/>
	</filter></defs>
	<g filter="url(#k-b-sh)">${basisInner}</g>
`);

/* 03 / 04 · omtrek — the gevuld skeleton with the fills dropped: every
   keyline drawn in one ink, nothing filled. Masks erase the parts of each
   line that gevuld's fills would have covered (lower cards under upper
   ones, everything under the strap). */
const strapSilhouette = 'M68 32 H76 V80 L82 88 H74 L68 80 Z';
const omtrekMark = (c: string, id: string) =>
	wrap(`
	<defs>
	<mask id="${id}-2">
		<rect x="0" y="0" width="120" height="120" fill="#fff"/>
		<rect x="22" y="32" width="72" height="48" rx="5" fill="#000"/>
		<path d="${strapSilhouette}" fill="#000"/>
	</mask>
	<mask id="${id}-3">
		<rect x="0" y="0" width="120" height="120" fill="#fff"/>
		<rect x="22" y="32" width="72" height="48" rx="5" fill="#000"/>
		<rect x="25" y="36" width="72" height="48" rx="5" fill="#000"/>
		<path d="${strapSilhouette}" fill="#000"/>
	</mask>
	<mask id="${id}-1">
		<rect x="0" y="0" width="120" height="120" fill="#fff"/>
		<path d="${strapSilhouette}" fill="#000"/>
	</mask>
	</defs>
	<g fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
		<rect x="28" y="40" width="72" height="48" rx="5" mask="url(#${id}-3)"/>
		<rect x="25" y="36" width="72" height="48" rx="5" mask="url(#${id}-2)"/>
		<g mask="url(#${id}-1)">
			<rect x="22" y="32" width="72" height="48" rx="5"/>
			<rect x="29.2" y="44" width="50.4" height="27" rx="2.5"/>
			<path d="M34 51.5 H50"/>
			<path d="M34 57.5 H61"/>
			<path d="M34 63.5 H54"/>
		</g>
		<path d="${strapSilhouette}"/>
		<path d="M68 80 H76"/>
	</g>
`);
const omtrekWit = omtrekMark('#fbfaf6', 'k-b-ow');
const omtrekZwart = omtrekMark('#1a1b1e', 'k-b-oz');

/* 05 / 06 · gevuld with a contour: white = sticker cut, black = keyline */
const gevuldOmtrek = (c: string) =>
	wrap(`
	<g fill="${c}" stroke="${c}" stroke-width="6" stroke-linejoin="round">
		<rect x="28" y="40" width="72" height="48" rx="5"/>
		<rect x="25" y="36" width="72" height="48" rx="5"/>
		<rect x="22" y="32" width="72" height="48" rx="5"/>
	</g>
	<g stroke="${c}" stroke-width="2.2" stroke-linejoin="round">
		<rect x="28" y="40" width="72" height="48" rx="5" fill="${G3}"/>
		<rect x="25" y="36" width="72" height="48" rx="5" fill="${G2}"/>
		<rect x="22" y="32" width="72" height="48" rx="5" fill="${G1}"/>
		<rect x="29.2" y="44" width="50.4" height="27" rx="2.5" fill="${WHITE}"/>
	</g>
	<rect x="34" y="50" width="16" height="3" rx="1.5" fill="${G2}" opacity="0.55"/>
	<rect x="34" y="56" width="27" height="3" rx="1.5" fill="${G2}" opacity="0.55"/>
	<rect x="34" y="62" width="20" height="3" rx="1.5" fill="${G2}" opacity="0.55"/>
	<g stroke="${c}" stroke-width="2.2" stroke-linejoin="round">
		<polygon points="68,80 76,80 82,88 74,88" fill="${BEIGE_D}"/>
		<rect x="68" y="32" width="8" height="48" fill="${BEIGE}"/>
	</g>
`);
const gevuldWit = gevuldOmtrek('#fbfaf6');
const gevuldZwart = gevuldOmtrek('#1a1b1e');

export type Plate = {
	nr: string;
	title: string;
	meta: string;
	note: string;
	svg: string;
};

export const plates: Plate[] = [
	{ nr: '01', title: 'basis', meta: 'full colour', svg: basis,
		note: 'The mark. Full colour, for wherever the interface or the paper allows it.' },
	{ nr: '02', title: 'gevuld, omtrek zwart', meta: 'full colour', svg: gevuldZwart,
		note: 'Black keyline edition; holds its own on busy or mid-tone backgrounds.' },
	{ nr: '03', title: 'omtrek zwart', meta: 'keyline', svg: omtrekZwart,
		note: 'The same lines in black: stamps, embossing, one-colour print.' },
	{ nr: '04', title: 'schaduw', meta: 'drop shadow', svg: schaduw,
		note: 'Lifted off the page — hero spots, slides, the odd poster.' },
	{ nr: '05', title: 'gevuld, omtrek wit', meta: 'full colour', svg: gevuldWit,
		note: 'Sticker cut — a white contour around and between the parts.' },
	{ nr: '06', title: 'omtrek wit', meta: 'keyline', svg: omtrekWit,
		note: 'Keylines only, in white: photography and dark surfaces.' },
];
