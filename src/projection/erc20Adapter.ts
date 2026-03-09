import type {
	AdapterEntityRow,
	AdapterEventRow,
	AdapterHintRow,
	AdapterSurfaceRow,
	KnownCollectionContract,
	KnownAmmPoolContract,
	KnownMultiTokenContract,
	KnownTokenContract,
	ProjectedFabricObject,
	ProjectedFabricState,
	ProjectionConfig,
} from './types.js'
import { materializeAmmPoolLandmarks } from './ammAdapter.js'
import {
	clamp,
	contractResource,
	districtResource,
	magnitudeScale,
	stateSurfaceResource,
} from './resources.js'
import { surfaceMetadata } from './stateSurfaces.js'

const transferTopic0 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const zeroAddressTopic = '0x0000000000000000000000000000000000000000000000000000000000000000'
const erc1155TransferSingleTopic0 = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62'
const erc1155TransferBatchTopic0 = '0x4a39dc06d4c0dbc64b70e4cce6d6a4c41fbd64fd4281c3f1f9a6b20f7c2a2b9b'

const knownTokens = {
	'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': {
		symbol: 'USDC',
		resourceName: 'erc20-token',
	},
	'0xdac17f958d2ee523a2206206994597c13d831ec7': {
		symbol: 'USDT',
		resourceName: 'erc20-token',
	},
	'0x6b175474e89094c44da98b954eedeac495271d0f': {
		symbol: 'DAI',
		resourceName: 'erc20-token',
	},
	'0xc02aa39b223fe8d0a0e5c4f27ead9083c756cc2': {
		symbol: 'WETH',
		resourceName: 'erc20-token',
	},
} as const

type KnownTokenAddress = keyof typeof knownTokens

type TransferLog = {
	blockNumber: bigint
	blockHash: string
	txHash: string
	logIndex: number
	address: string
	topic1: string | null
	topic2: string | null
	data: string
}

type Erc721TransferLog = {
	blockNumber: bigint
	blockHash: string
	txHash: string
	logIndex: number
	address: string
	topic1: string | null
	topic2: string | null
	topic3: string | null
}

type Erc1155TransferLog = {
	blockNumber: bigint
	blockHash: string
	txHash: string
	logIndex: number
	address: string
	topic0: string
}

const toAddressFromTopic = (topic: string | null) => (
	!topic || topic.length < 42 ?
		null
	:
		`0x${topic.slice(-40).toLowerCase()}`
)

const formatEntityAddress = (address: string) => (
	address.toLowerCase()
)

const shortLabel = (address: string) => (
	`${address.slice(0, 8)}...${address.slice(-4)}`
)

const knownTokenInfo = (address: string) => (
	knownTokens[formatEntityAddress(address) as KnownTokenAddress] ?? null
)

const isKnownToken = (address: string) => (
	knownTokenInfo(address) !== null
)

export const materializeKnownErc20Adapter = (args: {
	config: ProjectionConfig
	headBlockNumber: bigint
	contracts: {
		address: string
	}[]
	transferLogs: TransferLog[]
}) => {
	const knownAddresses = new Set(
		[
			...args.contracts.map(({ address }) => (
				formatEntityAddress(address)
			)),
			...args.transferLogs.map(({ address }) => (
				formatEntityAddress(address)
			)),
		].filter(isKnownToken),
	)
	const adapterEntities: AdapterEntityRow[] = []
	const adapterEvents: AdapterEventRow[] = []
	const adapterHints: AdapterHintRow[] = []
	const adapterSurfaces: AdapterSurfaceRow[] = []
	const transferVelocityByAddress = args.transferLogs.reduce<Map<string, number>>((current, log) => {
		if (
			!isKnownToken(log.address)
			|| log.blockNumber < (args.headBlockNumber > 31n ? args.headBlockNumber - 31n : 0n)
		) {
			return current
		}

		const address = formatEntityAddress(log.address)

		current.set(address, (current.get(address) ?? 0) + 1)

		return current
	}, new Map())

	for (const address of Array.from(knownAddresses).sort()) {
		const token = knownTokenInfo(address)

		if (!token) {
			continue
		}

		adapterEntities.push({
			chainId: args.config.chainId,
			address,
			adapterId: 'erc20',
			adapterVersion: 1,
			protocolId: `erc20:${address}`,
			family: 'erc20',
			confidence: 'exact',
			styleFamily: 'token',
			metadataJson: {
				protocolLabel: token.symbol,
				familyLabel: 'erc20',
				tokenClass: token.symbol.toLowerCase(),
			},
			detectedAtBlock: args.headBlockNumber,
			updatedAtBlock: args.headBlockNumber,
		})
		adapterHints.push({
			chainId: args.config.chainId,
			address,
			adapterId: 'erc20',
			hintType: 'object_style',
			payloadJson: {
				preferredEntrypoint: 'protocol-landmarks',
				preferredResourceName: token.resourceName,
				preferredLabel: token.symbol,
			},
			updatedAtBlock: args.headBlockNumber,
		})
		adapterSurfaces.push({
			chainId: args.config.chainId,
			address,
			adapterId: 'erc20',
			surfaceId: 'transfer_velocity_32',
			surfaceKind: 'gauge',
			valueJson: transferVelocityByAddress.get(address) ?? 0,
			unit: null,
			visualChannel: 'particleDensity',
			sourceMode: 'on_log',
			updatedAtBlock: args.headBlockNumber,
		})
	}

	for (const log of args.transferLogs.filter(({ address }) => (
		isKnownToken(address)
	))) {
		const token = knownTokenInfo(log.address)

		if (!token) {
			continue
		}

		adapterEvents.push({
			chainId: args.config.chainId,
			adapterId: 'erc20',
			txHash: log.txHash,
			blockHash: log.blockHash,
			logIndex: log.logIndex,
			targetAddress: formatEntityAddress(log.address),
			eventFamily: 'transfer',
			payloadJson: {
				from: toAddressFromTopic(log.topic1),
				to: toAddressFromTopic(log.topic2),
				value: log.data,
				tokenClass: token.symbol.toLowerCase(),
				protocolLabel: token.symbol,
				blockNumber: log.blockNumber.toString(),
				topic0: transferTopic0,
			},
			canonical: true,
		})
	}

	return {
		adapterEntities,
		adapterEvents,
		adapterHints,
		adapterSurfaces,
	}
}

export const materializeErc721Adapter = (args: {
	config: ProjectionConfig
	headBlockNumber: bigint
	transferLogs: Erc721TransferLog[]
}) => {
	const knownAddresses = new Set(
		args.transferLogs.map(({ address }) => (
			formatEntityAddress(address)
		)),
	)
	const adapterEntities: AdapterEntityRow[] = []
	const adapterEvents: AdapterEventRow[] = []
	const adapterHints: AdapterHintRow[] = []
	const adapterSurfaces: AdapterSurfaceRow[] = []
	const recentTransferCounts = new Map<string, number>()
	const recentMintCounts = new Map<string, number>()
	const recentFloor = args.headBlockNumber > 31n ?
		args.headBlockNumber - 31n
	:
		0n

	for (const log of args.transferLogs) {
		if (log.blockNumber < recentFloor) {
			continue
		}

		const address = formatEntityAddress(log.address)

		recentTransferCounts.set(address, (recentTransferCounts.get(address) ?? 0) + 1)

		if (log.topic1 === zeroAddressTopic) {
			recentMintCounts.set(address, (recentMintCounts.get(address) ?? 0) + 1)
		}
	}

	for (const address of Array.from(knownAddresses).sort()) {
		adapterEntities.push({
			chainId: args.config.chainId,
			address,
			adapterId: 'erc721',
			adapterVersion: 1,
			protocolId: `erc721:${address}`,
			family: 'erc721',
			confidence: 'high',
			styleFamily: 'collection',
			metadataJson: {
				familyLabel: 'erc721',
			},
			detectedAtBlock: args.headBlockNumber,
			updatedAtBlock: args.headBlockNumber,
		})
		adapterHints.push({
			chainId: args.config.chainId,
			address,
			adapterId: 'erc721',
			hintType: 'object_style',
			payloadJson: {
				preferredEntrypoint: 'protocol-landmarks',
				preferredResourceName: 'erc721-collection',
				preferredLabel: shortLabel(address),
			},
			updatedAtBlock: args.headBlockNumber,
		})
		adapterSurfaces.push({
			chainId: args.config.chainId,
			address,
			adapterId: 'erc721',
			surfaceId: 'mint_activity_32',
			surfaceKind: 'gauge',
			valueJson: recentMintCounts.get(address) ?? 0,
			unit: null,
			visualChannel: 'emissiveIntensity',
			sourceMode: 'on_log',
			updatedAtBlock: args.headBlockNumber,
		})
		adapterSurfaces.push({
			chainId: args.config.chainId,
			address,
			adapterId: 'erc721',
			surfaceId: 'transfer_activity_32',
			surfaceKind: 'gauge',
			valueJson: recentTransferCounts.get(address) ?? 0,
			unit: null,
			visualChannel: 'particleDensity',
			sourceMode: 'on_log',
			updatedAtBlock: args.headBlockNumber,
		})
	}

	for (const log of args.transferLogs) {
		const address = formatEntityAddress(log.address)

		adapterEvents.push({
			chainId: args.config.chainId,
			adapterId: 'erc721',
			txHash: log.txHash,
			blockHash: log.blockHash,
			logIndex: log.logIndex,
			targetAddress: address,
			eventFamily: 'transfer',
			payloadJson: {
				from: toAddressFromTopic(log.topic1),
				to: toAddressFromTopic(log.topic2),
				tokenId: log.topic3,
				blockNumber: log.blockNumber.toString(),
				topic0: transferTopic0,
			},
			canonical: true,
		})
	}

	return {
		adapterEntities,
		adapterEvents,
		adapterHints,
		adapterSurfaces,
	}
}

export const materializeErc1155Adapter = (args: {
	config: ProjectionConfig
	headBlockNumber: bigint
	transferLogs: Erc1155TransferLog[]
}) => {
	const knownAddresses = new Set(
		args.transferLogs.map(({ address }) => (
			formatEntityAddress(address)
		)),
	)
	const adapterEntities: AdapterEntityRow[] = []
	const adapterEvents: AdapterEventRow[] = []
	const adapterHints: AdapterHintRow[] = []
	const adapterSurfaces: AdapterSurfaceRow[] = []
	const recentTransferCounts = new Map<string, number>()
	const recentBatchCounts = new Map<string, number>()
	const recentFloor = args.headBlockNumber > 31n ?
		args.headBlockNumber - 31n
	:
		0n

	for (const log of args.transferLogs) {
		if (log.blockNumber < recentFloor) {
			continue
		}

		const address = formatEntityAddress(log.address)

		recentTransferCounts.set(address, (recentTransferCounts.get(address) ?? 0) + 1)

		if (log.topic0 === erc1155TransferBatchTopic0) {
			recentBatchCounts.set(address, (recentBatchCounts.get(address) ?? 0) + 1)
		}
	}

	for (const address of Array.from(knownAddresses).sort()) {
		adapterEntities.push({
			chainId: args.config.chainId,
			address,
			adapterId: 'erc1155',
			adapterVersion: 1,
			protocolId: `erc1155:${address}`,
			family: 'erc1155',
			confidence: 'high',
			styleFamily: 'multi-token-collection',
			metadataJson: {
				familyLabel: 'erc1155',
			},
			detectedAtBlock: args.headBlockNumber,
			updatedAtBlock: args.headBlockNumber,
		})
		adapterHints.push({
			chainId: args.config.chainId,
			address,
			adapterId: 'erc1155',
			hintType: 'object_style',
			payloadJson: {
				preferredEntrypoint: 'protocol-landmarks',
				preferredResourceName: 'erc1155-collection',
				preferredLabel: shortLabel(address),
			},
			updatedAtBlock: args.headBlockNumber,
		})
		adapterSurfaces.push({
			chainId: args.config.chainId,
			address,
			adapterId: 'erc1155',
			surfaceId: 'batch_activity_32',
			surfaceKind: 'gauge',
			valueJson: recentBatchCounts.get(address) ?? 0,
			unit: null,
			visualChannel: 'emissiveIntensity',
			sourceMode: 'on_log',
			updatedAtBlock: args.headBlockNumber,
		})
		adapterSurfaces.push({
			chainId: args.config.chainId,
			address,
			adapterId: 'erc1155',
			surfaceId: 'transfer_activity_32',
			surfaceKind: 'gauge',
			valueJson: recentTransferCounts.get(address) ?? 0,
			unit: null,
			visualChannel: 'particleDensity',
			sourceMode: 'on_log',
			updatedAtBlock: args.headBlockNumber,
		})
	}

	for (const log of args.transferLogs) {
		const address = formatEntityAddress(log.address)

		adapterEvents.push({
			chainId: args.config.chainId,
			adapterId: 'erc1155',
			txHash: log.txHash,
			blockHash: log.blockHash,
			logIndex: log.logIndex,
			targetAddress: address,
			eventFamily: log.topic0 === erc1155TransferBatchTopic0 ? 'transfer_batch' : 'transfer_single',
			payloadJson: {
				blockNumber: log.blockNumber.toString(),
				topic0: log.topic0,
			},
			canonical: true,
		})
	}

	return {
		adapterEntities,
		adapterEvents,
		adapterHints,
		adapterSurfaces,
	}
}

type LandmarkContract = {
	entityId: string
	protocolLabel: string
	familyLabel: string
	districtId: string | null
	activity32: number
	eventCount32: number
	incomingValue32?: string
	outgoingValue32?: string
	mintActivity32?: number
	transferActivity32?: number
	batchActivity32?: number
	swapIntensity32?: number
	reserve0?: string
	reserve1?: string
	extraMetadata: Record<string, unknown>
}

const landmarkScale = (contract: LandmarkContract) => ({
	x: contract.familyLabel === 'amm_pool' ? 14 : contract.familyLabel === 'erc20' ? 12 : 10,
	y: clamp(
		10
		+ (Math.log2(contract.activity32 + contract.eventCount32 + 2) * 2)
		+ magnitudeScale(contract.swapIntensity32 ?? contract.transferActivity32 ?? contract.incomingValue32 ?? '0', 0, 6, 4),
		10,
		24,
	),
	z: contract.familyLabel === 'amm_pool' ? 14 : 10,
})

const landmarkTransform = (contract: LandmarkContract, index: number) => {
	const scale = landmarkScale(contract)

	return {
		position: {
			x: ((index % 4) - 1.5) * 42,
			y: 4 + (scale.y / 2),
			z: Math.floor(index / 4) * 42,
		},
		rotation: {
			x: 0,
			y: 0,
			z: 0,
			w: 1,
		},
		scale,
	}
}

const stateMetricSpecs = (contract: LandmarkContract) => (
	[
		{
			surfaceId: 'activity_32',
			name: 'Activity 32',
			value: contract.activity32,
			x: -14,
			z: -8,
		},
		{
			surfaceId: 'event_count_32',
			name: 'Event Count 32',
			value: contract.eventCount32,
			x: 14,
			z: -8,
		},
		...(
			contract.familyLabel === 'erc20' ?
				[
					{
						surfaceId: 'incoming_value_32',
						name: 'Incoming Value 32',
						value: contract.incomingValue32 ?? '0',
						x: -14,
						z: 10,
					},
					{
						surfaceId: 'outgoing_value_32',
						name: 'Outgoing Value 32',
						value: contract.outgoingValue32 ?? '0',
						x: 14,
						z: 10,
					},
				]
			: contract.familyLabel === 'erc721' ?
				[
					{
						surfaceId: 'mint_activity_32',
						name: 'Mint Activity 32',
						value: contract.mintActivity32 ?? 0,
						x: -14,
						z: 10,
					},
					{
						surfaceId: 'transfer_activity_32',
						name: 'Transfer Activity 32',
						value: contract.transferActivity32 ?? 0,
						x: 14,
						z: 10,
					},
				]
			: contract.familyLabel === 'erc1155' ?
				[
					{
						surfaceId: 'batch_activity_32',
						name: 'Batch Activity 32',
						value: contract.batchActivity32 ?? 0,
						x: -14,
						z: 10,
					},
					{
						surfaceId: 'transfer_activity_32',
						name: 'Transfer Activity 32',
						value: contract.transferActivity32 ?? 0,
						x: 14,
						z: 10,
					},
				]
			:
				[
					{
						surfaceId: 'reserve0',
						name: 'Reserve 0',
						value: contract.reserve0 ?? '0',
						x: -14,
						z: 10,
					},
					{
						surfaceId: 'reserve1',
						name: 'Reserve 1',
						value: contract.reserve1 ?? '0',
						x: 14,
						z: 10,
					},
				]
		),
	]
)

const stateMetricObjects = (args: {
	scopeId: string
	entrypointId: string
	chainId: bigint
	desiredRevision: bigint
	contract: LandmarkContract
}) => (
	stateMetricSpecs(args.contract).map((metric) => {
		const scale = {
			x: 3,
			y: clamp(2 + (magnitudeScale(metric.value, 0, 8, 3) * 4), 2, 10),
			z: 3,
		}

		return {
			scopeId: args.scopeId,
			objectId: `surface:${args.contract.entityId}:${metric.surfaceId}`,
			entrypointId: args.entrypointId,
			parentObjectId: args.contract.entityId,
			entityId: `surface:${args.contract.entityId}:${metric.surfaceId}`,
			classId: 73,
			type: 0,
			subtype: 0,
			name: metric.name,
			transformJson: {
				position: {
					x: metric.x,
					y: 1 + (scale.y / 2),
					z: metric.z,
				},
				rotation: {
					x: 0,
					y: 0,
					z: 0,
					w: 1,
				},
				scale,
			},
			boundJson: scale,
			...stateSurfaceResource(metric.surfaceId),
			metadataJson: {
				schemaVersion: 1,
				entityId: `surface:${args.contract.entityId}:${metric.surfaceId}`,
				entityKind: 'surface',
				chainId: Number(args.chainId),
				canonical: true,
				updatedAtBlock: args.desiredRevision.toString(),
				parentEntityId: args.contract.entityId,
				surfaceId: metric.surfaceId,
				value: metric.value,
			},
			deleted: false,
			desiredRevision: args.desiredRevision,
			updatedAtBlock: args.desiredRevision,
		} satisfies ProjectedFabricObject
	})
)

export const materializeProtocolLandmarks = (args: {
	config: ProjectionConfig
	headBlockNumber: bigint
	tokenContracts: KnownTokenContract[]
	collectionContracts: KnownCollectionContract[]
	multiTokenContracts: KnownMultiTokenContract[]
	ammPoolContracts: KnownAmmPoolContract[]
}) => {
	const scopeId = args.config.chainId === 1n ?
		'scope_eth_mainnet'
	:
		`scope_chain_${args.config.chainId.toString()}`
	const desiredRevision = args.headBlockNumber
	const entryObjectId = 'entry_protocol_landmarks'
	const families = [
		{
			containerId: 'container:protocol:erc20',
			containerName: 'ERC-20 Tokens',
			containerX: 0,
			familyLabel: 'erc20',
			contracts: [
				...args.tokenContracts,
			]
				.sort((left, right) => (
					right.activity32 - left.activity32
					|| right.eventCount32 - left.eventCount32
					|| left.protocolLabel.localeCompare(right.protocolLabel)
				))
				.map((contract) => ({
					...contract,
					extraMetadata: {
						...surfaceMetadata(contract),
						adapterSurfaces: [
							'transfer_velocity_32',
							'total_supply',
						],
						adapterSurfaceValues: {
							transfer_velocity_32: contract.transferVelocity32,
							total_supply: contract.totalSupply,
						},
						activity32: contract.activity32,
						incomingValue32: contract.incomingValue32,
						outgoingValue32: contract.outgoingValue32,
						eventCount32: contract.eventCount32,
						transferVelocity32: contract.transferVelocity32,
						totalSupply: contract.totalSupply,
					},
				})),
		},
		{
			containerId: 'container:protocol:erc721',
			containerName: 'ERC-721 Collections',
			containerX: 196,
			familyLabel: 'erc721',
			contracts: [
				...args.collectionContracts,
			]
				.sort((left, right) => (
					right.transferActivity32 - left.transferActivity32
					|| right.mintActivity32 - left.mintActivity32
					|| left.protocolLabel.localeCompare(right.protocolLabel)
				))
				.map((contract) => ({
					...contract,
					extraMetadata: {
						adapterSurfaces: [
							'mint_activity_32',
							'transfer_activity_32',
						],
						adapterSurfaceValues: {
							mint_activity_32: contract.mintActivity32,
							transfer_activity_32: contract.transferActivity32,
						},
						activity32: contract.activity32,
						eventCount32: contract.eventCount32,
						mintActivity32: contract.mintActivity32,
						transferActivity32: contract.transferActivity32,
					},
				})),
		},
		{
			containerId: 'container:protocol:erc1155',
			containerName: 'ERC-1155 Collections',
			containerX: 392,
			familyLabel: 'erc1155',
			contracts: [
				...args.multiTokenContracts,
			]
				.sort((left, right) => (
					right.transferActivity32 - left.transferActivity32
					|| right.batchActivity32 - left.batchActivity32
					|| left.protocolLabel.localeCompare(right.protocolLabel)
				))
				.map((contract) => ({
					...contract,
					extraMetadata: {
						adapterSurfaces: [
							'batch_activity_32',
							'transfer_activity_32',
						],
						adapterSurfaceValues: {
							batch_activity_32: contract.batchActivity32,
							transfer_activity_32: contract.transferActivity32,
						},
						activity32: contract.activity32,
						eventCount32: contract.eventCount32,
						batchActivity32: contract.batchActivity32,
						transferActivity32: contract.transferActivity32,
					},
				})),
		},
		materializeAmmPoolLandmarks({
			config: args.config,
			headBlockNumber: args.headBlockNumber,
			contracts: args.ammPoolContracts,
		}),
	].filter(({ contracts }) => (
		contracts.length > 0
	))
	const objects: ProjectedFabricObject[] = [
		{
			scopeId,
			objectId: entryObjectId,
			entrypointId: 'entry_protocol_landmarks',
			parentObjectId: 'root',
			entityId: `entry:protocol-landmarks:${args.config.chainId.toString()}`,
			classId: 73,
			type: 0,
			subtype: 0,
			name: 'Protocol Landmarks',
			transformJson: {
				position: {
					x: 0,
					y: 1,
					z: 0,
				},
				rotation: {
					x: 0,
					y: 0,
					z: 0,
					w: 1,
				},
				scale: {
					x: 168,
					y: 2,
					z: 148,
				},
			},
			boundJson: {
				x: 168,
				y: 6,
				z: 148,
			},
			...districtResource(),
			metadataJson: {
				schemaVersion: 1,
				entityId: `entry:protocol-landmarks:${args.config.chainId.toString()}`,
				entityKind: 'entrypoint',
				chainId: Number(args.config.chainId),
				canonical: true,
				updatedAtBlock: desiredRevision.toString(),
			},
			deleted: false,
			desiredRevision,
			updatedAtBlock: desiredRevision,
		},
		...families.flatMap((family) => (
			[
				{
					scopeId,
					objectId: family.containerId,
					entrypointId: 'entry_protocol_landmarks',
					parentObjectId: entryObjectId,
					entityId: `${family.containerId}:${args.config.chainId.toString()}`,
					classId: 73,
					type: 0,
					subtype: 0,
					name: family.containerName,
					transformJson: {
						position: {
							x: family.containerX,
							y: 1,
							z: Math.max(52, Math.ceil(family.contracts.length / 4) * 22),
						},
						rotation: {
							x: 0,
							y: 0,
							z: 0,
							w: 1,
						},
						scale: {
							x: 140,
							y: 2,
							z: Math.max(92, (Math.ceil(family.contracts.length / 4) * 44) + 32),
						},
					},
					boundJson: {
						x: 140,
						y: 16,
						z: Math.max(92, (Math.ceil(family.contracts.length / 4) * 44) + 32),
					},
					...districtResource(),
					metadataJson: {
						schemaVersion: 1,
						entityId: `${family.containerId}:${args.config.chainId.toString()}`,
						entityKind: 'container',
						chainId: Number(args.config.chainId),
						canonical: true,
						updatedAtBlock: desiredRevision.toString(),
						familyLabel: family.familyLabel,
					},
					deleted: false,
					desiredRevision,
					updatedAtBlock: desiredRevision,
				} satisfies ProjectedFabricObject,
				...family.contracts.flatMap((contract, index) => {
					const transformJson = landmarkTransform(contract, index)

					return [
						{
							scopeId,
							objectId: contract.entityId,
							entrypointId: 'entry_protocol_landmarks',
							parentObjectId: family.containerId,
							entityId: contract.entityId,
							classId: 73,
							type: 0,
							subtype: 0,
							name: contract.protocolLabel,
							transformJson,
							boundJson: transformJson.scale,
							...contractResource(contract.familyLabel),
							metadataJson: {
								schemaVersion: 1,
								entityId: contract.entityId,
								entityKind: 'contract',
								chainId: Number(args.config.chainId),
								canonical: true,
								updatedAtBlock: desiredRevision.toString(),
								protocolLabel: contract.protocolLabel,
								familyLabel: contract.familyLabel,
								landmarkRank: index,
								districtId: contract.districtId,
								...contract.extraMetadata,
							},
							deleted: false,
							desiredRevision,
							updatedAtBlock: desiredRevision,
						} satisfies ProjectedFabricObject,
						...stateMetricObjects({
							scopeId,
							entrypointId: 'entry_protocol_landmarks',
							chainId: args.config.chainId,
							desiredRevision,
							contract,
						}),
					]
				}),
			]
		)),
	]

	return {
		scope: {
			scopeId,
			chainId: args.config.chainId,
			name: args.config.chainId === 1n ? 'Ethereum Mainnet' : `Chain ${args.config.chainId.toString()}`,
			entryMsfPath: '/fabric/',
			desiredRevision,
			status: 'active',
		},
		entrypoints: [
			{
				scopeId,
				entrypointId: 'entry_protocol_landmarks',
				name: 'Protocol Landmarks',
				rootObjectId: entryObjectId,
				desiredRevision,
			},
		],
		objects,
	} satisfies ProjectedFabricState
}

export const __private__ = {
	transferTopic0,
	zeroAddressTopic,
	erc1155TransferSingleTopic0,
	erc1155TransferBatchTopic0,
	knownTokens,
}
