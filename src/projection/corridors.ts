import { clamp, corridorResource, yawRotation } from './resources.js'

import type {
	CorridorRow,
	DistrictAtlasEntity,
	DistrictMembershipRow,
	DistrictRow,
	ProjectedFabricObject,
	ProjectionConfig,
} from './types.js'

const windows = [
	8,
	32,
	128,
] as const

type NativeTransferInput = {
	txHash: string
	blockNumber: bigint
	fromAddress: string
	toAddress: string
	valueWei: string
}

type ContractCallInput = {
	txHash: string
	blockNumber: bigint
	fromAddress: string
	toAddress: string
}

type Erc20TransferInput = {
	txHash: string
	blockNumber: bigint
	fromAddress: string
	toAddress: string
	tokenClass: string
}

type AddressInfo = {
	address: string
	isContract: boolean
	districtId: string
}

type Aggregate = {
	sourceDistrictId: string
	targetDistrictId: string
	flowClass: string
	tokenClass: string
	windowSize: number
	eventCount: number
	txHashes: Set<string>
	totalValueWei: bigint
	tokenTransferCount: number
	lastSeenBlock: bigint
}

const normalizeAddress = (address: string) => (
	address.toLowerCase()
)

const addressFromEntityId = (entityId: string) => (
	entityId.split(':').slice(2).join(':').toLowerCase()
)

const yByFlowClass = (flowClass: string) => (
	flowClass === 'native_transfer' ?
		2
	: flowClass === 'erc20_transfer' ?
		4
	:
		6
)

const corridorKey = (args: {
	sourceDistrictId: string
	targetDistrictId: string
	flowClass: string
	tokenClass: string
	windowSize: number
}) => (
	`${args.sourceDistrictId}|${args.targetDistrictId}|${args.flowClass}|${args.tokenClass}|${args.windowSize}`
)

const corridorObjectId = (chainId: bigint, corridor: CorridorRow) => (
	`corridor:${chainId.toString()}:${corridor.sourceDistrictId}:${corridor.targetDistrictId}:${corridor.flowClass}:${corridor.tokenClass}:${corridor.windowSize}`
)

const name = (corridor: CorridorRow) => (
	`${corridor.tokenClass.toUpperCase()} Flow ${corridor.sourceDistrictId} -> ${corridor.targetDistrictId}`
)

const transform = (args: {
	source: DistrictRow
	target: DistrictRow
	flowClass: string
	eventCount: number
}) => ({
	position: {
		x: (args.target.originX - args.source.originX) / 2,
		y: 18 + yByFlowClass(args.flowClass),
		z: (args.target.originZ - args.source.originZ) / 2,
	},
	rotation: yawRotation(Math.atan2(
		args.target.originX - args.source.originX,
		args.target.originZ - args.source.originZ,
	)),
	scale: {
		x: clamp(2 + (args.eventCount / 6), 2, 10),
		y: args.flowClass === 'contract_call' ? 2.4 : 1.6,
		z: Math.max(16, Math.hypot(
			args.target.originX - args.source.originX,
			args.target.originZ - args.source.originZ,
		)),
	},
})

const bounds = (args: {
	source: DistrictRow
	target: DistrictRow
	eventCount: number
}) => {
	const distance = Math.hypot(
		args.target.originX - args.source.originX,
		args.target.originZ - args.source.originZ,
	)

	return {
		x: Math.max(8, Math.round(distance)),
		y: Math.max(2, Math.min(16, args.eventCount)),
		z: 6,
	}
}

const buildAddressIndex = (args: {
	entities: DistrictAtlasEntity[]
	memberships: DistrictMembershipRow[]
}) => {
	const entitiesByAddress = new Map(
		args.entities.map((entity) => (
			[
				normalizeAddress(entity.address),
				entity,
			]
		)),
	)

	return new Map(
		args.memberships.flatMap((membership) => {
			const address = addressFromEntityId(membership.entityId)
			const entity = entitiesByAddress.get(address)

			return entity ?
				[
					[
						address,
						{
							address,
							isContract: entity.isContract,
							districtId: membership.districtId,
						} satisfies AddressInfo,
					] as const,
				]
			:
				[]
		}),
	)
}

const addAggregate = (args: {
	aggregates: Map<string, Aggregate>
	headBlockNumber: bigint
	sourceDistrictId: string
	targetDistrictId: string
	flowClass: string
	tokenClass: string
	txHash: string
	blockNumber: bigint
	valueWei?: string
}) => {
	for (const windowSize of windows) {
		if (args.blockNumber < args.headBlockNumber - BigInt(windowSize - 1)) {
			continue
		}

		const key = corridorKey({
			sourceDistrictId: args.sourceDistrictId,
			targetDistrictId: args.targetDistrictId,
			flowClass: args.flowClass,
			tokenClass: args.tokenClass,
			windowSize,
		})
		const aggregate = args.aggregates.get(key) ?? {
			sourceDistrictId: args.sourceDistrictId,
			targetDistrictId: args.targetDistrictId,
			flowClass: args.flowClass,
			tokenClass: args.tokenClass,
			windowSize,
			eventCount: 0,
			txHashes: new Set<string>(),
			totalValueWei: 0n,
			tokenTransferCount: 0,
			lastSeenBlock: args.blockNumber,
		}

		aggregate.eventCount += 1
		aggregate.txHashes.add(args.txHash)
		aggregate.lastSeenBlock = aggregate.lastSeenBlock > args.blockNumber ? aggregate.lastSeenBlock : args.blockNumber
		aggregate.totalValueWei += BigInt(args.valueWei ?? '0')
		aggregate.tokenTransferCount += args.flowClass === 'erc20_transfer' ? 1 : 0
		args.aggregates.set(key, aggregate)
	}
}

const publishedKeys = (corridors: CorridorRow[]) => {
	const published = new Set(
		corridors
			.filter((corridor) => (
				corridor.windowSize === 32
				&& corridor.eventCount >= 8
			))
			.map(({ corridorKey }) => (
				corridorKey
			)),
	)
	const rapid = corridors.filter((corridor) => (
		corridor.windowSize === 8
		&& corridor.distinctTxCount >= 4
	))

	for (const corridor of rapid) {
		published.add(corridor.corridorKey)
	}

	const window32 = corridors.filter(({ windowSize }) => (
		windowSize === 32
	))
	const districts = new Set(
		window32.flatMap(({ sourceDistrictId, targetDistrictId }) => (
			[
				sourceDistrictId,
				targetDistrictId,
			]
		)),
	)

	for (const districtId of districts) {
		for (const corridor of [
			...window32.filter(({ sourceDistrictId }) => (
				sourceDistrictId === districtId
			)),
		].sort((left, right) => (
			right.eventCount - left.eventCount
			|| right.distinctTxCount - left.distinctTxCount
			|| left.corridorKey.localeCompare(right.corridorKey)
		)).slice(0, 20)) {
			published.add(corridor.corridorKey)
		}

		for (const corridor of [
			...window32.filter(({ targetDistrictId }) => (
				targetDistrictId === districtId
			)),
		].sort((left, right) => (
			right.eventCount - left.eventCount
			|| right.distinctTxCount - left.distinctTxCount
			|| left.corridorKey.localeCompare(right.corridorKey)
		)).slice(0, 20)) {
			published.add(corridor.corridorKey)
		}
	}

	return published
}

export const materializeCorridors = (args: {
	config: ProjectionConfig
	headBlockNumber: bigint
	entities: DistrictAtlasEntity[]
	memberships: DistrictMembershipRow[]
	districts: DistrictRow[]
	nativeTransfers: NativeTransferInput[]
	contractCalls: ContractCallInput[]
	erc20Transfers: Erc20TransferInput[]
}) => {
	const addressIndex = buildAddressIndex({
		entities: args.entities,
		memberships: args.memberships,
	})
	const districtsById = new Map(
		args.districts.map((district) => (
			[
				district.districtId,
				district,
			]
		)),
	)
	const aggregates = new Map<string, Aggregate>()

	for (const transfer of args.nativeTransfers) {
		const source = addressIndex.get(normalizeAddress(transfer.fromAddress))
		const target = addressIndex.get(normalizeAddress(transfer.toAddress))

		if (!source || !target) {
			continue
		}

		addAggregate({
			aggregates,
			headBlockNumber: args.headBlockNumber,
			sourceDistrictId: source.districtId,
			targetDistrictId: target.districtId,
			flowClass: 'native_transfer',
			tokenClass: 'eth',
			txHash: transfer.txHash,
			blockNumber: transfer.blockNumber,
			valueWei: transfer.valueWei,
		})
	}

	for (const call of args.contractCalls) {
		const source = addressIndex.get(normalizeAddress(call.fromAddress))
		const target = addressIndex.get(normalizeAddress(call.toAddress))

		if (!source || !target || !target.isContract) {
			continue
		}

		addAggregate({
			aggregates,
			headBlockNumber: args.headBlockNumber,
			sourceDistrictId: source.districtId,
			targetDistrictId: target.districtId,
			flowClass: 'contract_call',
			tokenClass: 'none',
			txHash: call.txHash,
			blockNumber: call.blockNumber,
		})
	}

	for (const transfer of args.erc20Transfers) {
		const source = addressIndex.get(normalizeAddress(transfer.fromAddress))
		const target = addressIndex.get(normalizeAddress(transfer.toAddress))

		if (!source || !target) {
			continue
		}

		addAggregate({
			aggregates,
			headBlockNumber: args.headBlockNumber,
			sourceDistrictId: source.districtId,
			targetDistrictId: target.districtId,
			flowClass: 'erc20_transfer',
			tokenClass: transfer.tokenClass || 'unknown-token',
			txHash: transfer.txHash,
			blockNumber: transfer.blockNumber,
		})
	}

	const rows = Array.from(aggregates.entries())
		.map(([key, aggregate]) => ({
			chainId: args.config.chainId,
			corridorKey: key,
			sourceDistrictId: aggregate.sourceDistrictId,
			targetDistrictId: aggregate.targetDistrictId,
			flowClass: aggregate.flowClass,
			tokenClass: aggregate.tokenClass,
			windowSize: aggregate.windowSize,
			eventCount: aggregate.eventCount,
			distinctTxCount: aggregate.txHashes.size,
			totalValueWei: aggregate.flowClass === 'native_transfer' ? aggregate.totalValueWei.toString() : null,
			tokenTransferCount: aggregate.flowClass === 'erc20_transfer' ? aggregate.tokenTransferCount : null,
			lastSeenBlock: aggregate.lastSeenBlock,
			published: false,
			corridorAlgorithmVersion: args.config.corridorAlgorithmVersion,
			updatedAtBlock: args.headBlockNumber,
		} satisfies CorridorRow))
		.sort((left, right) => (
			left.corridorKey.localeCompare(right.corridorKey)
		))
	const published = publishedKeys(rows)
	const corridorRows = rows.map((row) => ({
		...row,
		published: published.has(row.corridorKey),
	}))
	const scopeId = args.config.chainId === 1n ?
		'scope_eth_mainnet'
	:
		`scope_chain_${args.config.chainId.toString()}`
	const objects: ProjectedFabricObject[] = corridorRows
		.filter(({ published }) => (
			published
		))
		.flatMap((corridor) => {
			const source = districtsById.get(corridor.sourceDistrictId)
			const target = districtsById.get(corridor.targetDistrictId)

			return source && target ?
				[
					{
						scopeId,
						objectId: corridorObjectId(args.config.chainId, corridor),
						entrypointId: 'entry_district_atlas',
						parentObjectId: `district:${args.config.chainId.toString()}:${corridor.sourceDistrictId}`,
						entityId: corridorObjectId(args.config.chainId, corridor),
						classId: 73,
						type: 0,
						subtype: 0,
						name: name(corridor),
						transformJson: transform({
							source,
							target,
							flowClass: corridor.flowClass,
							eventCount: corridor.eventCount,
						}),
						boundJson: bounds({
							source,
							target,
							eventCount: corridor.eventCount,
						}),
						...corridorResource(corridor.flowClass),
						metadataJson: {
							schemaVersion: 1,
							entityId: corridorObjectId(args.config.chainId, corridor),
							entityKind: 'corridor',
							chainId: Number(args.config.chainId),
							canonical: true,
							updatedAtBlock: corridor.updatedAtBlock.toString(),
							sourceDistrictId: corridor.sourceDistrictId,
							targetDistrictId: corridor.targetDistrictId,
							flowClass: corridor.flowClass,
							tokenClass: corridor.tokenClass,
							window: corridor.windowSize,
							eventCount: corridor.eventCount,
							distinctTxCount: corridor.distinctTxCount,
							totalValueWei: corridor.totalValueWei,
							tokenTransferCount: corridor.tokenTransferCount,
						},
						deleted: false,
						desiredRevision: corridor.updatedAtBlock,
						updatedAtBlock: corridor.updatedAtBlock,
					} satisfies ProjectedFabricObject,
				]
			:
				[]
		})

	return {
		rows: corridorRows,
		objects,
	}
}
