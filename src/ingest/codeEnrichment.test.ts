import { describe, expect, it } from 'vitest'

import { describeBytecode, fetchCodeAtBlock } from './codeEnrichment.js'
import { createMockProvider } from '../test/factories.js'

describe('describeBytecode', () => {
	it('detects empty code as non-contract', () => {
		expect(describeBytecode('0x')).toEqual({
			isContract: false,
			codeHash: null,
			bytecodeSize: null,
		})
	})

	it('computes code hash and bytecode size for deployed code', () => {
		expect(describeBytecode('0x60016000')).toEqual({
			isContract: true,
			codeHash: '0xcf61a6eb3b9b89e75f1dadf3dcd16509616896cb50eac765a68fa27bbbc6de82',
			bytecodeSize: 4,
		})
	})
})

describe('fetchCodeAtBlock', () => {
	it('requests code at the specific block tag', async () => {
		const calls: unknown[] = []
		const provider = createMockProvider(async (args) => {
			calls.push(args)
			return '0x60016000'
		})

		const code = await fetchCodeAtBlock({
			provider,
			address: '0x3333333333333333333333333333333333333333',
			blockNumber: 42n,
		})

		expect(code).toBe('0x60016000')
		expect(calls).toEqual([
			{
				method: 'eth_getCode',
				params: [
					'0x3333333333333333333333333333333333333333',
					'0x2a',
				],
			},
		])
	})
})
