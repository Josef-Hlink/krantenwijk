/** Theme flip, shared by the desktop masthead and the /go header. */
export type Theme = 'ochtend' | 'avond';

export function currentTheme(): Theme {
	return document.documentElement.dataset.theme === 'avond' ? 'avond' : 'ochtend';
}

export function toggleTheme(): Theme {
	const next: Theme = currentTheme() === 'avond' ? 'ochtend' : 'avond';
	document.documentElement.dataset.theme = next;
	try {
		localStorage.setItem('krantenwijk-theme', next);
	} catch {
		// private browsing — the flip still applies for this session
	}
	return next;
}
