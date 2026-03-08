import type { BlocksEvent, ReorgEvent, StreamBlock } from '@tevm/voltaire/block'
import type { Pool, PoolClient } from 'pg'

export type Eip1193RequestArguments = {
	method: string
	params?: unknown
}

export type Eip1193Provider = {
	request(args: Eip1193RequestArguments): Promise<unknown>
}

export type ManagedProvider = Eip1193Provider & {
	on(event: PropertyKey, listener: (...args: unknown[]) => void): ManagedProvider
	removeListener(event: PropertyKey, listener: (...args: unknown[]) => void): ManagedProvider
	close(): Promise<void>
	getHealth(): ProviderHealth
}

export type ProviderHealth = {
	connected: boolean
	lastConnectedAt: number | null
	lastDisconnectedAt: number | null
	lastError: string | null
}

export type IngestConfig = {
	chainId: bigint
	rpcWssUrl: string
	databaseUrl: string
	forceReceiptFallback: boolean
	blockstreamPollingIntervalMs: number
	finalityDepth: bigint
	backfillChunkSize: number
	ingestStartBlock: bigint
	ingestRecentBlocksOnly?: number
	rpcRequestTimeoutMs: number
	reconnectBackoffMinMs: number
	reconnectBackoffMaxMs: number
	receiptFetchConcurrency: number
	backfillTxBatchSize: number
	projectionJobMinRange: number
	projectionJobCoalesceGap: number
	eventStreamErc20Enabled: boolean
}

export type RpcCapabilities = {
	endpointId: string
	chainId: bigint
	supportsBlockReceipts: boolean
	supportsBlockHashLogs: boolean
	supportsSafeTag: boolean
	supportsFinalizedTag: boolean
	checkedAt: Date
	rawJson: Record<string, unknown>
}

export type IngestCheckpoint = {
	chainId: bigint
	lastSeenBlockNumber: bigint
	lastSeenBlockHash: string
	lastFinalizedBlockNumber: bigint
	updatedAt: Date
}

export type CanonicalBlock = StreamBlock<'receipts'>

export type CanonicalBatch = BlocksEvent<'receipts'>

export type ReorgBatch = ReorgEvent<'receipts'>

export type DbQuery = {
	query(sql: string, params?: unknown[]): Promise<{
		rows: Record<string, unknown>[]
	}>
}

export type DbTx = PoolClient

export type Db = Pool
