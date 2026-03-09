import { describe, expect, it } from 'vitest'

import { materializeLatestSpine } from './spine.js'

describe('materializeLatestSpine', () => {
	it('materializes latest-spine desired state from canonical blocks', () => {
		const projection = materializeLatestSpine({
			config: {
				databaseUrl: 'postgres://blockhead:blockhead@localhost:5432/blockhead',
				chainId: 1n,
				projectionPollIntervalMs: 1000,
				spineRecentBlockCount: 256,
				maxTxPulsesPerBlock: 24,
				spineBlockSpacing: 24,
				districtSpacing: 256,
				slotSpacing: 12,
				topContractLandmarksPerDistrict: 8,
				projectionVersion: 1n,
				districtAlgorithmVersion: 1n,
				anchorAlgorithmVersion: 1n,
				corridorAlgorithmVersion: 1n,
				surfaceAlgorithmVersion: 1n,
			},
			blocks: [
				{
					blockNumber: 100n,
					blockHash: '0x100',
					timestamp: new Date('2026-03-07T00:00:00.000Z'),
					gasUsed: '8000000',
					txCount: 20,
					logCount: 100,
					finalityState: 'latest',
				},
				{
					blockNumber: 101n,
					blockHash: '0x101',
					timestamp: new Date('2026-03-07T00:00:12.000Z'),
					gasUsed: '20000000',
					txCount: 300,
					logCount: 1200,
					finalityState: 'finalized',
				},
			],
		})

		expect(projection.scope).toEqual({
			scopeId: 'scope_eth_mainnet',
			chainId: 1n,
			name: 'Ethereum Mainnet',
			entryMsfPath: '/fabric/',
			desiredRevision: 101n,
			status: 'active',
		})
		expect(projection.entrypoints).toEqual([
			{
				scopeId: 'scope_eth_mainnet',
				entrypointId: 'entry_latest_spine',
				name: 'Latest Spine',
				rootObjectId: 'entry_latest_spine',
				desiredRevision: 101n,
			},
		])
		expect(projection.objects.map(({ objectId }) => (
			objectId
		))).toEqual([
			'entry_latest_spine',
			'container:spine',
			'block:1:100',
			'block:1:101',
		])
		expect(projection.objects[0]?.parentObjectId).toBe('root')
		expect(projection.objects[2]?.transformJson).toMatchObject({
			position: {
				x: 0,
				z: 0,
			},
			rotation: {
				x: 0,
				y: 0,
				z: 0,
				w: 1,
			},
		})
		expect(projection.objects[3]?.transformJson).toMatchObject({
			position: {
				x: 0,
				z: 24,
			},
			rotation: {
				x: 0,
				y: 0,
				z: 0,
				w: 1,
			},
		})
		expect((projection.objects[3]?.transformJson as { scale: { x: number, y: number, z: number } }).scale.x).toBeGreaterThan(10)
		expect((projection.objects[3]?.transformJson as { scale: { x: number, y: number, z: number } }).scale.y).toBeGreaterThan(8)
		expect(projection.objects[3]?.boundJson).toEqual({
			x: 16,
			y: 4,
			z: 30,
		})
		expect(projection.objects[3]?.resourceReference).toBe('action://objects/blockhead-finalized.gltf')
		expect(projection.objects[3]?.resourceName).toBe('objects/blockhead-finalized.gltf')
		expect(projection.objects[3]?.metadataJson).toMatchObject({
			entityId: 'block:1:101',
			entityKind: 'block',
			finalityState: 'finalized',
			blockHash: '0x101',
			blockNumber: '101',
			txCount: 300,
			logCount: 1200,
			gasUsed: '20000000',
		})
	})

	it('is deterministic: same inputs produce identical outputs (full rebuild parity)', () => {
		const args = {
			config: {
				databaseUrl: 'postgres://blockhead:blockhead@localhost:5432/blockhead',
				chainId: 1n,
				projectionPollIntervalMs: 1000,
				spineRecentBlockCount: 256,
				maxTxPulsesPerBlock: 24,
				spineBlockSpacing: 24,
				districtSpacing: 256,
				slotSpacing: 12,
				topContractLandmarksPerDistrict: 8,
				projectionVersion: 1n,
				districtAlgorithmVersion: 1n,
				anchorAlgorithmVersion: 1n,
				corridorAlgorithmVersion: 1n,
				surfaceAlgorithmVersion: 1n,
			},
			blocks: [
				{
					blockNumber: 50n,
					blockHash: '0x50',
					timestamp: new Date('2026-03-07T00:00:00.000Z'),
					gasUsed: '5000000',
					txCount: 10,
					logCount: 50,
					finalityState: 'finalized',
				},
				{
					blockNumber: 51n,
					blockHash: '0x51',
					timestamp: new Date('2026-03-07T00:00:12.000Z'),
					gasUsed: '15000000',
					txCount: 200,
					logCount: 800,
					finalityState: 'latest',
				},
			],
		} as const

		const result1 = materializeLatestSpine(args)
		const result2 = materializeLatestSpine(args)

		expect(result1.scope).toEqual(result2.scope)
		expect(result1.entrypoints).toEqual(result2.entrypoints)
		expect(result1.objects).toEqual(result2.objects)
	})
})
