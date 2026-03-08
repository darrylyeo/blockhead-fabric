import { afterEach, describe, expect, it } from 'vitest'

import { loadProjectionConfig } from './config.js'

const originalEnv = {
	...process.env,
}

afterEach(() => {
	process.env = {
		...originalEnv,
	}
})

describe('loadProjectionConfig', () => {
	it('loads defaults', () => {
		process.env.DATABASE_URL = 'postgres://blockhead:blockhead@localhost:5432/blockhead'
		delete process.env.CHAIN_ID
		delete process.env.PROJECTION_POLL_INTERVAL_MS
		delete process.env.SPINE_RECENT_BLOCK_COUNT
		delete process.env.SPINE_BLOCK_SPACING

		expect(loadProjectionConfig()).toMatchObject({
			databaseUrl: 'postgres://blockhead:blockhead@localhost:5432/blockhead',
			chainId: 1n,
			projectionPollIntervalMs: 1000,
			spineRecentBlockCount: 256,
			maxTxPulsesPerBlock: 24,
			spineBlockSpacing: 24,
			districtSpacing: 256,
			slotSpacing: 12,
			topContractLandmarksPerDistrict: 8,
			projectionVersion: 1n,
			districtAlgorithmVersion: 1n,
			anchorAlgorithmVersion: 1n,
			corridorAlgorithmVersion: 1n,
			surfaceAlgorithmVersion: 1n,
		})
	})

	it('requires DATABASE_URL', () => {
		delete process.env.DATABASE_URL

		expect(() => {
			loadProjectionConfig()
		}).toThrow('Missing required environment variable: DATABASE_URL')
	})
})
