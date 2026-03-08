import { describe, expect, it } from 'vitest'

import { enrichBlocksEventWithReceipts, enrichReorgEventWithReceipts } from './receiptFallback.js'
import { createMockProvider, createTransactionsBatch, createTransactionsReorgBatch } from '../test/factories.js'

describe('enrichBlocksEventWithReceipts', () => {
	it('fetches one receipt per transaction and preserves metadata', async () => {
		const event = createTransactionsBatch()
		const seenHashes: string[] = []

		const batch = await enrichBlocksEventWithReceipts({
			event,
			provider: createMockProvider(async () => {
				throw new Error('provider should not be called when fetchReceiptByHash is stubbed')
			}),
			receiptFetchConcurrency: 2,
			getTransactionHash: () => '0xabc',
			fetchReceiptByHash: async ({ txHash }) => {
				seenHashes.push(txHash)

				return {
					transactionHash: txHash,
					transactionIndex: '0x0',
					blockHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
					blockNumber: '0x2a',
					from: '0x1111111111111111111111111111111111111111',
					to: '0x2222222222222222222222222222222222222222',
					cumulativeGasUsed: '0x5208',
					gasUsed: '0x5208',
					contractAddress: null,
					logs: [],
					logsBloom: '0x' + '00'.repeat(256),
					status: '0x1',
					effectiveGasPrice: '0x1',
					type: '0x0',
				}
			},
		})

		expect(seenHashes).toEqual([
			'0xabc',
		])
		expect(batch.type).toBe('blocks')
		expect(batch.metadata).toEqual(event.metadata)
		expect(batch.blocks).toHaveLength(1)
		expect(batch.blocks[0].receipts[0].transactionHash).toBe('0xabc')
		expect(batch.blocks[0].receipts[0].type).toBe('legacy')
	})
})

describe('enrichReorgEventWithReceipts', () => {
	it('preserves removed blocks and enriches added blocks', async () => {
		const event = createTransactionsReorgBatch()

		const reorg = await enrichReorgEventWithReceipts({
			event,
			provider: createMockProvider(async () => {
				throw new Error('provider should not be called when fetchReceiptByHash is stubbed')
			}),
			receiptFetchConcurrency: 1,
			getTransactionHash: () => '0xdef',
			fetchReceiptByHash: async ({ txHash }) => ({
				transactionHash: txHash,
				transactionIndex: '0x0',
				blockHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
				blockNumber: '0x2a',
				from: '0x1111111111111111111111111111111111111111',
				to: '0x2222222222222222222222222222222222222222',
				cumulativeGasUsed: '0x5208',
				gasUsed: '0x5208',
				contractAddress: null,
				logs: [],
				logsBloom: '0x' + '00'.repeat(256),
				status: '0x1',
				effectiveGasPrice: '0x1',
				type: '0x2',
			}),
		})

		expect(reorg.type).toBe('reorg')
		expect(reorg.removed).toEqual(event.removed)
		expect(reorg.commonAncestor).toEqual(event.commonAncestor)
		expect(reorg.added[0].receipts[0].transactionHash).toBe('0xdef')
		expect(reorg.added[0].receipts[0].type).toBe('eip1559')
	})
})
