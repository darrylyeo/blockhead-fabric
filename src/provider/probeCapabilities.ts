import type { Eip1193Provider, IngestConfig, RpcCapabilities } from '../shared/types.js'

const request = async <T>(provider: Eip1193Provider, method: string, params: unknown[] = []) => (
	(await provider.request({
		method,
		params,
	})) as T
)

const supports = async (fn: () => Promise<unknown>) => {
	try {
		await fn()
		return true
	} catch {
		return false
	}
}

export const probeCapabilities = async ({
	config,
	provider,
}: {
	config: IngestConfig
	provider: Eip1193Provider
}): Promise<RpcCapabilities> => {
	const chainIdHex = await request<string>(provider, 'eth_chainId')
	const blockNumberHex = await request<string>(provider, 'eth_blockNumber')
	const latestBlock = await request<{ hash: string }>(provider, 'eth_getBlockByNumber', ['latest', false])
	const latestBalanceTarget = '0x0000000000000000000000000000000000000000'
	const supportsBlockReceipts = await supports(() => (
		request(provider, 'eth_getBlockReceipts', [blockNumberHex])
	))
	const supportsBlockHashLogs = await supports(() => (
		request(provider, 'eth_getLogs', [
			{
				blockHash: latestBlock.hash,
			},
		])
	))
	const supportsSafeTag = await supports(() => (
		request(provider, 'eth_getBlockByNumber', ['safe', false])
	))
	const supportsFinalizedTag = await supports(() => (
		request(provider, 'eth_getBlockByNumber', ['finalized', false])
	))

	await request(provider, 'eth_getBalance', [latestBalanceTarget, 'latest'])
	await request(provider, 'eth_getCode', [latestBalanceTarget, 'latest'])

	const chainId = BigInt(chainIdHex)

	if (chainId !== config.chainId) {
		throw new Error(`Expected chain ${config.chainId} but provider reported ${chainId}`)
	}

	return {
		endpointId: config.rpcWssUrl,
		chainId,
		supportsBlockReceipts,
		supportsBlockHashLogs,
		supportsSafeTag,
		supportsFinalizedTag,
		checkedAt: new Date(),
		rawJson: {
			chainIdHex,
			blockNumberHex,
			latestBlockHash: latestBlock.hash,
			supportsBlockReceipts,
			supportsBlockHashLogs,
			supportsSafeTag,
			supportsFinalizedTag,
		},
	}
}
