import { describe, expect, it } from 'vitest'

import { applyCanonicalBatch, handleReorg, invalidateCanonicalRange, updateFinality } from './store.js'
import { createCanonicalBatch, createConfig, createMockDb, createMockProvider, createReorgBatch } from '../test/factories.js'

describe('applyCanonicalBatch', () => {
	it('writes the journal, checkpoint, and projection job', async () => {
		const batch = createCanonicalBatch()
		const { db, calls } = createMockDb({
			onQuery: async (sql) => (
				sql.includes('select id, from_block_number, to_block_number') ?
					{
						command: '',
						rowCount: 0,
						oid: 0,
						fields: [],
						rows: [],
					}
				:
					{
						command: '',
						rowCount: 0,
						oid: 0,
						fields: [],
						rows: [],
					}
			),
		})

		await applyCanonicalBatch({
			db,
			config: createConfig(),
			batch,
		})

		expect(calls.some(({ sql }) => (
			sql.includes('insert into blocks')
		))).toBe(true)
		expect(calls.some(({ sql }) => (
			sql.includes('insert into transactions')
		))).toBe(true)
		expect(calls.some(({ sql }) => (
			sql.includes('insert into receipts')
		))).toBe(true)
		expect(calls.some(({ sql }) => (
			sql.includes('insert into logs')
		))).toBe(true)
		expect(calls.some(({ sql }) => (
			sql.includes('insert into accounts')
		))).toBe(true)
		expect(calls.some(({ sql }) => (
			sql.includes('insert into contracts')
		))).toBe(true)
		expect(calls.some(({ sql }) => (
			sql.includes('insert into ingest_checkpoints')
		))).toBe(true)
		expect(calls.some(({ sql }) => (
			sql.includes('insert into projection_jobs')
		))).toBe(true)
	})

	it('enriches touched accounts and created contracts with code metadata when provider is available', async () => {
		const batch = createCanonicalBatch()
		const { db, calls } = createMockDb({
			onQuery: async (sql) => (
				sql.includes('select id, from_block_number, to_block_number') ?
					{
						command: '',
						rowCount: 0,
						oid: 0,
						fields: [],
						rows: [],
					}
				:
					{
						command: '',
						rowCount: 0,
						oid: 0,
						fields: [],
						rows: [],
					}
			),
		})
		const provider = createMockProvider(async ({ method, params }) => (
			method === 'eth_getCode' && Array.isArray(params) && params[0] === '0x3333333333333333333333333333333333333333' ?
				'0x60016000'
			:
				'0x'
		))

		await applyCanonicalBatch({
			db,
			config: createConfig(),
			batch,
			provider,
		})

		expect(calls.find(({ sql, params }) => (
			sql.includes('insert into accounts')
			&& params?.[1] === '0x3333333333333333333333333333333333333333'
		))?.params?.[5]).toBe('0xcf61a6eb3b9b89e75f1dadf3dcd16509616896cb50eac765a68fa27bbbc6de82')

		expect(calls.find(({ sql }) => (
			sql.includes('insert into contracts')
		))?.params?.slice(4, 6)).toEqual([
			'0xcf61a6eb3b9b89e75f1dadf3dcd16509616896cb50eac765a68fa27bbbc6de82',
			4,
		])
	})
})

describe('handleReorg', () => {
	it('marks removed branches non-canonical and records a rebuild', async () => {
		let projectionJobChecks = 0
		const { db, calls } = createMockDb({
			onQuery: async (sql) => {
				if (sql.includes('select id, from_block_number, to_block_number')) {
					projectionJobChecks += 1

					return {
						command: '',
						rowCount: 0,
						oid: 0,
						fields: [],
						rows: projectionJobChecks === 1 ?
							[]
						:
							[
								{
									id: 9,
									from_block_number: '42',
									to_block_number: '42',
								},
							],
					}
				}

				return {
					command: '',
					rowCount: 0,
					oid: 0,
					fields: [],
					rows: [],
				}
			},
		})

		await handleReorg({
			db,
			config: createConfig(),
			reorg: createReorgBatch(),
		})

		expect(calls.some(({ sql }) => (
			sql.includes('insert into reorg_events')
		))).toBe(true)
		expect(calls.some(({ sql }) => (
			sql.includes('update blocks') && sql.includes('set canonical = false')
		))).toBe(true)
		expect(calls.some(({ sql }) => (
			sql.includes('update transactions') && sql.includes('set canonical = false')
		))).toBe(true)
		expect(calls.some(({ sql }) => (
			sql.includes('update receipts') && sql.includes('set canonical = false')
		))).toBe(true)
		expect(calls.some(({ sql }) => (
			sql.includes('update logs') && sql.includes('removed = true')
		))).toBe(true)
		expect(calls.some(({ sql }) => (
			sql.includes('update projection_jobs')
		))).toBe(true)
	})
})

describe('updateFinality', () => {
	it('uses provider safe/finalized tags when available', async () => {
		const { db, calls } = createMockDb({
			onQuery: async (sql) => (
				sql.includes('select max(block_number) as head') ?
					{
						command: '',
						rowCount: 1,
						oid: 0,
						fields: [],
						rows: [
							{
								head: '100',
							},
						],
					}
				:
					{
						command: '',
						rowCount: 0,
						oid: 0,
						fields: [],
						rows: [],
					}
			),
		})
		const provider = createMockProvider(async ({ params }) => {
			const tag = Array.isArray(params) ? params[0] : undefined

			return tag === 'finalized' ?
				{
					number: '0x59',
				}
			:
				{
					number: '0x5f',
				}
		})

		await updateFinality({
			db,
			config: createConfig(),
			capabilities: {
				endpointId: 'wss://execution-node.example',
				chainId: 1n,
				supportsBlockReceipts: true,
				supportsBlockHashLogs: true,
				supportsSafeTag: true,
				supportsFinalizedTag: true,
				checkedAt: new Date(),
				rawJson: {},
			},
			provider,
		})

		expect(calls.find(({ sql }) => (
			sql.includes('update blocks')
		))?.params).toEqual([
			'1',
			'89',
			'95',
		])
	})

	it('falls back to depth-based finality when tags are unavailable', async () => {
		const { db, calls } = createMockDb({
			onQuery: async (sql) => (
				sql.includes('select max(block_number) as head') ?
					{
						command: '',
						rowCount: 1,
						oid: 0,
						fields: [],
						rows: [
							{
								head: '100',
							},
						],
					}
				:
					{
						command: '',
						rowCount: 0,
						oid: 0,
						fields: [],
						rows: [],
					}
			),
		})

		await updateFinality({
			db,
			config: createConfig(),
			capabilities: {
				endpointId: 'wss://execution-node.example',
				chainId: 1n,
				supportsBlockReceipts: true,
				supportsBlockHashLogs: true,
				supportsSafeTag: false,
				supportsFinalizedTag: false,
				checkedAt: new Date(),
				rawJson: {},
			},
			provider: createMockProvider(async () => {
				throw new Error('not called')
			}),
		})

		expect(calls.find(({ sql }) => (
			sql.includes('update blocks')
		))?.params).toEqual([
			'1',
			'36',
			'36',
		])
	})
})

describe('invalidateCanonicalRange', () => {
	it('invalidates canonical rows and rewinds the checkpoint to the previous canonical block', async () => {
		const { db, calls } = createMockDb({
			onQuery: async (sql) => (
				sql.includes('select block_number, block_hash') ?
					{
						command: '',
						rowCount: 1,
						oid: 0,
						fields: [],
						rows: [
							{
								block_number: '39',
								block_hash: '0xprev',
							},
						],
					}
				:
					{
						command: '',
						rowCount: 0,
						oid: 0,
						fields: [],
						rows: [],
					}
			),
		})

		await invalidateCanonicalRange({
			db,
			config: createConfig(),
			fromBlockNumber: 40n,
		})

		expect(calls.some(({ sql }) => (
			sql.includes('update logs') && sql.includes('removed = true')
		))).toBe(true)
		expect(calls.some(({ sql }) => (
			sql.includes('update receipts') && sql.includes('canonical = false')
		))).toBe(true)
		expect(calls.some(({ sql }) => (
			sql.includes('update transactions') && sql.includes('canonical = false')
		))).toBe(true)
		expect(calls.some(({ sql }) => (
			sql.includes('update blocks') && sql.includes("finality_state = 'latest'")
		))).toBe(true)
		expect(calls.some(({ sql, params }) => (
			sql.includes('insert into ingest_checkpoints')
			&& params?.[1] === '39'
			&& params?.[2] === '0xprev'
		))).toBe(true)
	})

	it('deletes the checkpoint when no previous canonical block exists', async () => {
		const { db, calls } = createMockDb({
			onQuery: async () => ({
				command: '',
				rowCount: 0,
				oid: 0,
				fields: [],
				rows: [],
			}),
		})

		await invalidateCanonicalRange({
			db,
			config: createConfig(),
			fromBlockNumber: 0n,
		})

		expect(calls.some(({ sql }) => (
			sql.includes('delete from ingest_checkpoints')
		))).toBe(true)
	})
})
