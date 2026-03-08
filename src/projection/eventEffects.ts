import type {
	EventEffectLog,
	ProjectedFabricObject,
	ProjectionConfig,
	SpineBlock,
} from './types.js'

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

const transform = (logIndex: number) => ({
	position: {
		x: (logIndex % 8) * 2 - 7,
		y: 2 + Math.floor(logIndex / 8),
		z: 0,
	},
	rotation: {
		x: 0,
		y: 0,
		z: 0,
		w: 1,
	},
	scale: {
		x: 1,
		y: 1,
		z: 1,
	},
})

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

	return args.logs
		.filter(({ blockNumber }) => (
			blockIds.has(blockNumber.toString())
		))
		.flatMap((log) => {
			const eventFamily = classifyEventFamily(log)

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
						transformJson: transform(log.logIndex),
						boundJson: {
							x: 2,
							y: 2,
							z: 2,
						},
						resourceReference: null,
						resourceName: null,
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
