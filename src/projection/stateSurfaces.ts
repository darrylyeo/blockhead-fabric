import type {
	KnownTokenContract,
	StateSurfaceRow,
} from './types.js'

const surfaceDefinitions = [
	{
		surfaceId: 'activity_32',
		surfaceKind: 'gauge',
		unit: null,
		visualChannel: 'emissiveIntensity',
	},
	{
		surfaceId: 'incoming_value_32',
		surfaceKind: 'gauge',
		unit: 'wei',
		visualChannel: 'height',
	},
	{
		surfaceId: 'outgoing_value_32',
		surfaceKind: 'gauge',
		unit: 'wei',
		visualChannel: 'width',
	},
	{
		surfaceId: 'event_count_32',
		surfaceKind: 'gauge',
		unit: null,
		visualChannel: 'particleDensity',
	},
] as const

export const materializeContractStateSurfaces = (args: {
	contracts: KnownTokenContract[]
	headBlockNumber: bigint
}) => (
	args.contracts.flatMap((contract) => (
		surfaceDefinitions.map((definition): StateSurfaceRow => ({
			entityId: contract.entityId,
			surfaceId: definition.surfaceId,
			surfaceKind: definition.surfaceKind,
			valueJson: (
				definition.surfaceId === 'activity_32' ?
					contract.activity32
				: definition.surfaceId === 'incoming_value_32' ?
					contract.incomingValue32
				: definition.surfaceId === 'outgoing_value_32' ?
					contract.outgoingValue32
				:
					contract.eventCount32
			),
			unit: definition.unit,
			visualChannel: definition.visualChannel,
			updatedAtBlock: args.headBlockNumber,
		}))
	))
)

export const surfaceMetadata = (contract: KnownTokenContract) => ({
	stateSurfaces: surfaceDefinitions.map(({ surfaceId }) => (
		surfaceId
	)),
	surfaceValues: {
		activity_32: contract.activity32,
		incoming_value_32: contract.incomingValue32,
		outgoing_value_32: contract.outgoingValue32,
		event_count_32: contract.eventCount32,
	},
})
