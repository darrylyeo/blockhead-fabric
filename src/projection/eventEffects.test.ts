import { describe, expect, it } from 'vitest'

import {
	__private__,
	materializeEventEffects,
} from './eventEffects.js'

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

describe('materializeEventEffects', () => {
	it('materializes supported transfer logs as block-local event objects', () => {
		const objects = materializeEventEffects({
			config,
			blocks: [
				{
					blockNumber: 100n,
					blockHash: '0x100',
					timestamp: new Date('2026-03-07T00:00:00.000Z'),
					gasUsed: '1',
					txCount: 1,
					logCount: 1,
					finalityState: 'latest',
				},
			],
			logs: [
				{
					blockNumber: 100n,
					txHash: '0xerc20',
					logIndex: 0,
					address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
					topic0: __private__.ercTransferTopic0,
					topic1: '0x0000000000000000000000001111111111111111111111111111111111111111',
					topic2: '0x0000000000000000000000002222222222222222222222222222222222222222',
					topic3: null,
					data: '0x01',
				},
				{
					blockNumber: 100n,
					txHash: '0xerc721',
					logIndex: 1,
					address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
					topic0: __private__.ercTransferTopic0,
					topic1: '0x0000000000000000000000003333333333333333333333333333333333333333',
					topic2: '0x0000000000000000000000004444444444444444444444444444444444444444',
					topic3: '0x0000000000000000000000000000000000000000000000000000000000000005',
					data: '0x',
				},
				{
					blockNumber: 100n,
					txHash: '0x1155',
					logIndex: 2,
					address: '0xcccccccccccccccccccccccccccccccccccccccc',
					topic0: __private__.erc1155TransferSingleTopic0,
					topic1: null,
					topic2: null,
					topic3: null,
					data: '0x',
				},
				{
					blockNumber: 100n,
					txHash: '0xignored',
					logIndex: 3,
					address: '0xdddddddddddddddddddddddddddddddddddddddd',
					topic0: '0xdeadbeef',
					topic1: null,
					topic2: null,
					topic3: null,
					data: '0x',
				},
			],
		})

		expect(objects.map(({ objectId }) => (
			objectId
		))).toEqual([
			'event:1:0xerc20:0',
			'event:1:0xerc721:1',
			'event:1:0x1155:2',
		])
		expect(objects[0]).toMatchObject({
			parentObjectId: 'block:1:100',
			name: 'ERC-20 Transfer',
		})
		expect(objects[0]?.metadataJson).toMatchObject({
			entityKind: 'event',
			emitterAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
			eventFamily: 'erc20_transfer',
			txHash: '0xerc20',
			logIndex: 0,
			fromAddress: '0x1111111111111111111111111111111111111111',
			toAddress: '0x2222222222222222222222222222222222222222',
		})
		expect(objects[1]?.metadataJson).toMatchObject({
			eventFamily: 'erc721_transfer',
		})
		expect(objects[2]?.metadataJson).toMatchObject({
			eventFamily: 'erc1155_transfer_single',
		})
	})
})
