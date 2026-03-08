import 'dotenv/config'

import { connectDb } from '../db/connect.js'
import { sleep } from '../ingest/retry.js'
import { createWsProvider } from '../provider/createWsProvider.js'
import { loadConfig } from '../shared/config.js'
import { createLogger } from '../shared/log.js'

import { loadProjectionConfig } from './config.js'
import { runProjectionRound } from './runRound.js'

export { runProjectionRound }

export const run = async () => {
	const config = loadProjectionConfig()
	const sharedConfig = loadConfig()
	const logger = createLogger()
	const db = connectDb({
		databaseUrl: config.databaseUrl,
	})
	const provider = createWsProvider({
		url: sharedConfig.rpcWssUrl,
		requestTimeoutMs: sharedConfig.rpcRequestTimeoutMs,
		reconnectBackoffMinMs: sharedConfig.reconnectBackoffMinMs,
		reconnectBackoffMaxMs: sharedConfig.reconnectBackoffMaxMs,
	})

	logger.info('projection.start', {
		chainId: config.chainId.toString(),
		projectionPollIntervalMs: config.projectionPollIntervalMs,
		spineRecentBlockCount: config.spineRecentBlockCount,
	})

	try {
		for (;;) {
			try {
				const processed = await runProjectionRound({
					config,
					db,
					provider,
				})

				if (!processed) {
					await sleep(config.projectionPollIntervalMs)
				}
			} catch (error) {
				logger.errorFrom('projection.round_failed', error)
				await sleep(config.projectionPollIntervalMs)
			}
		}
	} finally {
		await provider.close()
		await db.end()
	}
}

run().catch((error) => {
	createLogger().errorFrom('projection.fatal', error)
	process.exitCode = 1
})
