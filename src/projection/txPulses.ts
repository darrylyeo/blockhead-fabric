import { blockScaleByNumber, selectTxPulseGroups, txPulseVisuals } from './blockActivityLayout.js'
import { txResource } from './resources.js'

import type {
	ProjectedFabricObject,
	ProjectionConfig,
	SpineBlock,
} from './types.js'
import type { TxPulseInput } from './blockActivityLayout.js'

const recentWindowSize = 32n

const shorten = (address: string | null) => (
	!address ?
		'Contract Creation'
	:
		`${address.slice(0, 8)}...${address.slice(-4)}`
)

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
	const blockScales = blockScaleByNumber(args.blocks)

	return selectTxPulseGroups({
		config: args.config,
		headBlockNumber: args.headBlockNumber,
		blocks: args.blocks,
		transactions: args.transactions,
		recentWindowSize,
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

			return {
				scopeId,
				objectId: `tx:${args.config.chainId.toString()}:${transaction.txHash}`,
				entrypointId: 'entry_latest_spine',
				parentObjectId: `block:${args.config.chainId.toString()}:${transaction.blockNumber.toString()}`,
				entityId: `tx:${args.config.chainId.toString()}:${transaction.txHash}`,
				classId: 73,
				type: 0,
				subtype: 0,
				name: `Tx ${shorten(transaction.toAddress)}`,
				transformJson: {
					position: visuals.position,
					rotation: {
						x: 0,
						y: 0,
						z: 0,
						w: 1,
					},
					scale: visuals.scale,
				},
				boundJson: visuals.scale,
				...txResource(),
				metadataJson: metadata(args.config.chainId, transaction),
				deleted: false,
				desiredRevision: args.headBlockNumber,
				updatedAtBlock: transaction.blockNumber,
			} satisfies ProjectedFabricObject
		})
	))
}
