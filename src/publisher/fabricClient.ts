import { createHash } from 'node:crypto'
import { io } from 'socket.io-client'

import type {
	ConnectRootResult,
	CreateObjectArgs,
	FabricClient,
	FabricObject,
	MoveObjectArgs,
	UpdateObjectArgs,
} from './types.js'

type FetchImpl = typeof fetch
type IoImpl = typeof io

type FabricDescriptor = {
	sConnect: string
	wClass: number
	twObjectIx: bigint
}

type RemoteRef = {
	objectId: string
	classId: number
	objectIx: bigint
	parentClassId: number | null
	parentObjectIx: bigint | null
}

type CachedObject = {
	ref: RemoteRef
	object: FabricObject
}

type UpdateResponseEntry = {
	pObjectHead?: {
		twParentIx?: number | string
		twObjectIx?: number | string
		wClass_Parent?: number
		wClass_Object?: number
	}
	pName?: Record<string, unknown>
	pType?: {
		bType?: number
		bSubtype?: number
	}
	pResource?: {
		sName?: string | null
		sReference?: string | null
	}
	pTransform?: {
		Position?: unknown[]
		Rotation?: unknown[]
		Scale?: unknown[]
	}
	pBound?: {
		Max?: unknown[]
	}
}

type UpdateResponse = {
	nResult?: number
	Parent?: UpdateResponseEntry
	aChild?: unknown[]
}

const objectIxFields = {
	70: 'twRMRootIx',
	71: 'twRMCObjectIx',
	72: 'twRMTObjectIx',
	73: 'twRMPObjectIx',
} as const

const classNames = {
	70: 'RMRoot',
	71: 'RMCObject',
	72: 'RMTObject',
	73: 'RMPObject',
} as const

const nameFields = {
	70: 'Name_wsRMRootId',
	71: 'Name_wsRMCObjectId',
	72: 'Name_wsRMTObjectId',
	73: 'Name_wsRMPObjectId',
} as const

const NAME_MAX_LENGTH = 48

const nameForFabric = (objectId: string) => (
	objectId.length <= NAME_MAX_LENGTH ?
		objectId
	:
		'h:' + createHash('sha256').update(objectId).digest('hex').slice(0, 45)
)

const truncateObjectName = (s: string) => (
	s.length > NAME_MAX_LENGTH ?
		s.slice(0, NAME_MAX_LENGTH)
	:
		s
)

const createActions = {
	'70:71': 'RMRoot:rmcobject_open',
	'70:72': 'RMRoot:rmtobject_open',
	'70:73': 'RMRoot:rmpobject_open',
	'71:71': 'RMCObject:rmcobject_open',
	'71:72': 'RMCObject:rmtobject_open',
	'72:72': 'RMTObject:rmtobject_open',
	'72:73': 'RMTObject:rmpobject_open',
	'73:73': 'RMPObject:rmpobject_open',
} as const

const deleteActions = {
	'70:71': 'RMRoot:rmcobject_close',
	'70:72': 'RMRoot:rmtobject_close',
	'70:73': 'RMRoot:rmpobject_close',
	'71:71': 'RMCObject:rmcobject_close',
	'71:72': 'RMCObject:rmtobject_close',
	'72:72': 'RMTObject:rmtobject_close',
	'72:73': 'RMTObject:rmpobject_close',
	'73:73': 'RMPObject:rmpobject_close',
} as const

const withTimeout = async <Value>(timeoutMs: number | undefined, run: (signal: AbortSignal) => Promise<Value>) => {
	const controller = new AbortController()
	const timeout = timeoutMs === undefined ?
		undefined
	: setTimeout(() => {
		controller.abort(new Error(`Timed out after ${timeoutMs}ms`))
	}, timeoutMs)

	try {
		return await run(controller.signal)
	} finally {
		if (timeout !== undefined) {
			clearTimeout(timeout)
		}
	}
}

const getObjectIxField = (classId: number) => {
	const field = objectIxFields[classId as keyof typeof objectIxFields]

	if (!field) {
		throw new Error(`Unsupported Fabric class: ${classId}`)
	}

	return field
}

const getClassName = (classId: number) => {
	const name = classNames[classId as keyof typeof classNames]

	if (!name) {
		throw new Error(`Unsupported Fabric class: ${classId}`)
	}

	return name
}

const getNameField = (classId: number) => {
	const field = nameFields[classId as keyof typeof nameFields]

	if (!field) {
		throw new Error(`Unsupported Fabric class: ${classId}`)
	}

	return field
}

const parseBigInt = (value: unknown, field: string) => {
	if (typeof value === 'bigint') {
		return value
	}

	if (typeof value === 'number' || typeof value === 'string') {
		return BigInt(value)
	}

	throw new Error(`Invalid bigint field: ${field}`)
}

const parseNumber = (value: unknown, fallback: number) => (
	typeof value === 'number' ?
		value
	: typeof value === 'string' ?
		Number(value)
	:
		fallback
)

const parseObject = (value: unknown, field: string) => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`Invalid object field: ${field}`)
	}

	return value
}

const parseRootDescriptor = (value: unknown): FabricDescriptor => {
	const body = parseObject(value, 'descriptor')
	const map = 'map' in body ?
		parseObject(body.map, 'map')
	: body

	if (!('sConnect' in map) || typeof map.sConnect !== 'string') {
		throw new Error('Fabric root descriptor missing sConnect')
	}

	if (!('wClass' in map) || typeof map.wClass !== 'number') {
		throw new Error('Fabric root descriptor missing wClass')
	}

	if (!('twObjectIx' in map) || (typeof map.twObjectIx !== 'number' && typeof map.twObjectIx !== 'string')) {
		throw new Error('Fabric root descriptor missing twObjectIx')
	}

	return {
		sConnect: map.sConnect,
		wClass: map.wClass,
		twObjectIx: parseBigInt(map.twObjectIx, 'twObjectIx'),
	}
}

const parseConnectSpec = (value: string) => (
	Object.fromEntries(
		value
			.split(';')
			.map((part) => (
				part.split('=')
			))
			.filter(([key]) => (
				key
			)),
	)
)

const getSocketUrl = (descriptor: FabricDescriptor) => {
	const connect = parseConnectSpec(descriptor.sConnect)
	const server = typeof connect.server === 'string' ?
		connect.server
	: null
	const port = typeof connect.port === 'string' ?
		connect.port
	: null

	if (!server || !port) {
		throw new Error('Fabric root descriptor has invalid sConnect')
	}

	return `${connect.secure === 'true' ? 'wss' : 'ws'}://${server}:${port}`
}

const createRemoteKey = (classId: number, objectIx: bigint) => (
	`${classId}:${objectIx.toString()}`
)

const parseRemoteRefFromObjectId = (objectId: string): RemoteRef | null => {
	const match = objectId.match(/^(\d+):(\d+)$/)

	return !match ?
		null
	: {
			objectId,
			classId: Number(match[1]),
			objectIx: BigInt(match[2]),
			parentClassId: null,
			parentObjectIx: null,
		}
}

const getNameFromEntry = (classId: number, entry: UpdateResponseEntry) => {
	if (!entry.pName || typeof entry.pName !== 'object') {
		return null
	}

	return classId === 70 ?
		typeof entry.pName.wsRMRootId === 'string' ?
			entry.pName.wsRMRootId
		:
			null
	: classId === 71 ?
		typeof entry.pName.wsRMCObjectId === 'string' ?
			entry.pName.wsRMCObjectId
		:
			null
	: classId === 72 ?
		typeof entry.pName.wsRMTObjectId === 'string' ?
			entry.pName.wsRMTObjectId
		:
			null
	: classId === 73 ?
		typeof entry.pName.wsRMPObjectId === 'string' ?
			entry.pName.wsRMPObjectId
		:
			null
	:
		null
}

const getVectorValue = (values: unknown[] | undefined, index: number, fallback: number) => (
	values && index < values.length ?
		parseNumber(values[index], fallback)
	:
		fallback
)

const getTransform = (entry: UpdateResponseEntry) => ({
	position: {
		x: getVectorValue(entry.pTransform?.Position, 0, 0),
		y: getVectorValue(entry.pTransform?.Position, 1, 0),
		z: getVectorValue(entry.pTransform?.Position, 2, 0),
	},
	rotation: {
		x: getVectorValue(entry.pTransform?.Rotation, 0, 0),
		y: getVectorValue(entry.pTransform?.Rotation, 1, 0),
		z: getVectorValue(entry.pTransform?.Rotation, 2, 0),
		w: getVectorValue(entry.pTransform?.Rotation, 3, 1),
	},
	scale: {
		x: getVectorValue(entry.pTransform?.Scale, 0, 1),
		y: getVectorValue(entry.pTransform?.Scale, 1, 1),
		z: getVectorValue(entry.pTransform?.Scale, 2, 1),
	},
})

const getBounds = (entry: UpdateResponseEntry) => (
	entry.pBound?.Max ?
		{
			x: getVectorValue(entry.pBound.Max, 0, 0),
			y: getVectorValue(entry.pBound.Max, 1, 0),
			z: getVectorValue(entry.pBound.Max, 2, 0),
		}
	:
		null
)

const getCreateAction = (parentClassId: number, childClassId: number) => {
	const action = createActions[`${parentClassId}:${childClassId}` as keyof typeof createActions]

	if (!action) {
		throw new Error(`Unsupported Fabric create path: ${parentClassId} -> ${childClassId}`)
	}

	return action
}

const getDeleteAction = (parentClassId: number, childClassId: number) => {
	const action = deleteActions[`${parentClassId}:${childClassId}` as keyof typeof deleteActions]

	if (!action) {
		throw new Error(`Unsupported Fabric delete path: ${parentClassId} -> ${childClassId}`)
	}

	return action
}

const getNamePayload = (classId: number, objectId: string) => ({
	[getNameField(classId)]: nameForFabric(objectId),
})

const getTypePayload = (classId: number, type: number, subtype: number) => ({
	Type_bType: type,
	Type_bSubtype: subtype,
	Type_bFiction: 0,
	...(
		classId === 73 ?
			{
				Type_bMovable: 1,
			}
		:
			{}
	),
})

const getTransformSource = (value: Record<string, unknown> | undefined) => {
	const source = value ?? {}
	const position = 'position' in source && source.position && typeof source.position === 'object' ?
		source.position as Record<string, unknown>
	: source
	const rotation = 'rotation' in source && source.rotation && typeof source.rotation === 'object' ?
		source.rotation as Record<string, unknown>
	: source
	const scale = 'scale' in source && source.scale && typeof source.scale === 'object' ?
		source.scale as Record<string, unknown>
	: source

	return {
		position,
		rotation,
		scale,
	}
}

const getCoordinate = (source: Record<string, unknown>, keys: string[], fallback: number) => {
	for (const key of keys) {
		if (key in source) {
			return parseNumber(source[key], fallback)
		}
	}

	return fallback
}

const getTransformPayload = (value: Record<string, unknown> | undefined) => {
	const {
		position,
		rotation,
		scale,
	} = getTransformSource(value)

	return {
		Transform_Position_dX: getCoordinate(position, ['x', 'dX', '0'], 0),
		Transform_Position_dY: getCoordinate(position, ['y', 'dY', '1'], 0),
		Transform_Position_dZ: getCoordinate(position, ['z', 'dZ', '2'], 0),
		Transform_Rotation_dX: getCoordinate(rotation, ['x', 'dX', '0'], 0),
		Transform_Rotation_dY: getCoordinate(rotation, ['y', 'dY', '1'], 0),
		Transform_Rotation_dZ: getCoordinate(rotation, ['z', 'dZ', '2'], 0),
		Transform_Rotation_dW: getCoordinate(rotation, ['w', 'dW', '3'], 1),
		Transform_Scale_dX: getCoordinate(scale, ['x', 'dX', '0'], 1),
		Transform_Scale_dY: getCoordinate(scale, ['y', 'dY', '1'], 1),
		Transform_Scale_dZ: getCoordinate(scale, ['z', 'dZ', '2'], 1),
	}
}

const getBoundsPayload = (value: Record<string, unknown> | null | undefined) => {
	const source = value ?? {}

	return {
		Bound_dX: getCoordinate(source, ['x', 'dX', 'width', 'maxX'], 0),
		Bound_dY: getCoordinate(source, ['y', 'dY', 'height', 'maxY'], 0),
		Bound_dZ: getCoordinate(source, ['z', 'dZ', 'depth', 'maxZ'], 0),
	}
}

const getResourcePayload = (resourceName: string | null | undefined, resourceReference: string | null | undefined) => ({
	Resource_qwResource: 0,
	Resource_sName: resourceName ?? '',
	Resource_sReference: resourceReference ?? '',
})

const getCreatePayload = (args: CreateObjectArgs) => ({
	...getNamePayload(args.classId, args.objectId),
	...getTypePayload(args.classId, args.type, args.subtype),
	Owner_twRPersonaIx: 1,
	...getResourcePayload(args.resourceName, args.resourceReference),
	...getTransformPayload(args.transform),
	...getBoundsPayload(args.bounds),
	...(
		args.classId === 71 ?
			{
				Orbit_Spin_tmPeriod: 0,
				Orbit_Spin_tmStart: 0,
				Orbit_Spin_dA: 0,
				Orbit_Spin_dB: 0,
				Properties_fMass: 0,
				Properties_fGravity: 0,
				Properties_fColor: 0,
				Properties_fBrightness: 0,
				Properties_fReflectivity: 0,
			}
		: args.classId === 72 ?
			{
				Properties_bLockToGround: false,
				Properties_bYouth: false,
				Properties_bAdult: false,
				Properties_bAvatar: false,
				bCoord: false,
				dA: 0,
				dB: 0,
				dC: 0,
			}
		:
			{}
	),
})

const flattenChildEntries = (value: unknown): UpdateResponseEntry[] => (
	Array.isArray(value) ?
		value.flatMap((entry) => (
			flattenChildEntries(entry)
		))
	: value && typeof value === 'object' && 'pObjectHead' in value ?
		[
			value as UpdateResponseEntry,
		]
	:
		[]
)

const getResponseError = (response: unknown, action: string, context?: string) => {
	if (!response || typeof response !== 'object' || !('nResult' in response)) {
		throw new Error(
			context ?
				`Invalid Fabric response for ${action} (${context})`
			:
				`Invalid Fabric response for ${action}`,
		)
	}

	if (response.nResult !== 0) {
		const n = (response as { nResult?: number }).nResult
		const code = typeof n === 'number' ?
			` nResult=${n}`
		:
			''
		const hint = n === -2 ?
			' (Fabric often uses -2 for duplicate name or DB constraint; reset scope or check server/DB logs)'
		:
			''
		throw new Error(
			context ?
				`Fabric action failed: ${action} (${context})${code}${hint}`
			:
				`Fabric action failed: ${action}${code}${hint}`,
		)
	}

	return response
}

const getCreateResponseValue = (response: Record<string, unknown>, field: string) => {
	if (field in response) {
		return response[field]
	}

	const resultSets = response.aResultSet

	if (!Array.isArray(resultSets) || resultSets.length === 0) {
		return undefined
	}

	const firstSet = resultSets[0]

	if (!Array.isArray(firstSet) || firstSet.length === 0) {
		return undefined
	}

	const firstRow = firstSet[0]

	return firstRow && typeof firstRow === 'object' ?
		(firstRow as Record<string, unknown>)[field]
	:
		undefined
}

type BindingStore = {
	get(scopeId: string, objectId: string): Promise<{ classId: number, objectIx: bigint } | null>
	set(scopeId: string, objectId: string, ref: { classId: number, objectIx: bigint }, lastSeenRevision: bigint, fabricName?: string): Promise<void>
	getObjectIdByFabricName?(scopeId: string, fabricName: string): Promise<string | null>
	delete(scopeId: string, objectId: string): Promise<void>
}

export const createFabricClient = (deps: {
	fetchImpl?: FetchImpl
	ioImpl?: IoImpl
	bindingStore?: BindingStore
} = {}): FabricClient => {
	const fetchImpl = deps.fetchImpl ?? fetch
	const ioImpl = deps.ioImpl ?? io
	const bindingStore = deps.bindingStore
	const refsByObjectId = new Map<string, CachedObject>()
	const refsByRemoteKey = new Map<string, CachedObject>()
	let descriptor: FabricDescriptor | null = null
	let socket: ReturnType<IoImpl> | null = null
	let loginKey: string | undefined

	const clearCache = () => {
		refsByObjectId.clear()
		refsByRemoteKey.clear()
	}

	const registerObject = (object: FabricObject, ref: Omit<RemoteRef, 'objectId'> & {
		objectId?: string
	}) => {
		const key = createRemoteKey(ref.classId, ref.objectIx)
		const existing = refsByRemoteKey.get(key)
		const objectId = existing?.ref.objectId ?? ref.objectId ?? object.objectId
		const cached = {
			ref: {
				objectId,
				classId: ref.classId,
				objectIx: ref.objectIx,
				parentClassId: ref.parentClassId,
				parentObjectIx: ref.parentObjectIx,
			},
			object: {
				...object,
				objectId,
			},
		} satisfies CachedObject

		refsByObjectId.set(objectId, cached)
		refsByRemoteKey.set(key, cached)

		return cached.object
	}

	const resolveRef = async (scopeId: string, objectId: string): Promise<RemoteRef> => {
		const cached = refsByObjectId.get(objectId) ?? refsByObjectId.get(truncateObjectName(objectId))

		if (cached) {
			return cached.ref
		}

		const binding = bindingStore ?
			await bindingStore.get(scopeId, objectId)
		:
			null

		if (binding) {
			const ref: RemoteRef = {
				objectId,
				classId: binding.classId,
				objectIx: binding.objectIx,
				parentClassId: null,
				parentObjectIx: null,
			}
			registerObject({
				objectId,
				parentObjectId: null,
				name: objectId,
				classId: binding.classId,
				type: 0,
				subtype: 0,
				resourceReference: null,
				resourceName: null,
				transform: {},
				bounds: null,
			}, ref)
			return ref
		}

		const parsed = parseRemoteRefFromObjectId(objectId)

		if (!parsed) {
			throw new Error(`Unresolved Fabric object identity: ${objectId}`)
		}

		registerObject({
			objectId,
			parentObjectId: null,
			name: objectId,
			classId: parsed.classId,
			type: 0,
			subtype: 0,
			resourceReference: null,
			resourceName: null,
			transform: {},
			bounds: null,
		}, parsed)

		return parsed
	}

	const parseEntry = (entry: UpdateResponseEntry) => {
		if (!entry.pObjectHead) {
			throw new Error('Invalid Fabric update response entry')
		}

		const classId = entry.pObjectHead.wClass_Object

		if (typeof classId !== 'number') {
			throw new Error('Fabric update response entry missing object class')
		}

		const objectIx = parseBigInt(entry.pObjectHead.twObjectIx, 'twObjectIx')
		const parentClassId = typeof entry.pObjectHead.wClass_Parent === 'number' && entry.pObjectHead.wClass_Parent > 0 ?
			entry.pObjectHead.wClass_Parent
		:
			null
		const parentObjectIx = entry.pObjectHead.twParentIx === undefined || parentClassId === null ?
			null
		: parseBigInt(entry.pObjectHead.twParentIx, 'twParentIx')
		const existing = refsByRemoteKey.get(createRemoteKey(classId, objectIx))
		const parentObjectId = parentClassId === null || parentObjectIx === null ?
			null
		: refsByRemoteKey.get(createRemoteKey(parentClassId, parentObjectIx))?.ref.objectId
			?? `${parentClassId}:${parentObjectIx.toString()}`
		const nameFromServer = getNameFromEntry(classId, entry) ?? `${classId}:${objectIx.toString()}`
		const object = {
			objectId: existing?.ref.objectId ?? nameFromServer,
			parentObjectId,
			name: nameFromServer,
			classId,
			type: entry.pType?.bType ?? 0,
			subtype: entry.pType?.bSubtype ?? 0,
			resourceReference: entry.pResource?.sReference ?? null,
			resourceName: entry.pResource?.sName ?? null,
			transform: getTransform(entry),
			bounds: getBounds(entry),
		} satisfies FabricObject

		return registerObject(object, {
			objectId: object.objectId,
			classId,
			objectIx,
			parentClassId,
			parentObjectIx,
		})
	}

	const parseEntryAsync = async (entry: UpdateResponseEntry, scopeId: string) => {
		if (!entry.pObjectHead) {
			throw new Error('Invalid Fabric update response entry')
		}

		const classId = entry.pObjectHead.wClass_Object

		if (typeof classId !== 'number') {
			throw new Error('Fabric update response entry missing object class')
		}

		const objectIx = parseBigInt(entry.pObjectHead.twObjectIx, 'twObjectIx')
		const parentClassId = typeof entry.pObjectHead.wClass_Parent === 'number' && entry.pObjectHead.wClass_Parent > 0 ?
			entry.pObjectHead.wClass_Parent
		:
			null
		const parentObjectIx = entry.pObjectHead.twParentIx === undefined || parentClassId === null ?
			null
		: parseBigInt(entry.pObjectHead.twParentIx, 'twParentIx')
		const existing = refsByRemoteKey.get(createRemoteKey(classId, objectIx))
		const parentObjectId = parentClassId === null || parentObjectIx === null ?
			null
		: refsByRemoteKey.get(createRemoteKey(parentClassId, parentObjectIx))?.ref.objectId
			?? `${parentClassId}:${parentObjectIx.toString()}`
		const nameFromServer = getNameFromEntry(classId, entry) ?? `${classId}:${objectIx.toString()}`
		const objectId = existing?.ref.objectId ?? (
			bindingStore?.getObjectIdByFabricName ?
				(await bindingStore.getObjectIdByFabricName(scopeId, nameFromServer)) ?? nameFromServer
			:
				nameFromServer
		)
		const object = {
			objectId,
			parentObjectId,
			name: nameFromServer,
			classId,
			type: entry.pType?.bType ?? 0,
			subtype: entry.pType?.bSubtype ?? 0,
			resourceReference: entry.pResource?.sReference ?? null,
			resourceName: entry.pResource?.sName ?? null,
			transform: getTransform(entry),
			bounds: getBounds(entry),
		} satisfies FabricObject

		return registerObject(object, {
			objectId: object.objectId,
			classId,
			objectIx,
			parentClassId,
			parentObjectIx,
		})
	}

	const ensureSocket = async (adminKey: string | undefined, timeoutMs: number | undefined) => {
		if (!descriptor) {
			throw new Error('Fabric client has not connected to a descriptor yet')
		}

		if (adminKey !== undefined) {
			loginKey = adminKey
		}

		if (socket && socket.connected) {
			return socket
		}

		socket?.close()
		clearCache()

		socket = ioImpl(getSocketUrl(descriptor), {
			autoConnect: false,
			reconnection: false,
			transports: [
				'websocket',
			],
		})

		socket.on('disconnect', () => {
			clearCache()
		})

		await new Promise<void>((resolve, reject) => {
			const onConnect = () => {
				socket?.off('connect_error', onError)
				resolve()
			}
			const onError = (error: unknown) => {
				socket?.off('connect', onConnect)
				reject(error)
			}

			socket?.once('connect', onConnect)
			socket?.once('connect_error', onError)
			socket?.connect()
		})

		if (loginKey) {
			getResponseError(
				await new Promise((resolve, reject) => {
					const timer = setTimeout(() => {
						reject(new Error('login timed out'))
					}, timeoutMs ?? 30000)
					socket?.emit('login', {
						acToken64U_RP1: loginKey,
					}, (response: unknown) => {
						clearTimeout(timer)
						resolve(response)
					})
				}),
				'login',
			)
		}

		return socket
	}

	const emitAction = async (action: string, payload: Record<string, unknown>, timeoutMs: number | undefined) => {
		const connectedSocket = await ensureSocket(undefined, timeoutMs)
		return getResponseError(
			await new Promise((resolve, reject) => {
				const timer = setTimeout(() => {
					reject(new Error(`operation has timed out for ${action}`))
				}, timeoutMs ?? 30000)
				connectedSocket.emit(action, payload, (response: unknown) => {
					clearTimeout(timer)
					resolve(response)
				})
			}),
			action,
		)
	}

	return {
		connectRoot: async ({
			fabricUrl,
			adminKey,
			timeoutMs,
		}) => {
			descriptor = await withTimeout(timeoutMs, async (signal) => {
				const response = await fetchImpl(fabricUrl, {
					method: 'GET',
					headers: {
						accept: 'application/json',
					},
					signal,
				})

				if (!response.ok) {
					throw new Error(`Failed to fetch Fabric root descriptor: ${response.status} ${response.statusText}`)
				}

				return parseRootDescriptor(await response.json())
			})

			await ensureSocket(adminKey, timeoutMs)

			registerObject({
				objectId: `${descriptor.wClass}:${descriptor.twObjectIx.toString()}`,
				parentObjectId: null,
				name: `${descriptor.wClass}:${descriptor.twObjectIx.toString()}`,
				classId: descriptor.wClass,
				type: 0,
				subtype: 0,
				resourceReference: null,
				resourceName: null,
				transform: {},
				bounds: null,
			}, {
				objectId: `${descriptor.wClass}:${descriptor.twObjectIx.toString()}`,
				classId: descriptor.wClass,
				objectIx: descriptor.twObjectIx,
				parentClassId: null,
				parentObjectIx: null,
			})

			return {
				scopeId: 'root',
				rootObjectId: `${descriptor.wClass}:${descriptor.twObjectIx.toString()}`,
			} satisfies ConnectRootResult
		},
		listObjects: async ({
			scopeId,
			anchorObjectId,
		}) => {
			const ref = await resolveRef(scopeId, anchorObjectId)
			const action = `${getClassName(ref.classId)}:update`
			const response = await emitAction(action, {
				[getObjectIxField(ref.classId)]: ref.objectIx.toString(),
			}, undefined) as UpdateResponse
			const parent = response.Parent ?
				await parseEntryAsync(response.Parent, scopeId)
			:
				null

			if (parent) {
				registerObject(parent, {
					objectId: parent.objectId,
					classId: ref.classId,
					objectIx: ref.objectIx,
					parentClassId: ref.parentClassId,
					parentObjectIx: ref.parentObjectIx,
				})
			}

			return Promise.all(
				flattenChildEntries(response.aChild ?? []).map((entry) => parseEntryAsync(entry, scopeId)),
			)
		},
		getObject: async ({
			scopeId,
			objectId,
		}) => {
			const ref = await resolveRef(scopeId, objectId)
			const action = `${getClassName(ref.classId)}:update`
			const response = await emitAction(action, {
				[getObjectIxField(ref.classId)]: ref.objectIx.toString(),
			}, undefined) as UpdateResponse

			return response.Parent ?
				await parseEntryAsync(response.Parent, scopeId)
			:
				null
		},
		createObject: async (args) => {
			const parent = await resolveRef(args.scopeId, args.parentId)
			const action = getCreateAction(parent.classId, args.classId)
			const context = `objectId=${args.objectId} parentId=${args.parentId}`
			const fabricName = nameForFabric(args.objectId)
			const emitCreate = async () => (
				new Promise((resolve, reject) => {
					const timer = setTimeout(() => {
						reject(new Error('operation has timed out'))
					}, 30000)
					void ensureSocket(undefined, undefined).then((connectedSocket) => {
						connectedSocket.emit(action, {
							[getObjectIxField(parent.classId)]: parent.objectIx.toString(),
							...getCreatePayload(args),
						}, (response: unknown) => {
							clearTimeout(timer)
							resolve(response)
						})
					}).catch((error) => {
						clearTimeout(timer)
						reject(error)
					})
				})
			)
			let response: unknown

			try {
				response = await emitCreate()
				const first = response as { nResult?: number } | null
				if (first && typeof first === 'object' && first.nResult === -2) {
					await new Promise((r) => { setTimeout(r, 300) })
					response = await emitCreate()
				}
			} catch (err) {
				throw err instanceof Error ?
					new Error(`${err.message} (${context})`)
				:
					new Error(`${String(err)} (${context})`)
			}

			const res = response as { nResult?: number } & Record<string, unknown>
			const tryRecoverCreatedChild = async (candidate: UpdateResponse) => {
				const children = await Promise.all(
					flattenChildEntries(candidate.aChild ?? []).map((entry) => (
						parseEntryAsync(entry, args.scopeId)
					)),
				)
				const match = children.find((c) => (c.name === fabricName || c.objectId === fabricName))
				if (!match) {
					return null
				}
				const cached = refsByObjectId.get(match.objectId) ?? refsByObjectId.get(match.name)
				if (!cached) {
					return null
				}
				const ref = {
					objectId: args.objectId,
					classId: cached.ref.classId,
					objectIx: cached.ref.objectIx,
					parentClassId: parent.classId,
					parentObjectIx: parent.objectIx,
				}
				if (bindingStore && args.desiredRevision !== undefined) {
					await bindingStore.set(args.scopeId, args.objectId, ref, args.desiredRevision, fabricName)
				}
				return registerObject({
					objectId: args.objectId,
					parentObjectId: args.parentId,
					name: args.name,
					classId: args.classId,
					type: args.type,
					subtype: args.subtype,
					resourceReference: args.resourceReference ?? null,
					resourceName: args.resourceName ?? null,
					transform: args.transform ?? {},
					bounds: args.bounds ?? null,
				}, ref)
			}
			if (res.nResult === -2) {
				const parentUpdateAction = `${getClassName(parent.classId)}:update`
				const parentUpdateResponse = await emitAction(parentUpdateAction, {
					[getObjectIxField(parent.classId)]: parent.objectIx.toString(),
				}, undefined) as UpdateResponse
				const recovered = await tryRecoverCreatedChild(parentUpdateResponse)
				if (recovered) {
					return recovered
				}
			}

			getResponseError(response, action, context)
			if (res.Parent || res.aChild) {
				const recovered = await tryRecoverCreatedChild(res as UpdateResponse)
				if (recovered) {
					return recovered
				}
			}
			const objectIxField = getObjectIxField(args.classId)
			const objectIx = parseBigInt(getCreateResponseValue(res, objectIxField), objectIxField)
			const ref = {
				objectId: args.objectId,
				classId: args.classId,
				objectIx,
				parentClassId: parent.classId,
				parentObjectIx: parent.objectIx,
			}

			if (bindingStore && args.desiredRevision !== undefined) {
				await bindingStore.set(args.scopeId, args.objectId, ref, args.desiredRevision, fabricName)
			}

			return registerObject({
				objectId: args.objectId,
				parentObjectId: args.parentId,
				name: args.name,
				classId: args.classId,
				type: args.type,
				subtype: args.subtype,
				resourceReference: args.resourceReference ?? null,
				resourceName: args.resourceName ?? null,
				transform: args.transform ?? {},
				bounds: args.bounds ?? null,
			}, ref)
		},
		updateObject: async (args) => {
			const ref = await resolveRef(args.scopeId, args.objectId)

			if (ref.classId !== args.classId) {
				throw new Error(`Fabric class mismatch for ${args.objectId}`)
			}

			await emitAction(`${getClassName(ref.classId)}:name`, {
				[getObjectIxField(ref.classId)]: ref.objectIx.toString(),
				...getNamePayload(ref.classId, args.objectId),
			}, undefined)
			await emitAction(`${getClassName(ref.classId)}:type`, {
				[getObjectIxField(ref.classId)]: ref.objectIx.toString(),
				...getTypePayload(ref.classId, args.type, args.subtype),
			}, undefined)
			await emitAction(`${getClassName(ref.classId)}:transform`, {
				[getObjectIxField(ref.classId)]: ref.objectIx.toString(),
				...getTransformPayload(args.transform),
			}, undefined)
			await emitAction(`${getClassName(ref.classId)}:bound`, {
				[getObjectIxField(ref.classId)]: ref.objectIx.toString(),
				...getBoundsPayload(args.bounds),
			}, undefined)
			await emitAction(`${getClassName(ref.classId)}:resource`, {
				[getObjectIxField(ref.classId)]: ref.objectIx.toString(),
				...getResourcePayload(args.resourceName, args.resourceReference),
			}, undefined)

			if (bindingStore && args.desiredRevision !== undefined) {
				await bindingStore.set(args.scopeId, args.objectId, ref, args.desiredRevision)
			}

			return registerObject({
				objectId: args.objectId,
				parentObjectId: args.parentId,
				name: args.name,
				classId: args.classId,
				type: args.type,
				subtype: args.subtype,
				resourceReference: args.resourceReference ?? null,
				resourceName: args.resourceName ?? null,
				transform: args.transform ?? {},
				bounds: args.bounds ?? null,
			}, ref)
		},
		moveObject: async (args) => {
			const ref = await resolveRef(args.scopeId, args.objectId)

			if (ref.classId !== 73) {
				throw new Error(`Fabric in-place moves only support class 73: ${args.objectId}`)
			}

			const parent = await resolveRef(args.scopeId, args.parentId)

			await emitAction('RMPObject:parent', {
				twRMPObjectIx: ref.objectIx.toString(),
				wClass: parent.classId,
				twObjectIx: parent.objectIx.toString(),
			}, undefined)

			return registerObject({
				...(refsByObjectId.get(args.objectId)?.object ?? {
					objectId: args.objectId,
					name: args.objectId,
					classId: ref.classId,
					type: 0,
					subtype: 0,
					resourceReference: null,
					resourceName: null,
					transform: {},
					bounds: null,
				}),
				parentObjectId: args.parentId,
			}, {
				...ref,
				parentClassId: parent.classId,
				parentObjectIx: parent.objectIx,
			})
		},
		deleteObject: async ({
			scopeId,
			objectId,
		}) => {
			const ref = await resolveRef(scopeId, objectId)

			if (ref.parentClassId === null || ref.parentObjectIx === null) {
				throw new Error(`Fabric object has no deletable parent: ${objectId}`)
			}

			await emitAction(getDeleteAction(ref.parentClassId, ref.classId), {
				[getObjectIxField(ref.parentClassId)]: ref.parentObjectIx.toString(),
				[`${getObjectIxField(ref.classId)}_Close`]: ref.objectIx.toString(),
				bDeleteAll: false,
			}, undefined)

			if (bindingStore) {
				await bindingStore.delete(scopeId, objectId)
			}

			refsByObjectId.delete(ref.objectId)
			refsByRemoteKey.delete(createRemoteKey(ref.classId, ref.objectIx))
		},
	}
}

export const __private__ = {
	parseRootDescriptor,
	parseConnectSpec,
}
