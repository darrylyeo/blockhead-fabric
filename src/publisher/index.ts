import 'dotenv/config'

import { connectDb } from '../db/connect.js'
import { sleep } from '../ingest/retry.js'
import { createLogger } from '../shared/log.js'

import { loadPublisherConfig } from './config.js'
import { deleteFabricBinding, getFabricBinding, getObjectIdByFabricName, upsertFabricBinding } from './db.js'
import { createFabricClient } from './fabricClient.js'
import { runPublisherRound } from './reconcile.js'

export const run = async () => {
	const config = loadPublisherConfig()
	const logger = createLogger()
	const db = connectDb({
		databaseUrl: config.databaseUrl,
	})
	const fabricClient = createFabricClient({
		bindingStore: {
			get: (scopeId, objectId) => getFabricBinding(db, { scopeId, objectId }),
			set: (scopeId, objectId, ref, lastSeenRevision, fabricName) => upsertFabricBinding(db, {
				scopeId,
				objectId,
				remoteClassId: ref.classId,
				remoteObjectIx: ref.objectIx,
				lastSeenRevision,
				fabricName: fabricName ?? null,
			}),
			getObjectIdByFabricName: (scopeId, fabricName) => getObjectIdByFabricName(db, { scopeId, fabricName }),
			delete: (scopeId, objectId) => deleteFabricBinding(db, { scopeId, objectId }),
		},
	})

	logger.info('publisher.start', {
		fabricUrl: config.fabricUrl,
		publisherPollIntervalMs: config.publisherPollIntervalMs,
		publisherConnectTimeoutMs: config.publisherConnectTimeoutMs,
	})

	try {
		const connection = await fabricClient.connectRoot({
			fabricUrl: config.fabricUrl,
			adminKey: config.fabricAdminKey,
			timeoutMs: config.publisherConnectTimeoutMs,
		})
		logger.info('publisher.capability_probe_ok', {
			scopeId: connection.scopeId,
			rootObjectId: connection.rootObjectId,
		})
	} catch (error) {
		logger.errorFrom('publisher.capability_probe_failed', error)
		await db.end()
		process.exitCode = 1
		return
	}

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
