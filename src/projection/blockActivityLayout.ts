import { blockVisualScale, clamp, magnitudeScale } from './resources.js'

import type { ProjectionConfig, SpineBlock } from './types.js'

export type TxPulseInput = {
	txHash: string
	blockNumber: bigint
	txIndex: number
	fromAddress: string
	toAddress: string | null
	valueWei: string
	gasUsed: string
}

const columnsForCount = (count: number) => (
	Math.min(6, Math.max(2, Math.ceil(Math.sqrt(count))))
)

export const blockScaleByNumber = (blocks: SpineBlock[]) => (
	new Map(
		blocks.map((block) => (
			[
				block.blockNumber.toString(),
				blockVisualScale({
					txCount: block.txCount,
					logCount: block.logCount,
					gasUsed: block.gasUsed,
				}),
			] as const
		)),
	)
)

export const selectTxPulseGroups = (args: {
	config: ProjectionConfig
	headBlockNumber: bigint
	blocks: SpineBlock[]
	transactions: TxPulseInput[]
	recentWindowSize: bigint
}) => {
	const recentBlockFloor = args.headBlockNumber >= args.recentWindowSize - 1n ?
		args.headBlockNumber - (args.recentWindowSize - 1n)
	:
		0n
	const recentBlockIds = new Set(
		args.blocks
			.filter(({ blockNumber }) => (
				blockNumber >= recentBlockFloor
			))
			.map(({ blockNumber }) => (
				blockNumber.toString()
			)),
	)

	return Array.from(
		args.transactions
			.filter(({ blockNumber }) => (
				recentBlockIds.has(blockNumber.toString())
			))
			.reduce<Map<string, TxPulseInput[]>>((grouped, transaction) => {
				const key = transaction.blockNumber.toString()
				const current = grouped.get(key) ?? []

				current.push(transaction)
				grouped.set(key, current)

				return grouped
			}, new Map())
			.entries(),
	).map(([blockNumber, transactions]) => ({
		blockNumber,
		transactions: [
			...transactions,
		]
			.sort((left, right) => (
				BigInt(right.valueWei) > BigInt(left.valueWei) ?
					1
				: BigInt(right.valueWei) < BigInt(left.valueWei) ?
					-1
				: BigInt(right.gasUsed) > BigInt(left.gasUsed) ?
					1
				: BigInt(right.gasUsed) < BigInt(left.gasUsed) ?
					-1
				:
					left.txIndex - right.txIndex
			))
			.slice(0, args.config.maxTxPulsesPerBlock),
	}))
}

export const txPulseVisuals = (args: {
	blockScale: {
		x: number
		y: number
		z: number
	}
	index: number
	count: number
	transaction: TxPulseInput
}) => {
	const columns = columnsForCount(args.count)
	const rows = Math.ceil(args.count / columns)
	const column = args.index % columns
	const row = Math.floor(args.index / columns)
	const spanX = Math.max(4, args.blockScale.x - 3)
	const spanZ = Math.max(4, args.blockScale.z - 3)
	const scale = {
		x: clamp(0.9 + magnitudeScale(args.transaction.valueWei, 0, 1.6, 4), 0.9, 2.2),
		y: clamp(
			1.2
			+ magnitudeScale(args.transaction.gasUsed, 0, 2.6, 2.7)
			+ magnitudeScale(args.transaction.valueWei, 0, 1.8, 5),
			1.2,
			5.6,
		),
		z: clamp(0.9 + magnitudeScale(args.transaction.gasUsed, 0, 1.2, 4.5), 0.9, 1.8),
	}

	return {
		position: {
			x: columns === 1 ? 0 : ((column / (columns - 1)) - 0.5) * spanX,
			y: (args.blockScale.y / 2) + (scale.y / 2) + 0.6,
			z: rows === 1 ? 0 : ((row / (rows - 1)) - 0.5) * spanZ,
		},
		scale,
	}
}

export const eventOffset = (index: number) => {
	const ring = Math.floor(index / 6)
	const radius = 1.5 + (ring * 0.9)
	const angle = (index % 6) * ((Math.PI * 2) / 6)

	return {
		x: Math.cos(angle) * radius,
		y: 0.8 + (ring * 0.5),
		z: Math.sin(angle) * radius,
	}
}
