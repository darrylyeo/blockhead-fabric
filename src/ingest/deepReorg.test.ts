import { describe, expect, it } from 'vitest'

import { getDeepReorgRestartBlock } from './deepReorg.js'

describe('getDeepReorgRestartBlock', () => {
	it('prefers the last finalized block when present', () => {
		expect(getDeepReorgRestartBlock({
			checkpoint: {
				chainId: 1n,
				lastSeenBlockNumber: 100n,
				lastSeenBlockHash: '0xabc',
				lastFinalizedBlockNumber: 80n,
				updatedAt: new Date(),
			},
			ingestStartBlock: 0n,
			fallbackDistance: 64n,
		})).toBe(80n)
	})

	it('falls back to a conservative distance behind the last seen block', () => {
		expect(getDeepReorgRestartBlock({
			checkpoint: {
				chainId: 1n,
				lastSeenBlockNumber: 100n,
				lastSeenBlockHash: '0xabc',
				lastFinalizedBlockNumber: 0n,
				updatedAt: new Date(),
			},
			ingestStartBlock: 0n,
			fallbackDistance: 64n,
		})).toBe(36n)
	})

	it('uses the ingest start block when no checkpoint exists', () => {
		expect(getDeepReorgRestartBlock({
			checkpoint: null,
			ingestStartBlock: 12n,
			fallbackDistance: 64n,
		})).toBe(12n)
	})
})
