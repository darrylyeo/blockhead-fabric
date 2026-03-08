import { describe, expect, it } from 'vitest'

import { capabilitiesForLogs, checkpointForLogs, createLogger, sanitizeConfigForLogs } from './log.js'
import { createConfig } from '../test/factories.js'

describe('sanitizeConfigForLogs', () => {
	it('omits the database url and stringifies bigint fields', () => {
		expect(sanitizeConfigForLogs(createConfig())).toEqual({
			chainId: '1',
			rpcWssUrl: 'wss://execution-node.example',
			forceReceiptFallback: false,
			blockstreamPollingIntervalMs: 1000,
			finalityDepth: '64',
			backfillChunkSize: 100,
			ingestStartBlock: '0',
			rpcRequestTimeoutMs: 30000,
			reconnectBackoffMinMs: 1000,
			reconnectBackoffMaxMs: 30000,
			receiptFetchConcurrency: 16,
			backfillTxBatchSize: 32,
			projectionJobMinRange: 1,
			projectionJobCoalesceGap: 8,
		})
	})
})

describe('createLogger', () => {
	it('emits structured json records to the correct level', () => {
		const lines: string[] = []
		const logger = createLogger({
			log(line) {
				lines.push(`info:${line}`)
			},
			warn(line) {
				lines.push(`warn:${line}`)
			},
			error(line) {
				lines.push(`error:${line}`)
			},
		})

		logger.info('ingest.start', {
			chainId: '1',
		})
		logger.warn('ingest.deep_reorg.restart', {
			fromBlock: '42',
		})
		logger.errorFrom('ingest.watch.failed', new Error('boom'))

		expect(lines).toHaveLength(3)
		expect(JSON.parse(lines[0].slice(5))).toMatchObject({
			level: 'info',
			event: 'ingest.start',
			data: {
				chainId: '1',
			},
		})
		expect(JSON.parse(lines[1].slice(5))).toMatchObject({
			level: 'warn',
			event: 'ingest.deep_reorg.restart',
		})
		expect(JSON.parse(lines[2].slice(6))).toMatchObject({
			level: 'error',
			event: 'ingest.watch.failed',
			data: {
				error: {
					name: 'Error',
					message: 'boom',
				},
			},
		})
	})
})

describe('log serializers', () => {
	it('serialize capabilities and checkpoints for logs', () => {
		expect(capabilitiesForLogs({
			endpointId: 'wss://execution-node.example',
			chainId: 1n,
			supportsBlockReceipts: true,
			supportsBlockHashLogs: false,
			supportsSafeTag: true,
			supportsFinalizedTag: false,
			checkedAt: new Date('2026-03-08T00:00:00.000Z'),
			rawJson: {},
		})).toEqual({
			endpointId: 'wss://execution-node.example',
			chainId: '1',
			supportsBlockReceipts: true,
			supportsBlockHashLogs: false,
			supportsSafeTag: true,
			supportsFinalizedTag: false,
			checkedAt: '2026-03-08T00:00:00.000Z',
		})

		expect(checkpointForLogs({
			chainId: 1n,
			lastSeenBlockNumber: 42n,
			lastSeenBlockHash: '0xabc',
			lastFinalizedBlockNumber: 21n,
			updatedAt: new Date('2026-03-08T00:00:00.000Z'),
		})).toEqual({
			chainId: '1',
			lastSeenBlockNumber: '42',
			lastSeenBlockHash: '0xabc',
			lastFinalizedBlockNumber: '21',
			updatedAt: '2026-03-08T00:00:00.000Z',
		})
	})
})
