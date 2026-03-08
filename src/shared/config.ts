import type { IngestConfig } from './types.js'

const getEnv = (name: string) => {
	const value = process.env[name]

	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`)
	}

	return value
}

const getEnvNumber = (name: string, fallback?: number) => {
	const rawValue = process.env[name] ?? (fallback === undefined ? undefined : String(fallback))

	if (!rawValue) {
		throw new Error(`Missing required numeric environment variable: ${name}`)
	}

	const value = Number(rawValue)

	if (!Number.isInteger(value) || value < 0) {
		throw new Error(`Invalid numeric environment variable: ${name}=${rawValue}`)
	}

	return value
}

const getEnvBigInt = (name: string, fallback?: bigint) => {
	const rawValue = process.env[name] ?? fallback?.toString()

	if (!rawValue) {
		throw new Error(`Missing required bigint environment variable: ${name}`)
	}

	try {
		const value = BigInt(rawValue)

		if (value < 0n) {
			throw new Error('negative')
		}

		return value
	} catch {
		throw new Error(`Invalid bigint environment variable: ${name}=${rawValue}`)
	}
}

const getEnvBoolean = (name: string, fallback: boolean) => {
	const rawValue = process.env[name]

	return !rawValue ?
		fallback
	: rawValue === '1' || rawValue === 'true' ?
		true
	: rawValue === '0' || rawValue === 'false' ?
		false
	:
		(() => {
			throw new Error(`Invalid boolean environment variable: ${name}=${rawValue}`)
		})()
}

export const loadConfig = (): IngestConfig => ({
	chainId: getEnvBigInt('CHAIN_ID', 1n),
	rpcWssUrl: getEnv('RPC_WSS_URL'),
	databaseUrl: getEnv('DATABASE_URL'),
	forceReceiptFallback: getEnvBoolean('FORCE_RECEIPT_FALLBACK', false),
	blockstreamPollingIntervalMs: getEnvNumber('BLOCKSTREAM_POLLING_INTERVAL_MS', 1000),
	finalityDepth: getEnvBigInt('FINALITY_DEPTH', 64n),
	backfillChunkSize: getEnvNumber('BACKFILL_CHUNK_SIZE', 100),
	ingestStartBlock: getEnvBigInt('INGEST_START_BLOCK', 0n),
	ingestRecentBlocksOnly: (() => {
		const raw = process.env.INGEST_RECENT_BLOCKS_ONLY
		if (raw === undefined || raw === '') return undefined
		const n = Number(raw)
		if (!Number.isInteger(n) || n < 1) {
			throw new Error(`Invalid INGEST_RECENT_BLOCKS_ONLY=${raw}: must be a positive integer`)
		}
		return n
	})(),
	rpcRequestTimeoutMs: getEnvNumber('RPC_REQUEST_TIMEOUT_MS', 30000),
	reconnectBackoffMinMs: getEnvNumber('RECONNECT_BACKOFF_MIN_MS', 1000),
	reconnectBackoffMaxMs: getEnvNumber('RECONNECT_BACKOFF_MAX_MS', 30000),
	receiptFetchConcurrency: getEnvNumber('RECEIPT_FETCH_CONCURRENCY', 16),
	backfillTxBatchSize: getEnvNumber('BACKFILL_TX_BATCH_SIZE', 32),
	projectionJobMinRange: getEnvNumber('PROJECTION_JOB_MIN_RANGE', 1),
	projectionJobCoalesceGap: getEnvNumber('PROJECTION_JOB_COALESCE_GAP', 8),
	eventStreamErc20Enabled: getEnvBoolean('EVENT_STREAM_ERC20_ENABLED', false),
})
