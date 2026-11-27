/**
 * Romanian CUI / CIF (fiscal identification code) helpers.
 *
 * Check digit algorithm: right-align the digits before the check digit against the
 * test key 753217532, multiply position by position, sum, multiply by 10, take the
 * remainder modulo 11 and then modulo 10 (a remainder of 10 becomes 0). The result
 * must equal the last digit. A CUI has 2 to 10 digits and may carry an "RO" prefix
 * when the entity is registered for VAT.
 *
 * ANAF does not publish this algorithm in its web service docs; this implementation
 * follows the widely used open-source validators (python-stdnum `stdnum.ro.cui`).
 */

const TEST_KEY = [7, 5, 3, 2, 1, 7, 5, 3, 2];

export type CuiValidationReason = 'ok' | 'empty' | 'format' | 'length' | 'checksum';

export interface CuiValidationResult {
	input: string;
	cui: string;
	valid: boolean;
	reason: CuiValidationReason;
	hasRoPrefix: boolean;
	checkDigit?: number;
	expectedCheckDigit?: number;
}

/** Strip whitespace, dots and dashes and an optional RO prefix. */
export function normalizeCui(input: string | number): { cui: string; hasRoPrefix: boolean } {
	let value = String(input)
		.toUpperCase()
		.replace(/[\s.-]/g, '');
	const hasRoPrefix = value.startsWith('RO');
	if (hasRoPrefix) value = value.slice(2);
	return { cui: value, hasRoPrefix };
}

export function calculateCheckDigit(body: string): number {
	const padded = body.padStart(9, '0');
	let sum = 0;
	for (let i = 0; i < 9; i++) sum += TEST_KEY[i] * Number(padded[i]);
	return ((sum * 10) % 11) % 10;
}

export function validateCui(input: string | number): CuiValidationResult {
	const raw = String(input ?? '');
	const { cui, hasRoPrefix } = normalizeCui(raw);
	const base = { input: raw, cui, hasRoPrefix };

	if (cui === '') return { ...base, valid: false, reason: 'empty' };
	if (!/^\d+$/.test(cui) || cui.startsWith('0')) return { ...base, valid: false, reason: 'format' };
	if (cui.length < 2 || cui.length > 10) return { ...base, valid: false, reason: 'length' };

	const checkDigit = Number(cui[cui.length - 1]);
	const expectedCheckDigit = calculateCheckDigit(cui.slice(0, -1));
	const valid = checkDigit === expectedCheckDigit;
	return {
		...base,
		valid,
		reason: valid ? 'ok' : 'checksum',
		checkDigit,
		expectedCheckDigit,
	};
}

export function isValidCui(input: string | number): boolean {
	return validateCui(input).valid;
}

export function describeCuiProblem(result: CuiValidationResult): string {
	switch (result.reason) {
		case 'empty':
			return 'CUI is empty';
		case 'format':
			return `CUI "${result.input}" must contain only digits (optionally prefixed with RO) and must not start with 0`;
		case 'length':
			return `CUI "${result.input}" must have between 2 and 10 digits`;
		case 'checksum':
			return `CUI "${result.input}" has an invalid check digit (expected ${result.expectedCheckDigit}, got ${result.checkDigit})`;
		default:
			return '';
	}
}
