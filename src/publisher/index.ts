import { connectDb } from '../db/connect.js'
import { sleep } from '../ingest/retry.js'
import { createLogger } from '../shared/log.js'

import { loadPublisherConfig } from './config.js'
import { createFabricClient } from './fabricClient.js'
import { runPublisherRound } from './reconcile.js'

export const run = async () => {
	const config = loadPublisherConfig()
	const logger = createLogger()
	const db = connectDb({
		databaseUrl: config.databaseUrl,
	})
	const fabricClient = createFabricClient()

	logger.info('publisher.start', {
		fabricUrl: config.fabricUrl,
		publisherPollIntervalMs: config.publisherPollIntervalMs,
		publisherConnectTimeoutMs: config.publisherConnectTimeoutMs,
	})

	try {
		for (;;) {
			await runPublisherRound({
				config,
				db,
				fabricClient,
				logger,
			})

			await sleep(config.publisherPollIntervalMs)
		}
	} finally {
		await db.end()
	}
}

run().catch((error) => {
	createLogger().errorFrom('publisher.fatal', error)
	process.exitCode = 1
})
