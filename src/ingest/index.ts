import 'dotenv/config'

import { BlockStream, BlockStreamAbortedError, UnrecoverableReorgError } from '@tevm/voltaire/block'
import type { Pool, PoolClient } from 'pg'

import { connectDb } from '../db/connect.js'
import { getIngestCheckpoint, upsertRpcCapabilities } from '../db/queries.js'
import { createWsProvider } from '../provider/createWsProvider.js'
import { probeCapabilities } from '../provider/probeCapabilities.js'
import { loadConfig } from '../shared/config.js'
import { capabilitiesForLogs, checkpointForLogs, createLogger, sanitizeConfigForLogs } from '../shared/log.js'
import { getDeepReorgRestartBlock } from './deepReorg.js'
import { runEventStreamBackfill } from './eventStreamRunner.js'
import { enrichBlocksEventWithReceipts, enrichReorgEventWithReceipts } from './receiptFallback.js'
import { getRetryDelayMs, isRetriableIngestError, sleep } from './retry.js'
import { applyCanonicalBatch, handleReorg, invalidateCanonicalRange, updateFinality } from './store.js'

const getHexNumber = async ({
	provider,
	method,
	params = [],
}: {
	provider: { request(args: { method: string, params?: unknown[] }): Promise<unknown> }
	method: string
	params?: unknown[]
}) => {
	const result = await provider.request({
		method,
		params,
	})

	if (typeof result !== 'string') {
		throw new Error(`Expected hex string result from ${method}`)
	}

	return BigInt(result)
}

const withTransaction = async <T>({
	db,
	fn,
}: {
	db: Pool
	fn: (client: PoolClient) => Promise<T>
}) => {
	const client = await db.connect()

	try {
		await client.query('begin')
		const result = await fn(client)
		await client.query('commit')
		return result
	} catch (error) {
		await client.query('rollback')
		throw error
	} finally {
		client.release()
	}
}

const runBackfillRange = async ({
	stream,
	db,
	config,
	capabilities,
	provider,
	fromBlock,
	toBlock,
	signal,
	logger,
}: {
	stream: ReturnType<typeof BlockStream>
	db: Pool
	config: ReturnType<typeof loadConfig>
	capabilities: Awaited<ReturnType<typeof probeCapabilities>>
	provider: ReturnType<typeof createWsProvider>
	fromBlock: bigint
	toBlock: bigint
	signal: AbortSignal
	logger: ReturnType<typeof createLogger>
}) => {
	if (fromBlock > toBlock) {
		return
	}

	logger.info('ingest.backfill.start', {
		fromBlock: fromBlock.toString(),
		toBlock: toBlock.toString(),
		mode: capabilities.supportsBlockReceipts && !config.forceReceiptFallback ? 'receipts' : 'transactions+receipt-fallback',
	})

	if (capabilities.supportsBlockReceipts && !config.forceReceiptFallback) {
		for await (const batch of stream.backfill({
			fromBlock,
			toBlock,
			include: 'receipts',
			chunkSize: config.backfillChunkSize,
			signal,
		})) {
			if (batch.blocks.length === 0) {
				continue
			}
			logger.info('ingest.batch.commit', {
				source: 'backfill',
				type: batch.type,
				fromBlock: batch.blocks[0]?.header?.number?.toString() ?? '?',
				toBlock: batch.blocks.at(-1)?.header?.number?.toString() ?? '?',
				blockCount: batch.blocks.length,
				chainHead: batch.metadata.chainHead.toString(),
			})

			await withTransaction({
				db,
				fn: async (client) => {
					await applyCanonicalBatch({
						db: client,
						config,
						batch,
						provider,
					})
				},
			})
			await updateFinality({
				db,
				config,
				capabilities,
				provider,
			})

			const checkpoint = await getIngestCheckpoint({
				db,
				chainId: config.chainId,
			})

			logger.info('ingest.checkpoint.updated', {
				checkpoint: checkpointForLogs(checkpoint),
			})
		}

		logger.info('ingest.backfill.finish', {
			fromBlock: fromBlock.toString(),
			toBlock: toBlock.toString(),
		})

		return
	}

	for await (const event of stream.backfill({
		fromBlock,
		toBlock,
		include: 'transactions',
		chunkSize: config.backfillChunkSize,
		signal,
	})) {
		const batch = await enrichBlocksEventWithReceipts({
			event,
			provider,
			receiptFetchConcurrency: config.receiptFetchConcurrency,
		})

		logger.info('ingest.batch.commit', {
			source: 'backfill',
			type: batch.type,
			fromBlock: batch.blocks[0]?.header.number.toString(),
			toBlock: batch.blocks.at(-1)?.header.number.toString(),
			blockCount: batch.blocks.length,
			chainHead: batch.metadata.chainHead.toString(),
		})

		await withTransaction({
			db,
			fn: async (client) => {
				await applyCanonicalBatch({
					db: client,
					config,
					batch,
					provider,
				})
			},
		})
		await updateFinality({
			db,
			config,
			capabilities,
			provider,
		})

		const checkpoint = await getIngestCheckpoint({
			db,
			chainId: config.chainId,
		})

		logger.info('ingest.checkpoint.updated', {
			checkpoint: checkpointForLogs(checkpoint),
		})
	}

	logger.info('ingest.backfill.finish', {
		fromBlock: fromBlock.toString(),
		toBlock: toBlock.toString(),
	})
}

const runWatchRound = async ({
	stream,
	db,
	config,
	capabilities,
	provider,
	fromBlock,
	signal,
	logger,
}: {
	stream: ReturnType<typeof BlockStream>
	db: Pool
	config: ReturnType<typeof loadConfig>
	capabilities: Awaited<ReturnType<typeof probeCapabilities>>
	provider: ReturnType<typeof createWsProvider>
	fromBlock: bigint
	signal: AbortSignal
	logger: ReturnType<typeof createLogger>
}) => {
	logger.info('ingest.watch.start', {
		fromBlock: fromBlock.toString(),
		mode: capabilities.supportsBlockReceipts && !config.forceReceiptFallback ? 'receipts' : 'transactions+receipt-fallback',
	})

	if (capabilities.supportsBlockReceipts && !config.forceReceiptFallback) {
		for await (const event of stream.watch({
			fromBlock,
			include: 'receipts',
			pollingInterval: config.blockstreamPollingIntervalMs,
			signal,
		})) {
			logger.info(
				event.type === 'reorg' ?
					'ingest.reorg.detected'
				:
					'ingest.batch.commit',
				event.type === 'reorg' ?
					{
						source: 'watch',
						commonAncestor: event.commonAncestor.number.toString(),
						removedCount: event.removed.length,
						addedCount: event.added.length,
						chainHead: event.metadata.chainHead.toString(),
					}
				:
					{
						source: 'watch',
						type: event.type,
						fromBlock: event.blocks[0]?.header.number.toString(),
						toBlock: event.blocks.at(-1)?.header.number.toString(),
						blockCount: event.blocks.length,
						chainHead: event.metadata.chainHead.toString(),
					},
			)

			await withTransaction({
				db,
				fn: async (client) => {
					if (event.type === 'reorg') {
						await handleReorg({
							db: client,
							config,
							reorg: event,
						})
					} else {
						await applyCanonicalBatch({
							db: client,
							config,
							batch: event,
							provider,
						})
					}
				},
			})
			await updateFinality({
				db,
				config,
				capabilities,
				provider,
			})

			const checkpoint = await getIngestCheckpoint({
				db,
				chainId: config.chainId,
			})

			logger.info('ingest.checkpoint.updated', {
				checkpoint: checkpointForLogs(checkpoint),
			})
		}

		return
	}

	for await (const event of stream.watch({
		fromBlock,
		include: 'transactions',
		pollingInterval: config.blockstreamPollingIntervalMs,
		signal,
	})) {
		logger.info(
			event.type === 'reorg' ?
				'ingest.reorg.detected'
			:
				'ingest.batch.commit',
			event.type === 'reorg' ?
				{
					source: 'watch',
					commonAncestor: event.commonAncestor.number.toString(),
					removedCount: event.removed.length,
					addedCount: event.added.length,
					chainHead: event.metadata.chainHead.toString(),
				}
			:
				{
					source: 'watch',
					type: event.type,
					fromBlock: event.blocks[0]?.header.number.toString(),
					toBlock: event.blocks.at(-1)?.header.number.toString(),
					blockCount: event.blocks.length,
					chainHead: event.metadata.chainHead.toString(),
				},
		)

		await withTransaction({
			db,
			fn: async (client) => {
				if (event.type === 'reorg') {
					await handleReorg({
						db: client,
						config,
						reorg: await enrichReorgEventWithReceipts({
							event,
							provider,
							receiptFetchConcurrency: config.receiptFetchConcurrency,
						}),
					})
				} else {
					await applyCanonicalBatch({
						db: client,
						config,
						batch: await enrichBlocksEventWithReceipts({
							event,
							provider,
							receiptFetchConcurrency: config.receiptFetchConcurrency,
						}),
						provider,
					})
				}
			},
		})
		await updateFinality({
			db,
			config,
			capabilities,
			provider,
		})

		const checkpoint = await getIngestCheckpoint({
			db,
			chainId: config.chainId,
		})

		logger.info('ingest.checkpoint.updated', {
			checkpoint: checkpointForLogs(checkpoint),
		})
	}
}

const runWorkerIteration = async ({
	config,
	logger,
	signal,
}: {
	config: ReturnType<typeof loadConfig>
	logger: ReturnType<typeof createLogger>
	signal: AbortSignal
}) => {
	const db = connectDb({
		databaseUrl: config.databaseUrl,
	})
	const provider = createWsProvider({
		url: config.rpcWssUrl,
		requestTimeoutMs: config.rpcRequestTimeoutMs,
		reconnectBackoffMinMs: config.reconnectBackoffMinMs,
		reconnectBackoffMaxMs: config.reconnectBackoffMaxMs,
	})

	try {
		const capabilities = await probeCapabilities({
			config,
			provider,
		})

		logger.info('ingest.capabilities.probed', {
			capabilities: capabilitiesForLogs(capabilities),
		})

		await upsertRpcCapabilities({
			db,
			capabilities,
		})

		const checkpoint = await getIngestCheckpoint({
			db,
			chainId: config.chainId,
		})
		logger.info('ingest.checkpoint.loaded', {
			checkpoint: checkpointForLogs(checkpoint),
		})

		const currentHead = await getHexNumber({
			provider,
			method: 'eth_blockNumber',
		})
		logger.info('ingest.head.discovered', {
			currentHead: currentHead.toString(),
		})

		const stream = BlockStream({
			provider,
		})
		const backfillFromBlock = config.ingestRecentBlocksOnly !== undefined ?
			(currentHead >= BigInt(config.ingestRecentBlocksOnly) ?
				currentHead - BigInt(config.ingestRecentBlocksOnly) + 1n
			:
				0n)
		: checkpoint ?
			checkpoint.lastSeenBlockNumber + 1n
		:
			config.ingestStartBlock

		await runBackfillRange({
			stream,
			db,
			config,
			capabilities,
			provider,
			fromBlock: backfillFromBlock,
			toBlock: currentHead,
			signal,
			logger,
		})

		if (config.eventStreamErc20Enabled && backfillFromBlock <= currentHead) {
			const { rows: escRows } = await db.query(
				`select last_seen_block from event_stream_checkpoints where chain_id = $1 and stream_id = 'erc20_usdc_transfer'`,
				[config.chainId.toString()],
			)
			const eventStreamFrom = escRows[0] ?
				BigInt(escRows[0].last_seen_block) + 1n
			:
				backfillFromBlock
			if (eventStreamFrom <= currentHead) {
				logger.info('ingest.event_stream.backfill.start', {
					fromBlock: eventStreamFrom.toString(),
					toBlock: currentHead.toString(),
				})
				await withTransaction({
					db,
					fn: async (client) => {
						await runEventStreamBackfill({
							provider,
							db: client,
							chainId: config.chainId,
							fromBlock: eventStreamFrom,
							toBlock: currentHead,
							signal,
						})
					},
				})
				logger.info('ingest.event_stream.backfill.done', {
					toBlock: currentHead.toString(),
				})
			}
		}

		let watchFromBlock = (
			(await getIngestCheckpoint({
				db,
				chainId: config.chainId,
			}))?.lastSeenBlockNumber ?? currentHead
		) + 1n

		while (!signal.aborted) {
			try {
				await runWatchRound({
					stream,
					db,
					config,
					capabilities,
					provider,
					fromBlock: watchFromBlock,
					signal,
					logger,
				})
				break
			} catch (error) {
				if (signal.aborted || error instanceof BlockStreamAbortedError) {
					break
				}

				if (!(error instanceof UnrecoverableReorgError)) {
					logger.errorFrom('ingest.watch.failed', error, {
						fromBlock: watchFromBlock.toString(),
					})
					throw error
				}

				const latestCheckpoint = await getIngestCheckpoint({
					db,
					chainId: config.chainId,
				})
				const restartFromBlock = getDeepReorgRestartBlock({
					checkpoint: latestCheckpoint,
					ingestStartBlock: config.ingestStartBlock,
					fallbackDistance: config.finalityDepth,
				})
				const restartHead = await getHexNumber({
					provider,
					method: 'eth_blockNumber',
				})

				logger.warn('ingest.deep_reorg.restart', {
					restartFromBlock: restartFromBlock.toString(),
					restartHead: restartHead.toString(),
					previousCheckpoint: checkpointForLogs(latestCheckpoint),
				})

				await withTransaction({
					db,
					fn: async (client) => {
						await invalidateCanonicalRange({
							db: client,
							config,
							fromBlockNumber: restartFromBlock,
						})
					},
				})

				const rewoundCheckpoint = await getIngestCheckpoint({
					db,
					chainId: config.chainId,
				})

				logger.info('ingest.checkpoint.updated', {
					checkpoint: checkpointForLogs(rewoundCheckpoint),
				})

				await runBackfillRange({
					stream,
					db,
					config,
					capabilities,
					provider,
					fromBlock: restartFromBlock,
					toBlock: restartHead,
					signal,
					logger,
				})

				watchFromBlock = (
					(await getIngestCheckpoint({
						db,
						chainId: config.chainId,
					}))?.lastSeenBlockNumber ?? restartHead
				) + 1n

				logger.info('ingest.watch.restart', {
					fromBlock: watchFromBlock.toString(),
				})
			}
		}
	} finally {
		await provider.close()
		await db.end()
	}
}

const run = async () => {
	const config = loadConfig()
	const logger = createLogger()
	const stopController = new AbortController()
	const stop = async () => {
		stopController.abort()
	}

	process.once('SIGINT', () => {
		void stop()
	})

	process.once('SIGTERM', () => {
		void stop()
	})

	logger.info('ingest.start', {
		config: sanitizeConfigForLogs(config),
	})

	let attempt = 0

	while (!stopController.signal.aborted) {
		try {
			await runWorkerIteration({
				config,
				logger,
				signal: stopController.signal,
			})
			break
		} catch (error) {
			if (stopController.signal.aborted || error instanceof BlockStreamAbortedError) {
				break
			}

			if (!isRetriableIngestError(error)) {
				logger.errorFrom('ingest.fatal', error, {
					attempt,
				})
				throw error
			}

			const delayMs = getRetryDelayMs({
				attempt,
				minMs: config.reconnectBackoffMinMs,
				maxMs: config.reconnectBackoffMaxMs,
			})

			logger.warn('ingest.retry.scheduled', {
				attempt: attempt + 1,
				delayMs,
				message: error instanceof Error ? error.message : String(error),
			})

			attempt += 1
			await sleep(delayMs)
		}
	}
}

void run()
