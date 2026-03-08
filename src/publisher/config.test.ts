import { afterEach, describe, expect, it } from 'vitest'

import { loadPublisherConfig } from './config.js'

const originalEnv = {
	...process.env,
}

afterEach(() => {
	process.env = {
		...originalEnv,
	}
})

describe('loadPublisherConfig', () => {
	it('loads defaults', () => {
		process.env.DATABASE_URL = 'postgres://blockhead:blockhead@localhost:5432/blockhead'
		delete process.env.FABRIC_URL
		delete process.env.FABRIC_ADMIN_KEY
		delete process.env.PUBLISHER_POLL_INTERVAL_MS
		delete process.env.PUBLISHER_CONNECT_TIMEOUT_MS
		delete process.env.PUBLISHER_SCOPE_CONCURRENCY
		delete process.env.PUBLISHER_OBJECT_BATCH_SIZE

		expect(loadPublisherConfig()).toEqual({
			databaseUrl: 'postgres://blockhead:blockhead@localhost:5432/blockhead',
			fabricUrl: 'http://localhost:2000/fabric/70/1/',
			fabricAdminKey: undefined,
			publisherPollIntervalMs: 2000,
			publisherConnectTimeoutMs: 60000,
			publisherScopeConcurrency: 1,
			publisherObjectBatchSize: 50,
		})
	})

	it('requires DATABASE_URL', () => {
		delete process.env.DATABASE_URL

		expect(() => {
			loadPublisherConfig()
		}).toThrow('Missing required environment variable: DATABASE_URL')
	})
})
