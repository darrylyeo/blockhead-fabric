import { blockScaleByNumber, eventOffset, selectTxPulseGroups, txPulseVisuals } from './blockActivityLayout.js'
import { eventResource } from './resources.js'

import type {
	EventEffectLog,
	ProjectedFabricObject,
	ProjectionConfig,
	SpineBlock,
} from './types.js'
import type { TxPulseInput } from './blockActivityLayout.js'

const ercTransferTopic0 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const erc1155TransferSingleTopic0 = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62'
const erc1155TransferBatchTopic0 = '0x4a39dc06d4c0dbc64b70e4cce6d6a4c41fbd64fd4281c3f1f9a6b20f7c2a2b9b'

const classifyEventFamily = (log: EventEffectLog) => (
	log.topic0 === erc1155TransferSingleTopic0 ?
		'erc1155_transfer_single'
	: log.topic0 === erc1155TransferBatchTopic0 ?
		'erc1155_transfer_batch'
	: log.topic0 === ercTransferTopic0 && log.topic3 ?
		'erc721_transfer'
	: log.topic0 === ercTransferTopic0 ?
		'erc20_transfer'
	:
		null
)

const familyName = (eventFamily: string) => (
	eventFamily === 'erc20_transfer' ?
		'ERC-20 Transfer'
	: eventFamily === 'erc721_transfer' ?
		'ERC-721 Transfer'
	: eventFamily === 'erc1155_transfer_single' ?
		'ERC-1155 TransferSingle'
	:
		'ERC-1155 TransferBatch'
)

const topicAddress = (topic: string | null) => (
	!topic || topic.length < 42 ?
		null
	:
		`0x${topic.slice(-40).toLowerCase()}`
)

const metadata = (args: {
	chainId: bigint
	log: EventEffectLog
	eventFamily: string
}) => ({
	schemaVersion: 1,
	entityId: `event:${args.chainId.toString()}:${args.log.txHash}:${args.log.logIndex}`,
	entityKind: 'event',
	chainId: Number(args.chainId),
	canonical: true,
	updatedAtBlock: args.log.blockNumber.toString(),
	emitterAddress: args.log.address,
	topic0: args.log.topic0,
	eventFamily: args.eventFamily,
	txHash: args.log.txHash,
	logIndex: args.log.logIndex,
	fromAddress: topicAddress(args.log.topic1),
	toAddress: topicAddress(args.log.topic2),
})

export const materializeEventEffects = (args: {
	config: ProjectionConfig
	blocks: SpineBlock[]
	logs: EventEffectLog[]
	transactions: TxPulseInput[]
}) => {
	const scopeId = args.config.chainId === 1n ?
		'scope_eth_mainnet'
	:
		`scope_chain_${args.config.chainId.toString()}`
	const blockIds = new Set(
		args.blocks.map(({ blockNumber }) => (
			blockNumber.toString()
		)),
	)
	const blockScales = blockScaleByNumber(args.blocks)
	const txPulsePositions = new Map(
		selectTxPulseGroups({
			config: args.config,
			headBlockNumber: args.blocks.at(-1)?.blockNumber ?? 0n,
			blocks: args.blocks,
			transactions: args.transactions,
			recentWindowSize: 32n,
		}).flatMap(({ blockNumber, transactions }) => (
			transactions.map((transaction, index) => {
				const visuals = txPulseVisuals({
					blockScale: blockScales.get(blockNumber) ?? {
						x: 10,
						y: 6,
						z: 10,
					},
					index,
					count: transactions.length,
					transaction,
				})

				return [
					`${blockNumber}:${transaction.txHash}`,
					visuals.position,
				] as const
			})
		)),
	)
	const eventIndexes = new Map<string, number>()

	return args.logs
		.filter(({ blockNumber }) => (
			blockIds.has(blockNumber.toString())
		))
		.flatMap((log) => {
			const eventFamily = classifyEventFamily(log)
			const txKey = `${log.blockNumber.toString()}:${log.txHash}`
			const eventIndex = eventIndexes.get(txKey) ?? 0
			const pulsePosition = txPulsePositions.get(txKey)
			const offset = eventOffset(eventIndex)
			const scale = {
				x: eventFamily === 'erc721_transfer' ? 1.2 : 0.9,
				y: eventFamily === 'erc20_transfer' ? 0.9 : 1.1,
				z: eventFamily === 'erc1155_transfer_batch' ? 1.4 : 0.9,
			}

			eventIndexes.set(txKey, eventIndex + 1)

			return eventFamily ?
				[
					{
						scopeId,
						objectId: `event:${args.config.chainId.toString()}:${log.txHash}:${log.logIndex}`,
						entrypointId: 'entry_latest_spine',
						parentObjectId: `block:${args.config.chainId.toString()}:${log.blockNumber.toString()}`,
						entityId: `event:${args.config.chainId.toString()}:${log.txHash}:${log.logIndex}`,
						classId: 73,
						type: 0,
						subtype: 0,
						name: familyName(eventFamily),
						transformJson: {
							position: pulsePosition ?
								{
									x: pulsePosition.x + offset.x,
									y: pulsePosition.y + offset.y,
									z: pulsePosition.z + offset.z,
								}
							:
								{
									x: offset.x + (((log.logIndex % 5) - 2) * 2.5),
									y: (blockScales.get(log.blockNumber.toString())?.y ?? 6) + offset.y,
									z: offset.z + ((Math.floor(log.logIndex / 5) - 1) * 2.5),
								},
							rotation: {
								x: 0,
								y: 0,
								z: 0,
								w: 1,
							},
							scale,
						},
						boundJson: scale,
						...eventResource(eventFamily),
						metadataJson: metadata({
							chainId: args.config.chainId,
							log,
							eventFamily,
						}),
						deleted: false,
						desiredRevision: args.blocks.at(-1)?.blockNumber ?? 0n,
						updatedAtBlock: log.blockNumber,
					} satisfies ProjectedFabricObject,
				]
			:
				[]
		})
}

export const __private__ = {
	ercTransferTopic0,
	erc1155TransferSingleTopic0,
	erc1155TransferBatchTopic0,
	classifyEventFamily,
}
