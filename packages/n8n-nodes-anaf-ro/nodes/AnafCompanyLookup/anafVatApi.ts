import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { sleep } from 'n8n-workflow';
import type { RequestResult } from '../shared/http';
import { extractHttpError, withRetry } from '../shared/http';

/** Public ANAF VAT payer web service, synchronous v9 (no authentication). */
export const ANAF_VAT_URL = 'https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva';

/** ANAF limits: max 100 CUIs per request and max 1 request per second per client. */
export const MAX_CUIS_PER_REQUEST = 100;
export const MIN_INTERVAL_MS = 1100;

export interface AnafVatResponse {
	cod?: number;
	message?: string;
	found?: IDataObject[];
	notFound?: Array<number | string>;
}

export interface LookupResult {
	found: Map<string, IDataObject>;
	notFound: Set<string>;
}

/** Today's date (yyyy-MM-dd) in Romania, used when no query date is given. */
export function todayInRomania(now = new Date()): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Europe/Bucharest',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).format(now);
}

export function toAnafDate(value: unknown): string {
	if (value === undefined || value === null || value === '') return todayInRomania();
	const text = String(value).trim();
	if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
	const parsed = new Date(text);
	if (Number.isNaN(parsed.getTime())) {
		throw new Error(`Invalid date "${text}". Use the format YYYY-MM-DD.`);
	}
	return todayInRomania(parsed);
}

export function chunk<T>(values: T[], size: number): T[][] {
	const result: T[][] = [];
	for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size));
	return result;
}

function cuiKey(record: IDataObject): string | undefined {
	const general = record.date_generale as IDataObject | undefined;
	const cui = general?.cui ?? record.cui;
	return cui === undefined || cui === null ? undefined : String(cui);
}

/**
 * Query ANAF for a list of (unique) CUIs on one date. Splits the list into chunks of
 * 100 and spaces requests at least 1.1 s apart to respect ANAF's 1 request/second rule.
 * ANAF answers HTTP 404 with a normal body when none of the CUIs are found, so that
 * case is treated as a successful "not found" response.
 */
export async function lookupCuis(
	ctx: IExecuteFunctions,
	cuis: string[],
	date: string,
): Promise<RequestResult<LookupResult>> {
	const found = new Map<string, IDataObject>();
	const notFound = new Set<string>();
	const chunks = chunk(cuis, MAX_CUIS_PER_REQUEST);

	for (let index = 0; index < chunks.length; index++) {
		if (index > 0) await sleep(MIN_INTERVAL_MS);
		const body = chunks[index].map((cui) => ({ cui: Number(cui), data: date }));

		const result = await withRetry(
			async () =>
				(await ctx.helpers.httpRequest({
					method: 'POST',
					url: ANAF_VAT_URL,
					body,
					json: true,
					headers: { Accept: 'application/json' },
				})) as AnafVatResponse,
			{ retryOnServerError: true, baseDelayMs: 2000 },
		);

		let response: AnafVatResponse;
		if (result.ok) {
			response = result.value;
		} else {
			const info = extractHttpError(result.error);
			const data = info.body as AnafVatResponse | undefined;
			if (info.status === 404 && data && Array.isArray(data.notFound)) {
				response = data;
			} else {
				return { ok: false, error: result.error };
			}
		}

		if (typeof response.cod === 'number' && response.cod !== 200 && response.cod !== 404) {
			return {
				ok: false,
				error: {
					message: response.message || `ANAF returned code ${response.cod}`,
					response: { status: response.cod, data: response },
				},
			};
		}

		for (const record of response.found ?? []) {
			const key = cuiKey(record);
			if (key) found.set(key, record);
		}
		for (const missing of response.notFound ?? []) notFound.add(String(missing));
	}

	for (const cui of cuis) {
		if (!found.has(cui)) notFound.add(cui);
	}
	return { ok: true, value: { found, notFound } };
}

/** Condense a full ANAF record to the VAT-related flags. */
export function toVatStatus(record: IDataObject): IDataObject {
	const general = (record.date_generale ?? {}) as IDataObject;
	const vat = (record.inregistrare_scop_Tva ?? {}) as IDataObject;
	const cashVat = (record.inregistrare_RTVAI ?? {}) as IDataObject;
	const inactive = (record.stare_inactiv ?? {}) as IDataObject;
	const split = (record.inregistrare_SplitTVA ?? {}) as IDataObject;

	return {
		cui: general.cui,
		date: general.data,
		name: general.denumire,
		vatRegistered: vat.scpTVA ?? null,
		vatPeriods: vat.perioade_TVA ?? [],
		vatOnCashBasis: cashVat.statusTvaIncasare ?? null,
		vatOnCashBasisFrom: cashVat.dataInceputTvaInc ?? null,
		vatOnCashBasisUntil: cashVat.dataSfarsitTvaInc ?? null,
		splitVat: split.statusSplitTVA ?? null,
		splitVatFrom: split.dataInceputSplitTVA ?? null,
		splitVatCancelled: split.dataAnulareSplitTVA ?? null,
		inactive: inactive.statusInactivi ?? null,
		inactiveSince: inactive.dataInactivare ?? null,
		reactivatedOn: inactive.dataReactivare ?? null,
		deregisteredOn: inactive.dataRadiere ?? null,
		eInvoiceRegistry: general.statusRO_e_Factura ?? null,
		registrationStatus: general.stare_inregistrare ?? null,
	};
}
