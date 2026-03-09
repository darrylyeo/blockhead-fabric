import { describe, expect, it } from 'vitest'

import { materializeCorridors } from './corridors.js'

const config = {
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
} as const

describe('materializeCorridors', () => {
	it('aggregates corridor windows and publishes threshold-crossing objects under source districts', () => {
		const result = materializeCorridors({
			config,
			headBlockNumber: 100n,
			entities: [
				{
					address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
					isContract: false,
					lastSeenBlock: 100n,
					familyLabel: null,
				},
				{
					address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
					isContract: false,
					lastSeenBlock: 100n,
					familyLabel: null,
				},
				{
					address: '0xcccccccccccccccccccccccccccccccccccccccc',
					isContract: true,
					lastSeenBlock: 100n,
					familyLabel: 'erc20',
				},
			],
			memberships: [
				{
					chainId: 1n,
					entityId: 'account:1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
					entityKind: 'account',
					districtId: 'd_aa',
					districtAlgorithmVersion: 1n,
					updatedAtBlock: 100n,
				},
				{
					chainId: 1n,
					entityId: 'account:1:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
					entityKind: 'account',
					districtId: 'd_bb',
					districtAlgorithmVersion: 1n,
					updatedAtBlock: 100n,
				},
				{
					chainId: 1n,
					entityId: 'contract:1:0xcccccccccccccccccccccccccccccccccccccccc',
					entityKind: 'contract',
					districtId: 'd_cc',
					districtAlgorithmVersion: 1n,
					updatedAtBlock: 100n,
				},
			],
			districts: [
				{
					chainId: 1n,
					districtId: 'd_aa',
					districtKey: 'aa',
					originX: 0,
					originY: 0,
					originZ: 0,
					entityCount: 1,
					contractCount: 0,
					accountCount: 1,
					activityWindow32: 1,
					projectionVersion: 1n,
					updatedAtBlock: 100n,
				},
				{
					chainId: 1n,
					districtId: 'd_bb',
					districtKey: 'bb',
					originX: 64,
					originY: 0,
					originZ: 0,
					entityCount: 1,
					contractCount: 0,
					accountCount: 1,
					activityWindow32: 1,
					projectionVersion: 1n,
					updatedAtBlock: 100n,
				},
				{
					chainId: 1n,
					districtId: 'd_cc',
					districtKey: 'cc',
					originX: 64,
					originY: 0,
					originZ: 64,
					entityCount: 1,
					contractCount: 1,
					accountCount: 0,
					activityWindow32: 1,
					projectionVersion: 1n,
					updatedAtBlock: 100n,
				},
			],
			nativeTransfers: Array.from({
				length: 8,
			}, (_, index) => ({
				txHash: `0xtx${index}`,
				blockNumber: 100n - BigInt(index),
				fromAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
				toAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
				valueWei: '10',
			})),
			contractCalls: [
				{
					txHash: '0xcall1',
					blockNumber: 100n,
					fromAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
					toAddress: '0xcccccccccccccccccccccccccccccccccccccccc',
				},
			],
			erc20Transfers: [
				{
					txHash: '0xerc20',
					blockNumber: 100n,
					fromAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
					toAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
					tokenClass: 'usdc',
				},
			],
		})

		expect(result.rows.find(({ corridorKey }) => (
			corridorKey === 'd_aa|d_bb|native_transfer|eth|32'
		))).toMatchObject({
			eventCount: 8,
			distinctTxCount: 8,
			totalValueWei: '80',
			published: true,
		})
		expect(result.rows.find(({ corridorKey }) => (
			corridorKey === 'd_aa|d_bb|native_transfer|eth|8'
		))?.published).toBe(true)
		expect(result.rows.find(({ corridorKey }) => (
			corridorKey === 'd_bb|d_aa|erc20_transfer|usdc|32'
		))?.published).toBe(true)
		expect(result.rows.find(({ corridorKey }) => (
			corridorKey === 'd_aa|d_cc|contract_call|none|32'
		))?.published).toBe(true)
		expect(result.objects.map(({ parentObjectId }) => (
			parentObjectId
		))).toContain('district:1:d_aa')
		expect(result.objects.map(({ parentObjectId }) => (
			parentObjectId
		))).toContain('district:1:d_bb')
		expect(result.objects.find(({ objectId }) => (
			objectId === 'corridor:1:d_aa:d_bb:native_transfer:eth:32'
		))).toMatchObject({
			resourceReference: 'action://objects/blockhead-beam-native.gltf',
			resourceName: 'objects/blockhead-beam-native.gltf',
			metadataJson: expect.objectContaining({
			entityKind: 'corridor',
			sourceDistrictId: 'd_aa',
			targetDistrictId: 'd_bb',
			flowClass: 'native_transfer',
			tokenClass: 'eth',
			window: 32,
			}),
		})
	})

	it('is deterministic: same inputs produce identical outputs (full rebuild parity)', () => {
		const args = {
			config,
			headBlockNumber: 100n,
			entities: [
				{
					address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
					isContract: false,
					lastSeenBlock: 100n,
					familyLabel: null,
				},
				{
					address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
					isContract: false,
					lastSeenBlock: 100n,
					familyLabel: null,
				},
			],
			memberships: [
				{
					chainId: 1n,
					entityId: 'account:1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
					entityKind: 'account',
					districtId: 'd_aa',
					districtAlgorithmVersion: 1n,
					updatedAtBlock: 100n,
				},
				{
					chainId: 1n,
					entityId: 'account:1:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
					entityKind: 'account',
					districtId: 'd_bb',
					districtAlgorithmVersion: 1n,
					updatedAtBlock: 100n,
				},
			],
			districts: [
				{
					chainId: 1n,
					districtId: 'd_aa',
					districtKey: 'aa',
					originX: 0,
					originY: 0,
					originZ: 0,
					entityCount: 1,
					contractCount: 0,
					accountCount: 1,
					activityWindow32: 1,
					projectionVersion: 1n,
					updatedAtBlock: 100n,
				},
				{
					chainId: 1n,
					districtId: 'd_bb',
					districtKey: 'bb',
					originX: 64,
					originY: 0,
					originZ: 0,
					entityCount: 1,
					contractCount: 0,
					accountCount: 1,
					activityWindow32: 1,
					projectionVersion: 1n,
					updatedAtBlock: 100n,
				},
			],
			nativeTransfers: Array.from({
				length: 8,
			}, (_, index) => ({
				txHash: `0xtx${index}`,
				blockNumber: 100n - BigInt(index),
				fromAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
				toAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
				valueWei: '10',
			})),
			contractCalls: [],
			erc20Transfers: [],
		} as const

		const result1 = materializeCorridors(args)
		const result2 = materializeCorridors(args)

		expect(result1.rows).toEqual(result2.rows)
		expect(result1.objects).toEqual(result2.objects)
	})
})
