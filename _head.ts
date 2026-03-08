import { createWsProvider } from './src/provider/createWsProvider.js'

const rpcWssUrl = process.env.RPC_WSS_URL

if (!rpcWssUrl) {
	throw new Error('RPC_WSS_URL is required')
}

const provider = createWsProvider({
	url: rpcWssUrl,
	requestTimeoutMs: Number(process.env.RPC_REQUEST_TIMEOUT_MS ?? '30000'),
	reconnectBackoffMinMs: Number(process.env.RECONNECT_BACKOFF_MIN_MS ?? '1000'),
	reconnectBackoffMaxMs: Number(process.env.RECONNECT_BACKOFF_MAX_MS ?? '30000'),
})

try {
	const head = await provider.request({
		method: 'eth_blockNumber',
	})

	if (typeof head !== 'string') {
		throw new Error(`Unexpected eth_blockNumber result: ${String(head)}`)
	}

	console.log(`head=${BigInt(head).toString()}`)

	if (process.env.TEST_RECEIPTS === '1') {
		const receipts = await provider.request({
			method: 'eth_getBlockReceipts',
			params: [
				head,
			],
		})

		console.log(`receipts=${Array.isArray(receipts) ? receipts.length : typeof receipts}`)
	}
} finally {
	await provider.close()
}
