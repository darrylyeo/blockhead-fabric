import { describe, expect, it } from 'vitest'

import { __private__, readErc20TotalSupplySurfaces } from './erc20Reads.js'

describe('readErc20TotalSupplySurfaces', () => {
	it('reads totalSupply via eth_call and materializes adapter surfaces', async () => {
		const calls: unknown[] = []
		const surfaces = await readErc20TotalSupplySurfaces({
			provider: {
				request(args) {
					calls.push(args)

					return Promise.resolve('0x0f')
				},
			},
			chainId: 1n,
			headBlockNumber: 100n,
			addresses: [
				'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
			],
		})

		expect(calls).toEqual([
			{
				method: 'eth_call',
				params: [
					{
						to: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
						data: __private__.totalSupplySelector,
					},
					'0x64',
				],
			},
		])
		expect(surfaces).toEqual([
			{
				chainId: 1n,
				address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
				adapterId: 'erc20',
				surfaceId: 'total_supply',
				surfaceKind: 'gauge',
				valueJson: '15',
				unit: 'token',
				visualChannel: 'height',
				sourceMode: 'every_n_blocks',
				updatedAtBlock: 100n,
			},
		])
	})
})
