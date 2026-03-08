import type { BlocksEvent, ReorgEvent, StreamBlock } from '@tevm/voltaire/block'
import { Hex } from '@tevm/voltaire/Hex'
import * as Transaction from '@tevm/voltaire/Transaction'

import type { CanonicalBatch, CanonicalBlock, Eip1193Provider, ReorgBatch } from '../shared/types.js'

type TransactionBlock = StreamBlock<'transactions'>
type TransactionsBatch = BlocksEvent<'transactions'>
type TransactionsReorg = ReorgEvent<'transactions'>
type CanonicalReceipt = CanonicalBlock['receipts'][number]
type CanonicalLog = CanonicalReceipt['logs'][number]
type BlockTransaction = TransactionBlock['body']['transactions'][number]

type RpcReceipt = {
	transactionHash: string
	transactionIndex: string
	blockHash: string
	blockNumber: string
	from: string
	to: string | null
	cumulativeGasUsed: string
	gasUsed: string
	contractAddress: string | null
	logs: RpcLog[]
	logsBloom: string
	status?: string
	effectiveGasPrice?: string
	type?: string
}

type RpcLog = {
	address: string
	topics: string[]
	data: string
	blockNumber?: string
	transactionHash?: string
	transactionIndex?: string
	blockHash?: string
	logIndex?: string
	removed?: boolean
}

const parseBigInt = (value: string | undefined | null, fallback = 0n) => (
	value ?
		BigInt(value)
	:
		fallback
)

const parseNumber = (value: string | undefined | null, fallback = 0) => (
	value ?
		Number(BigInt(value))
	:
		fallback
)

const toReceiptType = (transaction: BlockTransaction, value: string | undefined): CanonicalReceipt['type'] => (
	value === '0x1' ?
		'eip2930'
	: value === '0x2' ?
		'eip1559'
	: value === '0x3' ?
		'eip4844'
	: value === '0x4' ?
		'eip7702'
	: transaction.type === 1 ?
		'eip2930'
	: transaction.type === 2 ?
		'eip1559'
	: transaction.type === 3 ?
		'eip4844'
	: transaction.type === 4 ?
		'eip7702'
	:
		'legacy'
)

const normalizeLog = (log: RpcLog): CanonicalLog => ({
	address: log.address,
	topics: log.topics,
	data: Hex.toBytes(log.data),
	blockNumber: log.blockNumber ? BigInt(log.blockNumber) : undefined,
	transactionHash: log.transactionHash,
	transactionIndex: log.transactionIndex ? Number(BigInt(log.transactionIndex)) : undefined,
	blockHash: log.blockHash,
	logIndex: log.logIndex ? Number(BigInt(log.logIndex)) : undefined,
	removed: log.removed,
}) as unknown as CanonicalLog

const normalizeReceipt = ({
	transaction,
	receipt,
}: {
	transaction: BlockTransaction
	receipt: RpcReceipt
}): CanonicalReceipt => ({
	transactionHash: receipt.transactionHash,
	transactionIndex: parseNumber(receipt.transactionIndex),
	blockHash: receipt.blockHash,
	blockNumber: parseBigInt(receipt.blockNumber),
	from: receipt.from,
	to: receipt.to,
	cumulativeGasUsed: parseBigInt(receipt.cumulativeGasUsed),
	gasUsed: parseBigInt(receipt.gasUsed),
	contractAddress: receipt.contractAddress,
	logs: receipt.logs.map(normalizeLog),
	logsBloom: Hex.toBytes(receipt.logsBloom),
	status: receipt.status ? parseNumber(receipt.status) : undefined,
	effectiveGasPrice: parseBigInt(receipt.effectiveGasPrice),
	type: toReceiptType(transaction, receipt.type),
}) as unknown as CanonicalReceipt

const fetchWithConcurrency = async <TItem, TResult>({
	items,
	concurrency,
	fn,
}: {
	items: readonly TItem[]
	concurrency: number
	fn: (item: TItem, index: number) => Promise<TResult>
}) => {
	if (items.length === 0) {
		return [] as TResult[]
	}

	const results = new Array<TResult>(items.length)
	let nextIndex = 0
	const workerCount = Math.max(1, Math.min(concurrency, items.length))

	await Promise.all(
		Array.from({
			length: workerCount,
		}, async () => {
			while (nextIndex < items.length) {
				const currentIndex = nextIndex++
				results[currentIndex] = await fn(items[currentIndex], currentIndex)
			}
		}),
	)

	return results
}

const defaultGetTransactionHash = (transaction: BlockTransaction) => {
	const rpc = transaction as { hash?: string }
	if (typeof rpc.hash === 'string') {
		return rpc.hash.toLowerCase()
	}
	return Hex.fromBytes(Transaction.hash(transaction)).toLowerCase()
}

const defaultFetchReceiptByHash = async ({
	provider,
	txHash,
}: {
	provider: Eip1193Provider
	txHash: string
}) => {
	const receipt = await provider.request({
		method: 'eth_getTransactionReceipt',
		params: [
			txHash,
		],
	})

	if (!receipt || typeof receipt !== 'object') {
		throw new Error(`Missing receipt for transaction ${txHash}`)
	}

	return receipt as RpcReceipt
}

const enrichBlockWithReceipts = async ({
	block,
	provider,
	receiptFetchConcurrency,
	getTransactionHash = defaultGetTransactionHash,
	fetchReceiptByHash = defaultFetchReceiptByHash,
}: {
	block: TransactionBlock
	provider: Eip1193Provider
	receiptFetchConcurrency: number
	getTransactionHash?: (transaction: BlockTransaction) => string
	fetchReceiptByHash?: (args: {
		provider: Eip1193Provider
		txHash: string
	}) => Promise<RpcReceipt>
}): Promise<CanonicalBlock> => {
	const rpc = block as Record<string, unknown>
	const transactions = block.body?.transactions ?? rpc.transactions ?? []
	const normalized = (
		block.header && block.body ?
			block
		:
			{
				...block,
				header: {
					number: typeof rpc.number === 'bigint' ? rpc.number : BigInt(rpc.number as string),
					hash: rpc.hash,
					parentHash: rpc.parentHash,
					timestamp: typeof rpc.timestamp === 'bigint' ? rpc.timestamp : BigInt(rpc.timestamp as string),
					gasUsed: typeof rpc.gasUsed === 'bigint' ? rpc.gasUsed : BigInt(rpc.gasUsed as string),
					gasLimit: typeof rpc.gasLimit === 'bigint' ? rpc.gasLimit : BigInt(rpc.gasLimit as string),
					baseFeePerGas: rpc.baseFeePerGas != null ?
						(typeof rpc.baseFeePerGas === 'bigint' ? rpc.baseFeePerGas : BigInt(rpc.baseFeePerGas as string))
					:	undefined,
				},
				body: { transactions },
			}
	)
	return {
		...normalized,
		receipts: await fetchWithConcurrency({
			items: transactions,
			concurrency: receiptFetchConcurrency,
			fn: async (transaction) => (
				normalizeReceipt({
					transaction,
					receipt: await fetchReceiptByHash({
						provider,
						txHash: getTransactionHash(transaction),
					}),
				})
			),
		}),
	} as CanonicalBlock
}

export const enrichBlocksEventWithReceipts = async ({
	event,
	provider,
	receiptFetchConcurrency,
	getTransactionHash,
	fetchReceiptByHash,
}: {
	event: TransactionsBatch
	provider: Eip1193Provider
	receiptFetchConcurrency: number
	getTransactionHash?: (transaction: BlockTransaction) => string
	fetchReceiptByHash?: (args: {
		provider: Eip1193Provider
		txHash: string
	}) => Promise<RpcReceipt>
}): Promise<CanonicalBatch> => ({
	type: 'blocks',
	blocks: await Promise.all(
		event.blocks.map((block) => (
			enrichBlockWithReceipts({
				block,
				provider,
				receiptFetchConcurrency,
				getTransactionHash,
				fetchReceiptByHash,
			})
		)),
	),
	metadata: event.metadata,
})

export const enrichReorgEventWithReceipts = async ({
	event,
	provider,
	receiptFetchConcurrency,
	getTransactionHash,
	fetchReceiptByHash,
}: {
	event: TransactionsReorg
	provider: Eip1193Provider
	receiptFetchConcurrency: number
	getTransactionHash?: (transaction: BlockTransaction) => string
	fetchReceiptByHash?: (args: {
		provider: Eip1193Provider
		txHash: string
	}) => Promise<RpcReceipt>
}): Promise<ReorgBatch> => ({
	type: 'reorg',
	removed: event.removed,
	added: await Promise.all(
		event.added.map((block) => (
			enrichBlockWithReceipts({
				block,
				provider,
				receiptFetchConcurrency,
				getTransactionHash,
				fetchReceiptByHash,
			})
		)),
	),
	commonAncestor: event.commonAncestor,
	metadata: event.metadata,
})
