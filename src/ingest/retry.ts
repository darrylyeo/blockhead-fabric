import { BlockStreamAbortedError, UnrecoverableReorgError } from '@tevm/voltaire/block'

const nonRetriableMessagePatterns = [
	/^Missing required environment variable:/,
	/^Missing required numeric environment variable:/,
	/^Missing required bigint environment variable:/,
	/^Invalid numeric environment variable:/,
	/^Invalid bigint environment variable:/,
	/^Expected chain /,
]

const retriableMessagePatterns = [
	/timeout/i,
	/ETIMEDOUT/i,
	/EHOSTUNREACH/i,
	/EPROTO/i,
	/Unexpected server response: (404|503)/i,
	/disconnect/i,
	/socket closed/i,
	/connection terminated/i,
	/terminating connection/i,
	/econnreset/i,
	/econnrefused/i,
	/too many clients/i,
	/RPC -32603/i,
]

const retriablePgCodes = new Set([
	'53300',
	'57P01',
	'57P02',
	'57P03',
])

export const getRetryDelayMs = ({
	attempt,
	minMs,
	maxMs,
}: {
	attempt: number
	minMs: number
	maxMs: number
}) => (
	Math.min(
		minMs * (2 ** attempt),
		maxMs,
	)
)

const retriableCodes = new Set(['ETIMEDOUT', 'EHOSTUNREACH', 'ECONNREFUSED', 'ECONNRESET'])

const messageOrCausesMatch = (error: unknown, patterns: RegExp[]): boolean => {
	if (error instanceof Error && patterns.some((p) => p.test(error.message))) {
		return true
	}
	if (typeof error === 'object' && error !== null && 'errors' in error && Array.isArray((error as { errors: unknown[] }).errors)) {
		return (error as { errors: unknown[] }).errors.some((e) => messageOrCausesMatch(e, patterns))
	}
	return false
}

export const isRetriableIngestError = (error: unknown) => {
	if (error instanceof BlockStreamAbortedError || error instanceof UnrecoverableReorgError) {
		return false
	}

	if (!(error instanceof Error)) {
		return false
	}

	if (nonRetriableMessagePatterns.some((pattern) => (
		pattern.test(error.message)
	))) {
		return false
	}

	if ('code' in error && typeof (error as { code?: string }).code === 'string') {
		const code = (error as { code: string }).code
		if (code.startsWith('08') || retriablePgCodes.has(code) || retriableCodes.has(code)) {
			return true
		}
	}
	const agg = typeof error === 'object' && error !== null && 'errors' in error ?
		(error as { errors: unknown[] }).errors
	: null
	if (Array.isArray(agg)) {
		if (agg.some((e) => isRetriableIngestError(e))) {
			return true
		}
		const codes = agg
			.filter((e): e is Error => e instanceof Error && 'code' in e)
			.map((e) => (e as { code?: string }).code)
		if (codes.some((c) => c && retriableCodes.has(c))) {
			return true
		}
	}

	return messageOrCausesMatch(error, retriableMessagePatterns)
}

export const sleep = async (ms: number) => {
	await new Promise((resolve) => {
		setTimeout(resolve, ms)
	})
}
