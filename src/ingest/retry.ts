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

	if ('code' in error && typeof error.code === 'string') {
		if (error.code.startsWith('08') || retriablePgCodes.has(error.code)) {
			return true
		}
	}

	return retriableMessagePatterns.some((pattern) => (
		pattern.test(error.message)
	))
}

export const sleep = async (ms: number) => {
	await new Promise((resolve) => {
		setTimeout(resolve, ms)
	})
}
