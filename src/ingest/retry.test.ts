import { describe, expect, it } from 'vitest'

import { getRetryDelayMs, isRetriableIngestError } from './retry.js'

describe('getRetryDelayMs', () => {
	it('uses exponential backoff capped at the max', () => {
		expect(getRetryDelayMs({
			attempt: 0,
			minMs: 1000,
			maxMs: 30000,
		})).toBe(1000)

		expect(getRetryDelayMs({
			attempt: 1,
			minMs: 1000,
			maxMs: 30000,
		})).toBe(2000)

		expect(getRetryDelayMs({
			attempt: 10,
			minMs: 1000,
			maxMs: 30000,
		})).toBe(30000)
	})
})

describe('isRetriableIngestError', () => {
	it('treats disconnect and timeout errors as retriable', () => {
		expect(isRetriableIngestError(new Error('Provider disconnected: socket closed'))).toBe(true)
		expect(isRetriableIngestError(new Error('RPC timeout after 30000ms'))).toBe(true)
	})

	it('treats transient postgres errors as retriable', () => {
		expect(isRetriableIngestError(Object.assign(
			new Error('terminating connection due to administrator command'),
			{
				code: '57P01',
			},
		))).toBe(true)
	})

	it('fails fast for config and chain mismatch errors', () => {
		expect(isRetriableIngestError(new Error('Missing required environment variable: DATABASE_URL'))).toBe(false)
		expect(isRetriableIngestError(new Error('Expected chain 1 but provider reported 10'))).toBe(false)
	})
})
