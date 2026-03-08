/**
 * Isolated test: connect to RPC_WSS_URL and call eth_chainId + eth_blockNumber.
 * No DB, no ingest. Verifies the provider URL works from our stack.
 * Usage: RPC_WSS_URL=wss://... tsx scripts/_test-rpc-wss.ts
 */
import 'dotenv/config'

import { createWsProvider } from '../src/provider/createWsProvider.js'

const url = process.env.RPC_WSS_URL ?? process.exit(1)

const provider = createWsProvider({
	url,
	requestTimeoutMs: 15000,
	reconnectBackoffMinMs: 1000,
	reconnectBackoffMaxMs: 5000,
})

async function main() {
	try {
		const [chainId, blockNumber] = await Promise.all([
			provider.request({ method: 'eth_chainId' }),
			provider.request({ method: 'eth_blockNumber' }),
		])
		console.log('OK', { chainId, blockNumber })
	} catch (error) {
		console.error('FAIL', error instanceof Error ? error.message : error)
		process.exit(1)
	} finally {
		await provider.close()
	}
}

main()
