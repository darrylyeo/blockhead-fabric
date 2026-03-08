import { Keccak256 } from '@tevm/voltaire/Keccak256'
import { Hex } from '@tevm/voltaire/Hex'

import { hex } from '../shared/encoding.js'
import type { Eip1193Provider } from '../shared/types.js'

const toBlockTag = (blockNumber: bigint) => (
	`0x${blockNumber.toString(16)}`
)

const normalizeCode = (value: unknown) => (
	typeof value === 'string' ?
		value.toLowerCase()
	:
		'0x'
)

const hasBytecode = (code: string) => (
	code !== '0x' && code !== '0x0' && Hex.toBytes(code).length > 0
)

export const fetchCodeAtBlock = async ({
	provider,
	address,
	blockNumber,
}: {
	provider: Eip1193Provider
	address: string
	blockNumber: bigint
}) => (
	normalizeCode(await provider.request({
		method: 'eth_getCode',
		params: [
			address,
			toBlockTag(blockNumber),
		],
	}))
)

export const describeBytecode = (code: string) => (
	hasBytecode(code) ?
		{
			isContract: true,
			codeHash: hex(Keccak256.fromHex(code)),
			bytecodeSize: Hex.toBytes(code).length,
		}
	:
		{
			isContract: false,
			codeHash: null,
			bytecodeSize: null,
		}
)
