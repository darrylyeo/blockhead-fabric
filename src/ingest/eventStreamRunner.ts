/**
 * EventStream runner for one protocol overlay (spec 001).
 * USDC Transfer events via Voltaire EventStream, persisted to adapter_events.
 */
import { EventStream, EventStreamAbortedError } from '@tevm/voltaire/contract'
import type { PoolClient } from 'pg'

const USDC_ADDRESS = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' as const
const STREAM_ID = 'erc20_usdc_transfer'
const ADAPTER_ID = 'event_stream_erc20'

const transferEvent = {
	type: 'event' as const,
	name: 'Transfer',
	inputs: [
		{ name: 'from', type: 'address', indexed: true },
		{ name: 'to', type: 'address', indexed: true },
		{ name: 'value', type: 'uint256', indexed: false },
	],
} as const

type Eip1193Provider = { request(args: { method: string, params?: unknown[] }): Promise<unknown> }

const hex = (value: unknown): string => {
	if (typeof value === 'string' && value.startsWith('0x')) {
		return value.toLowerCase()
	}
	if (typeof value === 'bigint') {
		return `0x${value.toString(16)}`
	}
	return String(value)
}

export const runEventStreamBackfill = async (args: {
	provider: Eip1193Provider
	db: PoolClient
	chainId: bigint
	fromBlock: bigint
	toBlock: bigint
	signal?: AbortSignal
}) => {
	const stream = EventStream({
		provider: args.provider as Parameters<typeof EventStream>[0]['provider'],
		address: USDC_ADDRESS,
		event: transferEvent,
	})

	for await (const { log, metadata } of stream.backfill({
		fromBlock: args.fromBlock,
		toBlock: args.toBlock,
		chunkSize: 100,
		signal: args.signal,
	})) {
		await args.db.query(
			`
				insert into adapter_events (
					chain_id,
					adapter_id,
					tx_hash,
					block_hash,
					log_index,
					target_address,
					event_family,
					payload_json,
					canonical
				)
				values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, true)
				on conflict (chain_id, adapter_id, tx_hash, log_index, block_hash) do update
				set payload_json = excluded.payload_json, canonical = true
			`,
			[
				args.chainId.toString(),
				ADAPTER_ID,
				hex(log.transactionHash),
				hex(log.blockHash),
				log.logIndex,
				USDC_ADDRESS,
				'transfer',
				JSON.stringify({
					from: hex(log.args.from),
					to: hex(log.args.to),
					value: log.args.value?.toString() ?? '0',
					blockNumber: log.blockNumber.toString(),
					tokenClass: 'usdc',
				}),
			],
		)
	}

	await args.db.query(
		`
			insert into event_stream_checkpoints (chain_id, stream_id, last_seen_block, updated_at)
			values ($1, $2, $3, now())
			on conflict (chain_id, stream_id) do update
			set last_seen_block = excluded.last_seen_block, updated_at = now()
		`,
		[
			args.chainId.toString(),
			STREAM_ID,
			args.toBlock.toString(),
		],
	)
}

export const runEventStreamWatch = async function* (args: {
	provider: Eip1193Provider
	db: PoolClient
	chainId: bigint
	fromBlock: bigint
	pollingInterval?: number
	signal?: AbortSignal
}) {
	const stream = EventStream({
		provider: args.provider as Parameters<typeof EventStream>[0]['provider'],
		address: USDC_ADDRESS,
		event: transferEvent,
	})

	for await (const { log, metadata } of stream.watch({
		fromBlock: args.fromBlock,
		pollingInterval: args.pollingInterval ?? 1000,
		signal: args.signal,
	})) {
		await args.db.query(
			`
				insert into adapter_events (
					chain_id,
					adapter_id,
					tx_hash,
					block_hash,
					log_index,
					target_address,
					event_family,
					payload_json,
					canonical
				)
				values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, true)
				on conflict (chain_id, adapter_id, tx_hash, log_index, block_hash) do update
				set payload_json = excluded.payload_json, canonical = true
			`,
			[
				args.chainId.toString(),
				ADAPTER_ID,
				hex(log.transactionHash),
				hex(log.blockHash),
				log.logIndex,
				USDC_ADDRESS,
				'transfer',
				JSON.stringify({
					from: hex(log.args.from),
					to: hex(log.args.to),
					value: log.args.value?.toString() ?? '0',
					blockNumber: log.blockNumber.toString(),
					tokenClass: 'usdc',
				}),
			],
		)

		await args.db.query(
			`
				insert into event_stream_checkpoints (chain_id, stream_id, last_seen_block, updated_at)
				values ($1, $2, $3, now())
				on conflict (chain_id, stream_id) do update
				set last_seen_block = excluded.last_seen_block, updated_at = now()
			`,
			[
				args.chainId.toString(),
				STREAM_ID,
				log.blockNumber.toString(),
			],
		)

		yield { blockNumber: log.blockNumber }
	}
}

export const invalidateEventStreamEvents = async (args: {
	db: PoolClient
	chainId: bigint
	blockHashes: string[]
}) => {
	if (args.blockHashes.length === 0) {
		return
	}

	await args.db.query(
		`
			update adapter_events
			set canonical = false
			where chain_id = $1
				and adapter_id = $2
				and block_hash = any($3)
		`,
		[
			args.chainId.toString(),
			ADAPTER_ID,
			args.blockHashes,
		],
	)
}

export { EventStreamAbortedError }
