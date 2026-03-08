import type { IngestConfig, IngestCheckpoint, RpcCapabilities } from './types.js'

export type LogLevel = 'info' | 'warn' | 'error'

export type LogRecord = {
	level: LogLevel
	event: string
	timestamp: string
	data?: Record<string, unknown>
}

type LoggerTarget = {
	log(line: string): void
	warn(line: string): void
	error(line: string): void
}

const normalizeError = (error: unknown) => (
	error instanceof Error ?
		{
			name: error.name,
			message: error.message,
		}
	:
		{
			message: String(error),
		}
)

const emit = ({
	target,
	record,
}: {
	target: LoggerTarget
	record: LogRecord
}) => {
	const line = JSON.stringify(record)

	if (record.level === 'warn') {
		target.warn(line)
		return
	}

	if (record.level === 'error') {
		target.error(line)
		return
	}

	target.log(line)
}

export const sanitizeConfigForLogs = (config: IngestConfig) => ({
	chainId: config.chainId.toString(),
	rpcWssUrl: config.rpcWssUrl,
	forceReceiptFallback: config.forceReceiptFallback,
	blockstreamPollingIntervalMs: config.blockstreamPollingIntervalMs,
	finalityDepth: config.finalityDepth.toString(),
	backfillChunkSize: config.backfillChunkSize,
	ingestStartBlock: config.ingestStartBlock.toString(),
	rpcRequestTimeoutMs: config.rpcRequestTimeoutMs,
	reconnectBackoffMinMs: config.reconnectBackoffMinMs,
	reconnectBackoffMaxMs: config.reconnectBackoffMaxMs,
	receiptFetchConcurrency: config.receiptFetchConcurrency,
	backfillTxBatchSize: config.backfillTxBatchSize,
	projectionJobMinRange: config.projectionJobMinRange,
	projectionJobCoalesceGap: config.projectionJobCoalesceGap,
})

export const capabilitiesForLogs = (capabilities: RpcCapabilities) => ({
	endpointId: capabilities.endpointId,
	chainId: capabilities.chainId.toString(),
	supportsBlockReceipts: capabilities.supportsBlockReceipts,
	supportsBlockHashLogs: capabilities.supportsBlockHashLogs,
	supportsSafeTag: capabilities.supportsSafeTag,
	supportsFinalizedTag: capabilities.supportsFinalizedTag,
	checkedAt: capabilities.checkedAt.toISOString(),
})

export const checkpointForLogs = (checkpoint: IngestCheckpoint | null) => (
	!checkpoint ?
		null
	:
		{
			chainId: checkpoint.chainId.toString(),
			lastSeenBlockNumber: checkpoint.lastSeenBlockNumber.toString(),
			lastSeenBlockHash: checkpoint.lastSeenBlockHash,
			lastFinalizedBlockNumber: checkpoint.lastFinalizedBlockNumber.toString(),
			updatedAt: checkpoint.updatedAt.toISOString(),
		}
)

export const createLogger = (target: LoggerTarget = console) => ({
	info(event: string, data?: Record<string, unknown>) {
		emit({
			target,
			record: {
				level: 'info',
				event,
				timestamp: new Date().toISOString(),
				data,
			},
		})
	},
	warn(event: string, data?: Record<string, unknown>) {
		emit({
			target,
			record: {
				level: 'warn',
				event,
				timestamp: new Date().toISOString(),
				data,
			},
		})
	},
	error(event: string, data?: Record<string, unknown>) {
		emit({
			target,
			record: {
				level: 'error',
				event,
				timestamp: new Date().toISOString(),
				data,
			},
		})
	},
	errorFrom(event: string, error: unknown, data?: Record<string, unknown>) {
		emit({
			target,
			record: {
				level: 'error',
				event,
				timestamp: new Date().toISOString(),
				data: {
					...data,
					error: normalizeError(error),
				},
			},
		})
	},
})

export type Logger = ReturnType<typeof createLogger>
