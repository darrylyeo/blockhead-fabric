import { describe, expect, it, vi } from 'vitest'

import { probeCapabilities } from './probeCapabilities.js'
import { createConfig, createMockProvider } from '../test/factories.js'

describe('probeCapabilities', () => {
	it('records supported capabilities from the provider', async () => {
		const request = vi.fn(async ({ method }: { method: string }) => {
			switch (method) {
				case 'eth_chainId':
					return '0x1'
				case 'eth_blockNumber':
					return '0x2a'
				case 'eth_getBlockByNumber':
					return {
						hash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
						number: '0x2a',
					}
				case 'eth_getBlockReceipts':
				case 'eth_getLogs':
				case 'eth_getBalance':
				case 'eth_getCode':
					return []
				default:
					throw new Error(`unexpected method ${method}`)
			}
		})

		const capabilities = await probeCapabilities({
			config: createConfig(),
			provider: createMockProvider(request),
		})

		expect(capabilities.chainId).toBe(1n)
		expect(capabilities.supportsBlockReceipts).toBe(true)
		expect(capabilities.supportsBlockHashLogs).toBe(true)
		expect(capabilities.supportsSafeTag).toBe(true)
		expect(capabilities.supportsFinalizedTag).toBe(true)
		expect(capabilities.rawJson.latestBlockHash).toBe('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
	})

	it('fails fast on chain mismatch', async () => {
		const provider = createMockProvider(async ({ method }) => (
			method === 'eth_chainId' ?
				'0x2'
			: method === 'eth_blockNumber' ?
				'0x2a'
			:
				{
					hash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
					number: '0x2a',
				}
		))

		await expect(probeCapabilities({
			config: createConfig(),
			provider,
		})).rejects.toThrow('Expected chain 1 but provider reported 2')
	})

	it('marks optional RPC features unsupported when they fail', async () => {
		const provider = createMockProvider(async ({ method, params }) => {
			switch (method) {
				case 'eth_chainId':
					return '0x1'
				case 'eth_blockNumber':
					return '0x2a'
				case 'eth_getBlockByNumber':
					if (Array.isArray(params) && params[0] === 'latest') {
						return {
							hash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
							number: '0x2a',
						}
					}

					throw new Error(`${String(Array.isArray(params) ? params[0] : undefined)} unsupported`)
				case 'eth_getBlockReceipts':
				case 'eth_getLogs':
					throw new Error(`${method} unsupported`)
				case 'eth_getBalance':
				case 'eth_getCode':
					return '0x0'
				default:
					throw new Error(`unexpected method ${method}`)
			}
		})

		const capabilities = await probeCapabilities({
			config: createConfig(),
			provider,
		})

		expect(capabilities.supportsBlockReceipts).toBe(false)
		expect(capabilities.supportsBlockHashLogs).toBe(false)
		expect(capabilities.supportsSafeTag).toBe(false)
		expect(capabilities.supportsFinalizedTag).toBe(false)
	})
})
