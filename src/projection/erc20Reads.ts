import type { AdapterSurfaceRow } from './types.js'
import type { Eip1193Provider } from '../shared/types.js'

const totalSupplySelector = '0x18160ddd'
const minBlocksBetweenReads = 4n
const maxTargetsPerBlock = 32

const toBlockTag = (blockNumber: bigint) => (
	`0x${blockNumber.toString(16)}`
)

const parseQuantity = (value: unknown) => (
	typeof value === 'string' && value.startsWith('0x') ?
		BigInt(value).toString()
	:
		'0'
)

export const readErc20TotalSupplySurfaces = async (args: {
	provider: Eip1193Provider
	chainId: bigint
	headBlockNumber: bigint
	addresses: string[]
}) => (
	Promise.all(
		args.addresses.slice(0, maxTargetsPerBlock).map(async (address): Promise<AdapterSurfaceRow> => ({
			chainId: args.chainId,
			address,
			adapterId: 'erc20',
			surfaceId: 'total_supply',
			surfaceKind: 'gauge',
			valueJson: parseQuantity(await args.provider.request({
				method: 'eth_call',
				params: [
					{
						to: address,
						data: totalSupplySelector,
					},
					toBlockTag(args.headBlockNumber),
				],
			})),
			unit: 'token',
			visualChannel: 'height',
			sourceMode: 'every_n_blocks',
			updatedAtBlock: args.headBlockNumber,
		})),
	)
)

export const __private__ = {
	totalSupplySelector,
	minBlocksBetweenReads,
	maxTargetsPerBlock,
}
