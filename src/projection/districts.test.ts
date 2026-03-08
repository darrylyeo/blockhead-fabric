import { describe, expect, it } from 'vitest'

import { materializeDistrictAtlas } from './districts.js'

describe('materializeDistrictAtlas', () => {
	it('materializes deterministic districts, anchors, and district-atlas objects', () => {
		const projection = materializeDistrictAtlas({
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
			entities: [
				{
					address: '0x1111111111111111111111111111111111111111',
					isContract: false,
					lastSeenBlock: 95n,
					familyLabel: null,
				},
				{
					address: '0x2222222222222222222222222222222222222222',
					isContract: true,
					lastSeenBlock: 100n,
					familyLabel: 'erc20',
				},
			],
			headBlockNumber: 100n,
		})

		expect(projection.state.entrypoints).toEqual([
			{
				scopeId: 'scope_eth_mainnet',
				entrypointId: 'entry_district_atlas',
				name: 'District Atlas',
				rootObjectId: 'entry_district_atlas',
				desiredRevision: 100n,
			},
		])
		expect(projection.districts).toHaveLength(2)
		expect(projection.memberships.map(({ entityKind }) => (
			entityKind
		)).sort()).toEqual([
			'account',
			'contract',
		])
		expect(projection.anchors).toHaveLength(2)
		expect(projection.state.objects.some(({ objectId }) => (
			objectId === 'entry_district_atlas'
		))).toBe(true)
		expect(projection.state.objects.some(({ objectId }) => (
			objectId.startsWith('district:1:d_')
		))).toBe(true)
		expect(projection.state.objects.some(({ objectId }) => (
			objectId === 'account:1:0x1111111111111111111111111111111111111111'
		))).toBe(true)
		expect(projection.state.objects.some(({ objectId }) => (
			objectId === 'contract:1:0x2222222222222222222222222222222222222222'
		))).toBe(true)
		expect(projection.state.objects.find(({ objectId }) => (
			objectId === 'contract:1:0x2222222222222222222222222222222222222222'
		))?.metadataJson).toMatchObject({
			entityKind: 'contract',
			familyLabel: 'erc20',
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
			entities: [
				{
					address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
					isContract: false,
					lastSeenBlock: 99n,
					familyLabel: null,
				},
				{
					address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
					isContract: true,
					lastSeenBlock: 100n,
					familyLabel: 'erc20',
				},
			],
			headBlockNumber: 100n,
		} as const

		const result1 = materializeDistrictAtlas(args)
		const result2 = materializeDistrictAtlas(args)

		expect(result1.districts).toEqual(result2.districts)
		expect(result1.memberships).toEqual(result2.memberships)
		expect(result1.anchors).toEqual(result2.anchors)
		expect(result1.state).toEqual(result2.state)
	})
})
