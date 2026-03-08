import type { ProjectedFabricState, ProjectionConfig, SpineBlock } from './types.js'

const finalityBand = (finalityState: string) => (
	finalityState === 'finalized' ?
		4
	: finalityState === 'safe' ?
		2
	:
		0
)

const depthBucket = (txCount: number) => (
	txCount <= 24 ?
		12
	: txCount <= 99 ?
		18
	: txCount <= 249 ?
		24
	: txCount <= 499 ?
		30
	:
		36
)

const widthBucket = (logCount: number, gasUsed: string) => {
	const numericGasUsed = Number(gasUsed)

	return logCount >= 2000 || numericGasUsed >= 25000000 ?
		20
	: logCount >= 1000 || numericGasUsed >= 18000000 ?
		16
	: logCount >= 250 || numericGasUsed >= 9000000 ?
		12
	:
		8
}

const transform = (blockNumber: bigint, windowStart: bigint, blockSpacing: number, finalityState: string) => ({
	position: {
		x: 0,
		y: finalityBand(finalityState),
		z: Number(blockNumber - windowStart) * blockSpacing,
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

const blockMetadata = (chainId: bigint, block: SpineBlock) => ({
	schemaVersion: 1,
	entityId: `block:${chainId.toString()}:${block.blockNumber.toString()}`,
	entityKind: 'block',
	chainId: Number(chainId),
	canonical: true,
	finalityState: block.finalityState,
	updatedAtBlock: block.blockNumber.toString(),
	blockNumber: block.blockNumber.toString(),
	blockHash: block.blockHash,
	timestamp: block.timestamp.toISOString(),
	txCount: block.txCount,
	logCount: block.logCount,
	gasUsed: block.gasUsed,
})

const containerMetadata = (chainId: bigint, headBlockNumber: bigint) => ({
	schemaVersion: 1,
	entityId: `container:spine:${chainId.toString()}`,
	entityKind: 'container',
	chainId: Number(chainId),
	canonical: true,
	updatedAtBlock: headBlockNumber.toString(),
})

const entryMetadata = (chainId: bigint, headBlockNumber: bigint) => ({
	schemaVersion: 1,
	entityId: `entry:latest-spine:${chainId.toString()}`,
	entityKind: 'entrypoint',
	chainId: Number(chainId),
	canonical: true,
	updatedAtBlock: headBlockNumber.toString(),
})

export const materializeLatestSpine = (args: {
	config: ProjectionConfig
	blocks: SpineBlock[]
}): ProjectedFabricState => {
	const head = args.blocks.at(-1)

	if (!head) {
		return {
			scope: null,
			entrypoints: [],
			objects: [],
		}
	}

	const scopeId = args.config.chainId === 1n ?
		'scope_eth_mainnet'
	:
		`scope_chain_${args.config.chainId.toString()}`
	const desiredRevision = head.blockNumber
	const windowStart = args.blocks[0].blockNumber
	const entryObjectId = 'entry_latest_spine'
	const containerObjectId = 'container:spine'

	return {
		scope: {
			scopeId,
			chainId: args.config.chainId,
			name: args.config.chainId === 1n ? 'Ethereum Mainnet' : `Chain ${args.config.chainId.toString()}`,
			entryMsfPath: '/fabric/',
			desiredRevision,
			status: 'active',
		},
		entrypoints: [
			{
				scopeId,
				entrypointId: 'entry_latest_spine',
				name: 'Latest Spine',
				rootObjectId: entryObjectId,
				desiredRevision,
			},
		],
		objects: [
			{
				scopeId,
				objectId: entryObjectId,
				entrypointId: 'entry_latest_spine',
				parentObjectId: 'root',
				entityId: `entry:latest-spine:${args.config.chainId.toString()}`,
				classId: 73,
				type: 0,
				subtype: 0,
				name: 'Latest Spine',
				transformJson: {
					position: {
						x: 0,
						y: 0,
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
				},
				boundJson: null,
				resourceReference: null,
				resourceName: null,
				metadataJson: entryMetadata(args.config.chainId, head.blockNumber),
				deleted: false,
				desiredRevision,
				updatedAtBlock: head.blockNumber,
			},
			{
				scopeId,
				objectId: containerObjectId,
				entrypointId: 'entry_latest_spine',
				parentObjectId: entryObjectId,
				entityId: `container:spine:${args.config.chainId.toString()}`,
				classId: 73,
				type: 0,
				subtype: 0,
				name: 'Spine',
				transformJson: {
					position: {
						x: 0,
						y: 0,
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
				},
				boundJson: {
					x: 24,
					y: 8,
					z: Math.max(12, args.blocks.length * args.config.spineBlockSpacing),
				},
				resourceReference: null,
				resourceName: null,
				metadataJson: containerMetadata(args.config.chainId, head.blockNumber),
				deleted: false,
				desiredRevision,
				updatedAtBlock: head.blockNumber,
			},
			...args.blocks.map((block) => ({
				scopeId,
				objectId: `block:${args.config.chainId.toString()}:${block.blockNumber.toString()}`,
				entrypointId: 'entry_latest_spine',
				parentObjectId: containerObjectId,
				entityId: `block:${args.config.chainId.toString()}:${block.blockNumber.toString()}`,
				classId: 73,
				type: 0,
				subtype: 0,
				name: `Block ${block.blockNumber.toString()}`,
				transformJson: transform(
					block.blockNumber,
					windowStart,
					args.config.spineBlockSpacing,
					block.finalityState,
				),
				boundJson: {
					x: widthBucket(block.logCount, block.gasUsed),
					y: 4,
					z: depthBucket(block.txCount),
				},
				resourceReference: null,
				resourceName: null,
				metadataJson: blockMetadata(args.config.chainId, block),
				deleted: false,
				desiredRevision,
				updatedAtBlock: block.blockNumber,
			})),
		],
	}
}
