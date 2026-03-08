import type { BlocksEvent, ReorgEvent } from '@tevm/voltaire/block'
import type { QueryResult } from 'pg'

import type { CanonicalBatch, DbQuery, Eip1193Provider, IngestConfig, ReorgBatch } from '../shared/types.js'

const hex32 = (byte: string) => (
	`0x${byte.repeat(64)}`
)

const createResult = (rows: Record<string, unknown>[] = []): QueryResult<Record<string, unknown>> => ({
	command: '',
	rowCount: rows.length,
	oid: 0,
	fields: [],
	rows,
})

export const createConfig = (overrides: Partial<IngestConfig> = {}): IngestConfig => ({
	chainId: 1n,
	rpcWssUrl: 'wss://execution-node.example',
	databaseUrl: 'postgres://blockhead:blockhead@localhost:5432/blockhead',
	forceReceiptFallback: false,
	blockstreamPollingIntervalMs: 1000,
	finalityDepth: 64n,
	backfillChunkSize: 100,
	ingestStartBlock: 0n,
	rpcRequestTimeoutMs: 30000,
	reconnectBackoffMinMs: 1000,
	reconnectBackoffMaxMs: 30000,
	receiptFetchConcurrency: 16,
	backfillTxBatchSize: 32,
	projectionJobMinRange: 1,
	projectionJobCoalesceGap: 8,
	...overrides,
})

export const createMockProvider = (
	request: Eip1193Provider['request'],
): Eip1193Provider => {
	const listeners = new Map<PropertyKey, Set<(...args: unknown[]) => void>>()

	const provider = {
		request,
		on(event: PropertyKey, listener: (...args: unknown[]) => void) {
			const key = typeof event === 'number' ? String(event) : event
			const currentListeners = listeners.get(key) ?? new Set()
			currentListeners.add(listener)
			listeners.set(key, currentListeners)
			return provider
		},
		removeListener(event: PropertyKey, listener: (...args: unknown[]) => void) {
			const key = typeof event === 'number' ? String(event) : event
			listeners.get(key)?.delete(listener)
			return provider
		},
	}

	return provider
}

export const createMockDb = ({
	onQuery = async () => (
		createResult()
	),
}: {
	onQuery?: (sql: string, params: unknown[] | undefined) => Promise<QueryResult<Record<string, unknown>>>
} = {}): {
	db: DbQuery
	calls: {
		sql: string
		params: unknown[] | undefined
	}[]
} => {
	const calls: {
		sql: string
		params: unknown[] | undefined
	}[] = []

	const db: DbQuery = {
		async query(sql, params) {
			const copiedParams = params ? [...params] : undefined

			calls.push({
				sql,
				params: copiedParams,
			})

			return onQuery(sql, copiedParams)
		},
	}

	return {
		db,
		calls,
	}
}

export const createCanonicalBatch = ({
	blockNumber = 42n,
	chainHead = 42n,
}: {
	blockNumber?: bigint
	chainHead?: bigint
} = {}): CanonicalBatch => {
	return {
		type: 'blocks',
		blocks: [
			{
				hash: hex32('a'),
				size: 1n,
				header: {
					parentHash: hex32('c'),
					ommersHash: hex32('0'),
					beneficiary: '0x1111111111111111111111111111111111111111',
					stateRoot: hex32('0'),
					transactionsRoot: hex32('0'),
					receiptsRoot: hex32('0'),
					logsBloom: new Uint8Array(256),
					difficulty: 0n,
					number: blockNumber,
					gasLimit: 30000000n,
					gasUsed: 21000n,
					timestamp: 1700000000n,
					extraData: new Uint8Array(),
					mixHash: hex32('0'),
					nonce: new Uint8Array(8),
					baseFeePerGas: 1n,
				},
				body: {
					transactions: [
						{
							type: 0,
							nonce: 1n,
							gasPrice: 1n,
							gasLimit: 21000n,
							to: '0x2222222222222222222222222222222222222222',
							value: 5n,
							data: new Uint8Array(),
							v: 27n,
							r: new Uint8Array(32),
							s: new Uint8Array(32),
						},
					],
					ommers: [],
				},
				receipts: [
					{
						transactionHash: hex32('b'),
						transactionIndex: 0,
						blockHash: hex32('a'),
						blockNumber,
						from: '0x1111111111111111111111111111111111111111',
						to: '0x2222222222222222222222222222222222222222',
						cumulativeGasUsed: 21000n,
						gasUsed: 21000n,
						contractAddress: '0x3333333333333333333333333333333333333333',
						logs: [
							{
								address: '0x3333333333333333333333333333333333333333',
								topics: [
									hex32('d'),
								],
								data: new Uint8Array([
									1,
									2,
									3,
								]),
								blockNumber,
								transactionHash: hex32('b'),
								transactionIndex: 0,
								blockHash: hex32('a'),
								logIndex: 0,
								removed: false,
							},
						],
						logsBloom: new Uint8Array(256),
						status: 1,
						effectiveGasPrice: 1n,
						type: 'legacy',
					},
				],
			},
		],
		metadata: {
			chainHead,
		},
	} as unknown as CanonicalBatch
}

export const createTransactionsBatch = (): BlocksEvent<'transactions'> => {
	const canonicalBatch = createCanonicalBatch()

	return {
		type: 'blocks',
		blocks: canonicalBatch.blocks.map(({ receipts, ...block }) => (
			block
		)),
		metadata: canonicalBatch.metadata,
	} as unknown as BlocksEvent<'transactions'>
}

export const createReorgBatch = (): ReorgBatch => {
	const replacementBatch = createCanonicalBatch({
		blockNumber: 42n,
		chainHead: 43n,
	})

	return {
		type: 'reorg',
		removed: [
			{
				number: 42n,
				hash: hex32('e'),
				parentHash: hex32('c'),
				timestamp: 1700000000n,
			},
		],
		added: replacementBatch.blocks,
		commonAncestor: {
			number: 41n,
			hash: hex32('c'),
			parentHash: hex32('f'),
			timestamp: 1699999990n,
		},
		metadata: replacementBatch.metadata,
	} as unknown as ReorgBatch
}

export const createTransactionsReorgBatch = (): ReorgEvent<'transactions'> => {
	const reorgBatch = createReorgBatch()

	return {
		type: 'reorg',
		removed: reorgBatch.removed,
		added: reorgBatch.added.map(({ receipts, ...block }) => (
			block
		)),
		commonAncestor: reorgBatch.commonAncestor,
		metadata: reorgBatch.metadata,
	} as unknown as ReorgEvent<'transactions'>
}
