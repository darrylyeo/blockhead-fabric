import { afterEach, describe, expect, it } from 'vitest'

import { loadConfig } from './config.js'

const originalEnv = {
	...process.env,
}

afterEach(() => {
	process.env = {
		...originalEnv,
	}
})

describe('loadConfig', () => {
	it('loads required env and default values', () => {
		process.env.CHAIN_ID = '1'
		process.env.RPC_WSS_URL = 'wss://execution-node.example'
		process.env.DATABASE_URL = 'postgres://example'

		expect(loadConfig()).toEqual({
			chainId: 1n,
			rpcWssUrl: 'wss://execution-node.example',
			databaseUrl: 'postgres://example',
			forceReceiptFallback: false,
			blockstreamPollingIntervalMs: 1000,
			finalityDepth: 64n,
			backfillChunkSize: 100,
			ingestStartBlock: 0n,
			rpcRequestTimeoutMs: 30000,
			reconnectBackoffMinMs: 1000,
			reconnectBackoffMaxMs: 30000,
			receiptFetchConcurrency: 16,
			backfillTxBatchSize: 32,
			projectionJobMinRange: 1,
			projectionJobCoalesceGap: 8,
			eventStreamErc20Enabled: false,
		})
	})

	it('throws when required env is missing', () => {
		delete process.env.RPC_WSS_URL
		delete process.env.DATABASE_URL

		expect(() => (
			loadConfig()
		)).toThrow('Missing required environment variable: RPC_WSS_URL')
	})
})
