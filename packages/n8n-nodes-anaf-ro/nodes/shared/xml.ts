/**
 * Minimal, dependency-free parsing for the small XML envelopes ANAF returns from
 * e-Factura (`<header ... />` with optional `<Errors errorMessage="..."/>` children).
 * It is not a general XML parser and is only used on those envelopes.
 */

function decodeEntities(value: string): string {
	return value
		.replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&');
}

function parseAttributes(source: string): Record<string, string> {
	const attributes: Record<string, string> = {};
	const pattern = /([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(source)) !== null) {
		const name = match[1];
		if (name === 'xmlns' || name.startsWith('xmlns:')) continue;
		attributes[name] = decodeEntities(match[3] ?? match[4] ?? '');
	}
	return attributes;
}

export interface AnafXmlHeader {
	/** Attributes of the root `<header>` element, without namespace declarations. */
	attributes: Record<string, string>;
	/** `errorMessage` values of every `<Errors>` child. */
	errors: string[];
}

/** Returns undefined when the text has no `<header>` root element. */
export function parseAnafHeader(xml: string): AnafXmlHeader | undefined {
	const header = /<(?:[\w-]+:)?header\b([^>]*?)\/?>/i.exec(xml);
	if (!header) return undefined;
	const errors: string[] = [];
	const errorPattern = /<(?:[\w-]+:)?Errors\b([^>]*?)\/?>/gi;
	let match: RegExpExecArray | null;
	while ((match = errorPattern.exec(xml)) !== null) {
		const message = parseAttributes(match[1]).errorMessage;
		if (message) errors.push(message);
	}
	return { attributes: parseAttributes(header[1]), errors };
}
