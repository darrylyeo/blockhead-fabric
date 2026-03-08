import { Hex } from '@tevm/voltaire/Hex'
import { Keccak256 } from '@tevm/voltaire/Keccak256'

import type {
	AdapterEntityRow,
	AdapterEventRow,
	AdapterHintRow,
	AdapterSurfaceRow,
	KnownAmmPoolContract,
	ProjectedFabricObject,
	ProjectedFabricState,
	ProjectionConfig,
} from './types.js'

type AmmLog = {
	blockNumber: bigint
	blockHash: string
	txHash: string
	logIndex: number
	address: string
	topic0: string
	data: string
}

const hexString = (value: Uint8Array) => (
	Hex.fromBytes(value).toLowerCase()
)

const topic0 = (signature: string) => (
	hexString(Keccak256.from(new TextEncoder().encode(signature)))
)

const swapTopic0 = topic0('Swap(address,uint256,uint256,uint256,uint256,address)')
const mintTopic0 = topic0('Mint(address,uint256,uint256)')
const burnTopic0 = topic0('Burn(address,uint256,uint256,address)')
const syncTopic0 = topic0('Sync(uint112,uint112)')

const shortLabel = (address: string) => (
	`${address.slice(0, 8)}...${address.slice(-4)}`
)

const formatAddress = (address: string) => (
	address.toLowerCase()
)

const parseWord = (data: string, index: number) => {
	const start = 2 + index * 64
	const end = start + 64

	return BigInt(`0x${data.slice(start, end)}`)
}

const parseSyncReserves = (data: string) => ({
	reserve0: parseWord(data, 0).toString(),
	reserve1: parseWord(data, 1).toString(),
})

export const materializeAmmPoolAdapter = (args: {
	config: ProjectionConfig
	headBlockNumber: bigint
	logs: AmmLog[]
}) => {
	const recentFloor = args.headBlockNumber > 31n ?
		args.headBlockNumber - 31n
	:
		0n
	const byAddress = new Map<string, AmmLog[]>()

	for (const log of args.logs) {
		const address = formatAddress(log.address)
		const current = byAddress.get(address) ?? []

		current.push({
			...log,
			address,
		})
		byAddress.set(address, current)
	}

	const adapterEntities: AdapterEntityRow[] = []
	const adapterEvents: AdapterEventRow[] = []
	const adapterHints: AdapterHintRow[] = []
	const adapterSurfaces: AdapterSurfaceRow[] = []

	for (const [address, logs] of [
		...byAddress.entries(),
	].sort(([left], [right]) => (
		left.localeCompare(right)
	))) {
		const topicSet = new Set(
			logs.map(({ topic0 }) => (
				topic0
			)),
		)

		if (
			!topicSet.has(swapTopic0)
			|| !topicSet.has(mintTopic0)
			|| !topicSet.has(burnTopic0)
			|| !topicSet.has(syncTopic0)
		) {
			continue
		}

		const recentLogs = logs.filter(({ blockNumber }) => (
			blockNumber >= recentFloor
		))
		const swapIntensity32 = recentLogs.filter(({ topic0 }) => (
			topic0 === swapTopic0
		)).length
		const latestSyncLog = [
			...logs.filter(({ topic0 }) => (
				topic0 === syncTopic0
			)),
		].sort((left, right) => (
			left.blockNumber > right.blockNumber ?
				-1
			: left.blockNumber < right.blockNumber ?
				1
			:
				right.logIndex - left.logIndex
		))[0]
		const reserves = latestSyncLog ?
			parseSyncReserves(latestSyncLog.data)
		:
			{
				reserve0: '0',
				reserve1: '0',
			}

		adapterEntities.push({
			chainId: args.config.chainId,
			address,
			adapterId: 'amm_pool',
			adapterVersion: 1,
			protocolId: `amm_pool:${address}`,
			family: 'amm_pool',
			confidence: 'high',
			styleFamily: 'pool',
			metadataJson: {
				familyLabel: 'amm_pool',
			},
			detectedAtBlock: args.headBlockNumber,
			updatedAtBlock: args.headBlockNumber,
		})
		adapterHints.push({
			chainId: args.config.chainId,
			address,
			adapterId: 'amm_pool',
			hintType: 'object_style',
			payloadJson: {
				preferredEntrypoint: 'protocol-landmarks',
				preferredResourceName: 'amm-pool',
				preferredLabel: shortLabel(address),
			},
			updatedAtBlock: args.headBlockNumber,
		})

		if (swapIntensity32 >= 8) {
			adapterHints.push({
				chainId: args.config.chainId,
				address,
				adapterId: 'amm_pool',
				hintType: 'attachment_candidate',
				payloadJson: {
					kind: 'amm-pool-inspect',
					title: 'Inspect Pool',
					priority: Math.min(1, swapIntensity32 / 32),
				},
				updatedAtBlock: args.headBlockNumber,
			})
		}

		adapterSurfaces.push({
			chainId: args.config.chainId,
			address,
			adapterId: 'amm_pool',
			surfaceId: 'reserve0',
			surfaceKind: 'gauge',
			valueJson: reserves.reserve0,
			unit: 'token',
			visualChannel: 'height',
			sourceMode: 'on_log',
			updatedAtBlock: args.headBlockNumber,
		})
		adapterSurfaces.push({
			chainId: args.config.chainId,
			address,
			adapterId: 'amm_pool',
			surfaceId: 'reserve1',
			surfaceKind: 'gauge',
			valueJson: reserves.reserve1,
			unit: 'token',
			visualChannel: 'width',
			sourceMode: 'on_log',
			updatedAtBlock: args.headBlockNumber,
		})
		adapterSurfaces.push({
			chainId: args.config.chainId,
			address,
			adapterId: 'amm_pool',
			surfaceId: 'swap_intensity_32',
			surfaceKind: 'gauge',
			valueJson: swapIntensity32,
			unit: null,
			visualChannel: 'particleDensity',
			sourceMode: 'on_log',
			updatedAtBlock: args.headBlockNumber,
		})

		for (const log of logs) {
			adapterEvents.push({
				chainId: args.config.chainId,
				adapterId: 'amm_pool',
				txHash: log.txHash,
				blockHash: log.blockHash,
				logIndex: log.logIndex,
				targetAddress: address,
				eventFamily: (
					log.topic0 === swapTopic0 ?
						'swap'
					: log.topic0 === mintTopic0 ?
						'mint'
					: log.topic0 === burnTopic0 ?
						'burn'
					:
						'sync'
				),
				payloadJson: {
					blockNumber: log.blockNumber.toString(),
					topic0: log.topic0,
					...(
						log.topic0 === syncTopic0 ?
							parseSyncReserves(log.data)
						:
							{}
					),
				},
				canonical: true,
			})
		}
	}

	return {
		adapterEntities,
		adapterEvents,
		adapterHints,
		adapterSurfaces,
	}
}

export const materializeAmmPoolLandmarks = (args: {
	config: ProjectionConfig
	headBlockNumber: bigint
	contracts: KnownAmmPoolContract[]
}) => {
	const desiredRevision = args.headBlockNumber

	return {
		containerId: 'container:protocol:amm_pool',
		containerName: 'AMM Pools',
		containerX: 288,
		familyLabel: 'amm_pool',
		resourceName: 'amm-pool',
		contracts: [
			...args.contracts,
		]
			.sort((left, right) => (
				right.swapIntensity32 - left.swapIntensity32
				|| left.protocolLabel.localeCompare(right.protocolLabel)
			))
			.map((contract) => ({
				...contract,
				extraMetadata: {
					adapterSurfaces: [
						'reserve0',
						'reserve1',
						'swap_intensity_32',
					],
					adapterSurfaceValues: {
						reserve0: contract.reserve0,
						reserve1: contract.reserve1,
						swap_intensity_32: contract.swapIntensity32,
					},
					activity32: contract.activity32,
					eventCount32: contract.eventCount32,
					swapIntensity32: contract.swapIntensity32,
					reserve0: contract.reserve0,
					reserve1: contract.reserve1,
					updatedAtBlock: desiredRevision.toString(),
				},
			})),
	}
}

export const __private__ = {
	swapTopic0,
	mintTopic0,
	burnTopic0,
	syncTopic0,
}
