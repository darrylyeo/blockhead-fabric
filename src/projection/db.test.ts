import { describe, expect, it } from 'vitest'

import { persistAdapterEntities, persistAdapterHints, persistAdapterSurfaces, persistProjectedFabricState } from './db.js'

describe('persistProjectedFabricState', () => {
	it('partitions entrypoint object persistence and deletion by scope', async () => {
		const queries: {
			sql: string
			params: unknown[] | undefined
		}[] = []
		const db = {
			query: async (sql: string, params?: unknown[]) => {
				queries.push({
					sql,
					params,
				})

				return {
					rows: [],
				}
			},
		}

		await persistProjectedFabricState(db, {
			scope: {
				scopeId: 'scope_eth_mainnet',
				chainId: 1n,
				name: 'Ethereum Mainnet',
				entryMsfPath: '/fabric/',
				desiredRevision: 100n,
				status: 'active',
			},
			childScopes: [
				{
					scopeId: 'scope_attachment_1_pool_deadbeef',
					chainId: 1n,
					name: 'Inspect Pool',
					entryMsfPath: '/fabric/scopes/scope_attachment_1_pool_deadbeef/',
					desiredRevision: 100n,
					status: 'active',
				},
			],
			entrypoints: [
				{
					scopeId: 'scope_eth_mainnet',
					entrypointId: 'entry_shared',
					name: 'Main',
					rootObjectId: 'main_root',
					desiredRevision: 100n,
				},
				{
					scopeId: 'scope_attachment_1_pool_deadbeef',
					entrypointId: 'entry_shared',
					name: 'Inspect Pool',
					rootObjectId: 'child_root',
					desiredRevision: 100n,
				},
			],
			objects: [
				{
					scopeId: 'scope_eth_mainnet',
					objectId: 'main_root',
					entrypointId: 'entry_shared',
					parentObjectId: 'root',
					entityId: 'entry:main',
					classId: 72,
					type: 0,
					subtype: 0,
					name: 'Main',
					transformJson: {},
					boundJson: null,
					resourceReference: null,
					resourceName: null,
					metadataJson: {},
					deleted: false,
					desiredRevision: 100n,
					updatedAtBlock: 100n,
				},
				{
					scopeId: 'scope_attachment_1_pool_deadbeef',
					objectId: 'child_root',
					entrypointId: 'entry_shared',
					parentObjectId: 'root',
					entityId: 'entry:child',
					classId: 72,
					type: 0,
					subtype: 0,
					name: 'Inspect Pool',
					transformJson: {},
					boundJson: null,
					resourceReference: null,
					resourceName: null,
					metadataJson: {},
					deleted: false,
					desiredRevision: 100n,
					updatedAtBlock: 100n,
				},
			],
		})

		expect(queries.filter(({ sql }) => (
			sql.includes('insert into fabric_objects')
		)).map(({ params }) => (
			params?.[1]
		))).toEqual([
			'main_root',
			'child_root',
		])

		expect(queries.filter(({ sql }) => (
			sql.includes('update fabric_objects')
		)).map(({ params }) => (
			{
				scopeId: params?.[0],
				entrypointId: params?.[1],
				objectIds: params?.[3],
			}
		))).toEqual([
			{
				scopeId: 'scope_eth_mainnet',
				entrypointId: 'entry_shared',
				objectIds: [
					'main_root',
				],
			},
			{
				scopeId: 'scope_attachment_1_pool_deadbeef',
				entrypointId: 'entry_shared',
				objectIds: [
					'child_root',
				],
			},
		])
	})
})

describe('adapter persistence convergence', () => {
	it('replaces stale adapter entities and hints for a full adapter recompute', async () => {
		const queries: {
			sql: string
			params: unknown[] | undefined
		}[] = []
		const db = {
			query: async (sql: string, params?: unknown[]) => {
				queries.push({
					sql,
					params,
				})

				return {
					rows: [],
				}
			},
		}

		await persistAdapterEntities(db, [
			{
				chainId: 1n,
				address: '0x1111111111111111111111111111111111111111',
				adapterId: 'amm_pool',
				adapterVersion: 1,
				protocolId: 'amm_pool:0x1111111111111111111111111111111111111111',
				family: 'amm_pool',
				confidence: 'high',
				styleFamily: 'pool',
				metadataJson: {},
				detectedAtBlock: 100n,
				updatedAtBlock: 100n,
			},
		], {
			chainId: 1n,
			adapterId: 'amm_pool',
		})

		await persistAdapterHints(db, [
			{
				chainId: 1n,
				address: '0x1111111111111111111111111111111111111111',
				adapterId: 'amm_pool',
				hintType: 'attachment_candidate',
				payloadJson: {
					kind: 'amm-pool-inspect',
				},
				updatedAtBlock: 100n,
			},
		], {
			chainId: 1n,
			adapterId: 'amm_pool',
		})

		expect(queries[0]).toMatchObject({
			sql: expect.stringContaining('delete from adapter_entities'),
			params: [
				'1',
				'amm_pool',
				[
					'0x1111111111111111111111111111111111111111',
				],
			],
		})
		expect(queries[2]).toMatchObject({
			sql: expect.stringContaining('delete from adapter_hints'),
			params: [
				'1',
				'amm_pool',
				[
					'0x1111111111111111111111111111111111111111|attachment_candidate',
				],
			],
		})
	})

	it('replaces stale log-derived surfaces without deleting scheduled read surfaces', async () => {
		const queries: {
			sql: string
			params: unknown[] | undefined
		}[] = []
		const db = {
			query: async (sql: string, params?: unknown[]) => {
				queries.push({
					sql,
					params,
				})

				return {
					rows: [],
				}
			},
		}

		await persistAdapterSurfaces(db, [
			{
				chainId: 1n,
				address: '0x1111111111111111111111111111111111111111',
				adapterId: 'erc20',
				surfaceId: 'transfer_velocity_32',
				surfaceKind: 'gauge',
				valueJson: 3,
				unit: null,
				visualChannel: 'particleDensity',
				sourceMode: 'on_log',
				updatedAtBlock: 100n,
			},
		], {
			chainId: 1n,
			adapterId: 'erc20',
			sourceMode: 'on_log',
			replaceExisting: true,
		})

		await persistAdapterSurfaces(db, [
			{
				chainId: 1n,
				address: '0x1111111111111111111111111111111111111111',
				adapterId: 'erc20',
				surfaceId: 'total_supply',
				surfaceKind: 'gauge',
				valueJson: '1000',
				unit: 'token',
				visualChannel: 'height',
				sourceMode: 'scheduled_read',
				updatedAtBlock: 100n,
			},
		], {
			chainId: 1n,
			adapterId: 'erc20',
			sourceMode: 'scheduled_read',
			replaceExisting: false,
		})

		expect(queries[0]).toMatchObject({
			sql: expect.stringContaining('delete from adapter_surfaces'),
			params: [
				'1',
				'erc20',
				'on_log',
				[
					'0x1111111111111111111111111111111111111111|transfer_velocity_32',
				],
			],
		})
		expect(queries.filter(({ sql }) => (
			sql.includes('delete from adapter_surfaces')
		))).toHaveLength(1)
	})
})
