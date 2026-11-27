import { describe, expect, it } from 'vitest';
import { calculateCheckDigit, isValidCui, normalizeCui, validateCui } from '../nodes/shared/cui';

describe('CUI validator', () => {
	it('accepts the python-stdnum reference example with and without RO prefix', () => {
		expect(isValidCui('18547290')).toBe(true);
		expect(isValidCui('RO 185 472 90')).toBe(true);
		expect(isValidCui('ro18547290')).toBe(true);
	});

	it('rejects a wrong check digit and reports the expected digit', () => {
		const result = validateCui('18547291');
		expect(result.valid).toBe(false);
		expect(result.reason).toBe('checksum');
		expect(result.expectedCheckDigit).toBe(0);
	});

	it('maps a remainder of 10 to check digit 0', () => {
		// 1854729 gives (sum * 10) % 11 === 10, so the check digit must be 0.
		expect(calculateCheckDigit('1854729')).toBe(0);
	});

	it('handles short CUIs by left-padding', () => {
		expect(isValidCui('1235')).toBe(true);
		expect(isValidCui('12345674')).toBe(true);
		expect(isValidCui('10000008')).toBe(true);
	});

	it('rejects bad formats and lengths', () => {
		expect(validateCui('').reason).toBe('empty');
		expect(validateCui('12A45').reason).toBe('format');
		expect(validateCui('012345674').reason).toBe('format');
		expect(validateCui('1').reason).toBe('length');
		expect(validateCui('12345678901').reason).toBe('length');
	});

	it('normalizes separators and the RO prefix', () => {
		expect(normalizeCui(' RO-12.345.674 ')).toEqual({ cui: '12345674', hasRoPrefix: true });
		expect(normalizeCui(12345674)).toEqual({ cui: '12345674', hasRoPrefix: false });
	});
});
