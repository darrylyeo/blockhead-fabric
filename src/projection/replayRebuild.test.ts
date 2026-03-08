import { describe, expect, it } from 'vitest'

import { connectDb } from '../db/connect.js'
import { createMockProvider } from '../test/factories.js'

import { loadProjectionConfig } from './config.js'
import { runProjectionRound } from './runRound.js'
import type { createWsProvider } from '../provider/createWsProvider.js'

const hasDatabase = Boolean(process.env.DATABASE_URL)

const mockProvider = (): ReturnType<typeof createWsProvider> => {
	const base = createMockProvider(async () => '0x0')
	return {
		...base,
		close: async () => {},
		getHealth: () => ({
			connected: true,
			lastConnectedAt: null,
			lastDisconnectedAt: null,
			lastError: null,
		}),
	} as unknown as ReturnType<typeof createWsProvider>
}

describe('end-to-end replay and rebuild (spec 006)', () => {
	it.skipIf(!hasDatabase)(
		'produces identical fabric_objects after full rebuild from same journal',
		async () => {
			const databaseUrl = process.env.DATABASE_URL ?? 'postgres://blockhead:blockhead@localhost:5432/blockhead'
			const db = connectDb({ databaseUrl }) as ReturnType<typeof connectDb>
			const config = {
				...loadProjectionConfig(),
				databaseUrl,
			}
			const provider = mockProvider()

			const client = await db.connect()
			try {
				const blockNumber = 21_190_000
				const blockHash = '0x' + 'a'.repeat(64)
				const parentHash = '0x' + 'b'.repeat(64)

				await client.query('begin')

				await client.query(
					`
					insert into blocks (
						chain_id, block_number, block_hash, parent_hash, timestamp,
						gas_used, gas_limit, tx_count, log_count, canonical, finality_state, first_seen_at
					)
					values ($1, $2::bigint, $3, $4, now(), 0, 0, 0, 0, true, 'latest', now())
					on conflict (chain_id, block_hash) do update set canonical = true
					`,
					[1, blockNumber.toString(), blockHash, parentHash],
				)
				await client.query(
					`
					insert into ingest_checkpoints (chain_id, last_seen_block_number, last_seen_block_hash, last_finalized_block_number, updated_at)
					values (1, $2::bigint, $1, ($2::bigint - 64), now())
					on conflict (chain_id) do update set
						last_seen_block_number = excluded.last_seen_block_number,
						last_seen_block_hash = excluded.last_seen_block_hash,
						updated_at = excluded.updated_at
					`,
					[blockHash, blockNumber.toString()],
				)
				await client.query(
					`
					insert into projection_jobs (chain_id, from_block_number, to_block_number, status)
					values (1, $1::bigint, $1::bigint, 'pending')
					`,
					[blockNumber.toString()],
				)
				await client.query('commit')

				const runOnce = async () => {
					const didRun = await runProjectionRound({
						config,
						db,
						provider,
					})
					if (!didRun) {
						throw new Error('Expected one projection job to run')
					}
				}

				await runOnce()
				const { rows: rowsA } = await client.query(
					`select scope_id, object_id, parent_object_id, entrypoint_id, desired_revision from fabric_objects order by scope_id, object_id`,
				)
				await client.query('delete from fabric_objects')
				await client.query('delete from fabric_entrypoints')
				await client.query('delete from fabric_attachments')
				await client.query('delete from fabric_scopes')
				await client.query('delete from projection_checkpoints')
				await client.query(
					`insert into projection_jobs (chain_id, from_block_number, to_block_number, status) values (1, $1::bigint, $1::bigint, 'pending')`,
					[blockNumber.toString()],
				)
				await runOnce()
				const { rows: rowsB } = await client.query(
					`select scope_id, object_id, parent_object_id, entrypoint_id, desired_revision from fabric_objects order by scope_id, object_id`,
				)

				expect(rowsA.length).toBeGreaterThan(0)
				expect(rowsA).toEqual(rowsB)
			} finally {
				client.release()
				await provider.close()
				await db.end()
			}
		},
		60_000,
	)
})
