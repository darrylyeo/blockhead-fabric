import { afterEach, describe, expect, it, vi } from 'vitest'

import { getRpcHttpUrl, loadLocalLassoConfig, raceUpstreamRequests } from './localLasso.js'

const originalEnv = {
	...process.env,
}

afterEach(() => {
	process.env = {
		...originalEnv,
	}
	vi.unstubAllGlobals()
})

describe('getRpcHttpUrl', () => {
	it('derives matching HTTP URLs from websocket endpoints', () => {
		expect(getRpcHttpUrl('wss://mainnet.infura.io/ws/v3/test-key')).toBe('https://mainnet.infura.io/v3/test-key')
		expect(getRpcHttpUrl('ws://127.0.0.1:8545')).toBe('http://127.0.0.1:8545')
	})
})

describe('loadLocalLassoConfig', () => {
	it('loads upstream URLs from env', () => {
		process.env.LASSO_UPSTREAM_WSS_URLS = 'wss://rpc-a.example,wss://rpc-b.example'
		process.env.LASSO_BIND_HOST = '0.0.0.0'
		process.env.LASSO_PORT = '9545'
		process.env.RPC_REQUEST_TIMEOUT_MS = '1234'

		expect(loadLocalLassoConfig()).toEqual({
			bindHost: '0.0.0.0',
			port: 9545,
			requestTimeoutMs: 1234,
			upstreamWssUrls: [
				'wss://rpc-a.example',
				'wss://rpc-b.example',
			],
			upstreamHttpUrls: [
				'https://rpc-a.example',
				'https://rpc-b.example',
			],
		})
	})

	it('throws when upstreams are missing', () => {
		delete process.env.LASSO_UPSTREAM_WSS_URLS

		expect(() => (
			loadLocalLassoConfig()
		)).toThrow('Missing required environment variable: LASSO_UPSTREAM_WSS_URLS')
	})
})

describe('raceUpstreamRequests', () => {
	it('returns the fastest successful upstream result', async () => {
		vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input)
			const delayMs = url.includes('fast') ? 5 : 25

			await new Promise((resolve) => {
				setTimeout(resolve, delayMs)
			})

			return new Response(JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				result: url,
			}), {
				status: 200,
				headers: {
					'content-type': 'application/json',
				},
			})
		}))

		await expect(raceUpstreamRequests({
			upstreamHttpUrls: [
				'https://slow.example',
				'https://fast.example',
			],
			method: 'eth_blockNumber',
			params: [],
			timeoutMs: 1000,
		})).resolves.toMatchObject({
			upstreamHttpUrl: 'https://fast.example',
			result: 'https://fast.example',
		})
	})

	it('fails when every upstream fails', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => {
			throw new Error('boom')
		}))

		await expect(raceUpstreamRequests({
			upstreamHttpUrls: [
				'https://rpc-a.example',
				'https://rpc-b.example',
			],
			method: 'eth_getCode',
			params: [
				'0x0',
				'latest',
			],
			timeoutMs: 1000,
		})).rejects.toThrow('All upstream RPC requests failed for eth_getCode: boom | boom')
	})

	it('rejects write methods', async () => {
		await expect(raceUpstreamRequests({
			upstreamHttpUrls: [
				'https://rpc-a.example',
			],
			method: 'eth_sendRawTransaction',
			params: [
				'0xdeadbeef',
			],
			timeoutMs: 1000,
		})).rejects.toThrow('Method not supported by local lasso proxy: eth_sendRawTransaction')
	})
})
