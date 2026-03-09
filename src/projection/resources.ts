const resource = (name: string) => ({
	resourceName: name,
	resourceReference: `action://objects/${name}`,
})

const toNumber = (value: number | string | bigint) => (
	typeof value === 'number' ?
		value
	: typeof value === 'bigint' ?
		Number(value)
	:
		Number(value)
)

export const clamp = (value: number, min: number, max: number) => (
	Math.max(min, Math.min(max, value))
)

export const magnitudeScale = (value: number | string | bigint, min: number, max: number, divisor: number) => (
	clamp(
		Math.log10(Math.max(1, toNumber(value)) + 1) / divisor,
		min,
		max,
	)
)

export const blockResource = (finalityState: string) => (
	finalityState === 'finalized' ?
		resource('blockhead-finalized.gltf')
	: finalityState === 'safe' ?
		resource('blockhead-safe.gltf')
	:
		resource('blockhead-latest.gltf')
)

export const districtResource = () => (
	resource('blockhead-district.gltf')
)

export const accountResource = () => (
	resource('blockhead-account.gltf')
)

export const contractResource = (familyLabel: string | null | undefined) => (
	familyLabel?.toLowerCase() === 'erc20' ?
		resource('blockhead-token.gltf')
	: familyLabel?.toLowerCase() === 'erc721' || familyLabel?.toLowerCase() === 'erc1155' ?
		resource('blockhead-collection.gltf')
	: familyLabel?.toLowerCase() === 'amm_pool' || familyLabel?.toLowerCase() === 'amm-pool' || familyLabel?.toLowerCase().includes('amm') ?
		resource('blockhead-pool.gltf')
	:
		resource('blockhead-contract.gltf')
)

export const txResource = () => (
	resource('blockhead-tx.gltf')
)

export const eventResource = (eventFamily: string) => (
	eventFamily === 'erc20_transfer' ?
		resource('blockhead-event-erc20.gltf')
	: eventFamily === 'erc721_transfer' ?
		resource('blockhead-event-erc721.gltf')
	:
		resource('blockhead-event-erc1155.gltf')
)

export const corridorResource = (flowClass: string) => (
	flowClass === 'native_transfer' ?
		resource('blockhead-beam-native.gltf')
	: flowClass === 'erc20_transfer' ?
		resource('blockhead-beam-erc20.gltf')
	:
		resource('blockhead-beam-call.gltf')
)

export const stateSurfaceResource = (surfaceId: string) => (
	surfaceId === 'activity_32' || surfaceId === 'swap_intensity_32' ?
		resource('blockhead-state-activity.gltf')
	: surfaceId === 'incoming_value_32' || surfaceId === 'mint_activity_32' || surfaceId === 'reserve0' ?
		resource('blockhead-state-in.gltf')
	: surfaceId === 'outgoing_value_32' || surfaceId === 'transfer_activity_32' || surfaceId === 'reserve1' ?
		resource('blockhead-state-out.gltf')
	:
		resource('blockhead-state-events.gltf')
)

export const blockVisualScale = (args: {
	txCount: number
	logCount: number
	gasUsed: string
}) => ({
	x: clamp(7 + (args.logCount >= 2000 ? 12 : args.logCount >= 1000 ? 9 : args.logCount >= 250 ? 6 : 3), 8, 22),
	y: clamp(4 + Math.log2(args.txCount + 1) * 1.1 + magnitudeScale(args.gasUsed, 0, 3.5, 2), 4, 14),
	z: clamp(6 + (args.txCount <= 24 ? 2 : args.txCount <= 99 ? 5 : args.txCount <= 249 ? 8 : args.txCount <= 499 ? 11 : 14), 8, 20),
})

export const yawRotation = (radians: number) => ({
	x: 0,
	y: Math.sin(radians / 2),
	z: 0,
	w: Math.cos(radians / 2),
})
