import { describe, expect, it } from 'vitest'

import { materializeTxPulses } from './txPulses.js'

const config = {
	databaseUrl: 'postgres://blockhead:blockhead@localhost:5432/blockhead',
	chainId: 1n,
	projectionPollIntervalMs: 1000,
	spineRecentBlockCount: 256,
	maxTxPulsesPerBlock: 2,
	spineBlockSpacing: 24,
	districtSpacing: 256,
	districtAtlasOffsetX: 512,
	districtAtlasOffsetZ: 0,
	slotSpacing: 12,
	topContractLandmarksPerDistrict: 8,
	projectionVersion: 1n,
	districtAlgorithmVersion: 1n,
	anchorAlgorithmVersion: 1n,
	corridorAlgorithmVersion: 1n,
	surfaceAlgorithmVersion: 1n,
} as const

describe('materializeTxPulses', () => {
	it('selects top transactions per recent block by value, gas, then tx index', () => {
		const objects = materializeTxPulses({
			config,
			headBlockNumber: 100n,
			blocks: [
				{
					blockNumber: 68n,
					blockHash: '0x68',
					timestamp: new Date('2026-03-07T00:00:00.000Z'),
					gasUsed: '1',
					txCount: 1,
					logCount: 1,
					finalityState: 'latest',
				},
				{
					blockNumber: 100n,
					blockHash: '0x100',
					timestamp: new Date('2026-03-07T00:00:12.000Z'),
					gasUsed: '1',
					txCount: 3,
					logCount: 1,
					finalityState: 'latest',
				},
			],
			transactions: [
				{
					txHash: '0xold',
					blockNumber: 68n,
					txIndex: 0,
					fromAddress: '0x1111111111111111111111111111111111111111',
					toAddress: '0x2222222222222222222222222222222222222222',
					valueWei: '999',
					gasUsed: '999',
				},
				{
					txHash: '0x2',
					blockNumber: 100n,
					txIndex: 2,
					fromAddress: '0x1111111111111111111111111111111111111111',
					toAddress: '0x2222222222222222222222222222222222222222',
					valueWei: '10',
					gasUsed: '20',
				},
				{
					txHash: '0x1',
					blockNumber: 100n,
					txIndex: 1,
					fromAddress: '0x1111111111111111111111111111111111111111',
					toAddress: '0x3333333333333333333333333333333333333333',
					valueWei: '10',
					gasUsed: '30',
				},
				{
					txHash: '0x0',
					blockNumber: 100n,
					txIndex: 0,
					fromAddress: '0x1111111111111111111111111111111111111111',
					toAddress: '0x4444444444444444444444444444444444444444',
					valueWei: '100',
					gasUsed: '10',
				},
			],
		})

		expect(objects.map(({ objectId }) => (
			objectId
		))).toEqual([
			'tx:1:0x0',
			'tx:1:0x1',
		])
		expect(objects[0]).toMatchObject({
			parentObjectId: 'block:1:100',
			name: 'Tx 0x444444...4444',
		})
		expect(objects[0]?.metadataJson).toMatchObject({
			entityKind: 'transaction',
			txHash: '0x0',
			blockNumber: '100',
			txIndex: 0,
			valueWei: '100',
			gasUsed: '10',
		})
	})
})
