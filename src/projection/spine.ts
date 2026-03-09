import { blockResource, blockVisualScale, districtResource } from './resources.js'

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

const transform = (block: SpineBlock, windowStart: bigint, blockSpacing: number) => {
	const scale = blockVisualScale({
		txCount: block.txCount,
		logCount: block.logCount,
		gasUsed: block.gasUsed,
	})

	return {
	position: {
		x: 0,
		y: finalityBand(block.finalityState) + (scale.y / 2),
		z: Number(block.blockNumber - windowStart) * blockSpacing,
	},
	rotation: {
		x: 0,
		y: 0,
		z: 0,
		w: 1,
	},
	scale: {
		x: scale.x,
		y: scale.y,
		z: scale.z,
	},
	}
}

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
				...districtResource(),
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
						y: 1,
						z: Math.max(12, ((args.blocks.length - 1) * args.config.spineBlockSpacing) / 2),
					},
					rotation: {
						x: 0,
						y: 0,
						z: 0,
						w: 1,
					},
					scale: {
						x: 28,
						y: 2,
						z: Math.max(18, args.blocks.length * args.config.spineBlockSpacing),
					},
				},
				boundJson: {
					x: 24,
					y: 8,
					z: Math.max(12, args.blocks.length * args.config.spineBlockSpacing),
				},
				...districtResource(),
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
					block,
					windowStart,
					args.config.spineBlockSpacing,
				),
				boundJson: {
					x: widthBucket(block.logCount, block.gasUsed),
					y: 4,
					z: depthBucket(block.txCount),
				},
				...blockResource(block.finalityState),
				metadataJson: blockMetadata(args.config.chainId, block),
				deleted: false,
				desiredRevision,
				updatedAtBlock: block.blockNumber,
			})),
		],
	}
}
