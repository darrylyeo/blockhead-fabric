import type {
	ProjectedFabricObject,
	ProjectionConfig,
	SpineBlock,
} from './types.js'

type TxPulseInput = {
	txHash: string
	blockNumber: bigint
	txIndex: number
	fromAddress: string
	toAddress: string | null
	valueWei: string
	gasUsed: string
}

const recentWindowSize = 32n

const shorten = (address: string | null) => (
	!address ?
		'Contract Creation'
	:
		`${address.slice(0, 8)}...${address.slice(-4)}`
)

const pulseTransform = (index: number) => ({
	position: {
		x: (index % 6) * 4 - 10,
		y: 8 + Math.floor(index / 6) * 2,
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

const pulseBounds = (valueWei: string, gasUsed: string) => ({
	x: Math.max(2, Math.min(12, String(valueWei).length / 2)),
	y: Math.max(2, Math.min(12, String(gasUsed).length / 2)),
	z: 2,
})

const metadata = (chainId: bigint, tx: TxPulseInput) => ({
	schemaVersion: 1,
	entityId: `tx:${chainId.toString()}:${tx.txHash}`,
	entityKind: 'transaction',
	chainId: Number(chainId),
	canonical: true,
	updatedAtBlock: tx.blockNumber.toString(),
	txHash: tx.txHash,
	blockNumber: tx.blockNumber.toString(),
	txIndex: tx.txIndex,
	fromAddress: tx.fromAddress,
	toAddress: tx.toAddress,
	valueWei: tx.valueWei,
	gasUsed: tx.gasUsed,
})

export const materializeTxPulses = (args: {
	config: ProjectionConfig
	headBlockNumber: bigint
	blocks: SpineBlock[]
	transactions: TxPulseInput[]
}) => {
	const scopeId = args.config.chainId === 1n ?
		'scope_eth_mainnet'
	:
		`scope_chain_${args.config.chainId.toString()}`
	const recentBlockFloor = args.headBlockNumber >= recentWindowSize - 1n ?
		args.headBlockNumber - (recentWindowSize - 1n)
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

	const groupedTransactions = Array.from(
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
			.values(),
	)

	return groupedTransactions.flatMap((transactions) => (
		[
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
			.slice(0, args.config.maxTxPulsesPerBlock)
			.map((transaction, index) => ({
				scopeId,
				objectId: `tx:${args.config.chainId.toString()}:${transaction.txHash}`,
				entrypointId: 'entry_latest_spine',
				parentObjectId: `block:${args.config.chainId.toString()}:${transaction.blockNumber.toString()}`,
				entityId: `tx:${args.config.chainId.toString()}:${transaction.txHash}`,
				classId: 73,
				type: 0,
				subtype: 0,
				name: `Tx ${shorten(transaction.toAddress)}`,
				transformJson: pulseTransform(index),
				boundJson: pulseBounds(transaction.valueWei, transaction.gasUsed),
				resourceReference: null,
				resourceName: null,
				metadataJson: metadata(args.config.chainId, transaction),
				deleted: false,
				desiredRevision: args.headBlockNumber,
				updatedAtBlock: transaction.blockNumber,
			} satisfies ProjectedFabricObject))
	))
}
