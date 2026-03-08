import { Hex } from '@tevm/voltaire/Hex'

export const hex = (value: string | Uint8Array) => (
	typeof value === 'string' ?
		value.toLowerCase()
	:
		Hex.fromBytes(value).toLowerCase()
)

export const decimal = (value: bigint | number | undefined | null) => (
	value === undefined || value === null ?
		null
	:
		value.toString()
)

export const timestampFromSeconds = (value: bigint) => (
	new Date(Number(value) * 1000)
)
