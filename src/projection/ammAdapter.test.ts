import { describe, expect, it } from 'vitest'

import {
	__private__,
	materializeAmmPoolAdapter,
} from './ammAdapter.js'

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

describe('materializeAmmPoolAdapter', () => {
	it('materializes high-confidence AMM pools from the full Uniswap V2-style event set', () => {
		const address = '0x7777777777777777777777777777777777777777'
		const result = materializeAmmPoolAdapter({
			config,
			headBlockNumber: 100n,
			logs: [
				{
					blockNumber: 97n,
					blockHash: '0x1',
					txHash: '0xtx1',
					logIndex: 0,
					address,
					topic0: __private__.mintTopic0,
					data: '0x',
				},
				{
					blockNumber: 98n,
					blockHash: '0x2',
					txHash: '0xtx2',
					logIndex: 1,
					address,
					topic0: __private__.burnTopic0,
					data: '0x',
				},
				{
					blockNumber: 99n,
					blockHash: '0x3',
					txHash: '0xtx3',
					logIndex: 2,
					address,
					topic0: __private__.swapTopic0,
					data: '0x',
				},
				{
					blockNumber: 100n,
					blockHash: '0x4',
					txHash: '0xtx4',
					logIndex: 3,
					address,
					topic0: __private__.syncTopic0,
					data: '0x000000000000000000000000000000000000000000000000000000000000007b00000000000000000000000000000000000000000000000000000000000001c8',
				},
			],
		})

		expect(result.adapterEntities).toEqual([
			expect.objectContaining({
				address,
				adapterId: 'amm_pool',
				confidence: 'high',
				protocolId: `amm_pool:${address}`,
			}),
		])
		expect(result.adapterEvents.map(({ eventFamily }) => (
			eventFamily
		)).sort()).toEqual([
			'burn',
			'mint',
			'swap',
			'sync',
		])
		expect(result.adapterHints).toEqual([
			expect.objectContaining({
				address,
				hintType: 'object_style',
				payloadJson: expect.objectContaining({
					preferredEntrypoint: 'protocol-landmarks',
					preferredResourceName: 'amm-pool',
					preferredLabel: '0x777777...7777',
				}),
			}),
		])
		expect(result.adapterSurfaces).toEqual([
			expect.objectContaining({
				address,
				surfaceId: 'reserve0',
				valueJson: '123',
			}),
			expect.objectContaining({
				address,
				surfaceId: 'reserve1',
				valueJson: '456',
			}),
			expect.objectContaining({
				address,
				surfaceId: 'swap_intensity_32',
				valueJson: 1,
			}),
		])
	})
})
