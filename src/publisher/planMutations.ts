import type {
	DeleteMutation,
	FabricAttachmentRow,
	FabricObject,
	FabricObjectRow,
	MutationPlan,
	ObjectMutation,
	RemoteScopeState,
	ScopeSnapshot,
} from './types.js'

const sortByDepth = (objects: FabricObjectRow[]) => {
	const byId = new Map(
		objects.map((object) => (
			[
				object.objectId,
				object,
			]
		)),
	)
	const memo = new Map<string, number>()

	const getDepth = (objectId: string): number => {
		const existing = memo.get(objectId)

		if (existing !== undefined) {
			return existing
		}

		const object = byId.get(objectId)

		if (!object || !byId.has(object.parentObjectId)) {
			memo.set(objectId, 0)
			return 0
		}

		const depth = getDepth(object.parentObjectId) + 1
		memo.set(objectId, depth)
		return depth
	}

	return [
		...objects,
	].sort((left, right) => (
		getDepth(left.objectId) - getDepth(right.objectId) || left.objectId.localeCompare(right.objectId)
	))
}

const sortDeletesByDepth = (objects: FabricObject[]) => {
	const byId = new Map(
		objects.map((object) => (
			[
				object.objectId,
				object,
			]
		)),
	)
	const memo = new Map<string, number>()

	const getDepth = (objectId: string): number => {
		const existing = memo.get(objectId)

		if (existing !== undefined) {
			return existing
		}

		const object = byId.get(objectId)

		if (!object || !object.parentObjectId || !byId.has(object.parentObjectId)) {
			memo.set(objectId, 0)
			return 0
		}

		const depth = getDepth(object.parentObjectId) + 1
		memo.set(objectId, depth)
		return depth
	}

	return [
		...objects,
	].sort((left, right) => (
		getDepth(right.objectId) - getDepth(left.objectId) || left.objectId.localeCompare(right.objectId)
	))
}

const resolveDesiredParentId = (parentObjectId: string, rootObjectId: string) => (
	parentObjectId === 'root' ?
		rootObjectId
	:
		parentObjectId
)

const toMutation = (object: FabricObjectRow): ObjectMutation => ({
	objectId: object.objectId,
	parentId: object.parentObjectId,
	name: object.name,
	classId: object.classId,
	type: object.type,
	subtype: object.subtype,
	resourceReference: object.resourceReference,
	resourceName: object.resourceName,
	transform: object.transformJson,
	bounds: object.boundJson,
})

const sameJson = (left: Record<string, unknown> | null, right: Record<string, unknown> | null) => (
	JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
)

const needsUpdate = (desired: FabricObjectRow, remote: FabricObject) => (
	desired.name !== remote.name
	|| desired.classId !== remote.classId
	|| desired.type !== remote.type
	|| desired.subtype !== remote.subtype
	|| desired.resourceReference !== remote.resourceReference
	|| desired.resourceName !== remote.resourceName
	|| !sameJson(desired.transformJson, remote.transform)
	|| !sameJson(desired.boundJson, remote.bounds)
)

const getAttachmentIds = (attachments: FabricAttachmentRow[]) => (
	new Set(
		attachments.map((attachment) => (
			attachment.objectId
		)),
	)
)

export const planMutations = (args: {
	snapshot: ScopeSnapshot
	remoteState: RemoteScopeState
}) => {
	const desiredObjects = sortByDepth(
		args.snapshot.objects.filter((object) => (
			!object.deleted
		)),
	)
	const desiredById = new Map(
		desiredObjects.map((object) => (
			[
				object.objectId,
				object,
			]
		)),
	)
	const deletedDesiredIds = new Set(
		args.snapshot.objects
			.filter((object) => (
				object.deleted
			))
			.map((object) => (
				object.objectId
			)),
	)
	const remoteById = new Map(
		args.remoteState.managedObjects.map((object) => (
			[
				object.objectId,
				object,
			]
		)),
	)
	const attachmentIds = getAttachmentIds(args.snapshot.attachments)
	const creates: ObjectMutation[] = []
	const updates: ObjectMutation[] = []
	const attachmentUpdates: ObjectMutation[] = []
	const moves: {
		objectId: string
		parentId: string
	}[] = []

	for (const object of desiredObjects) {
		const remote = remoteById.get(object.objectId)
		const desiredParentId = resolveDesiredParentId(object.parentObjectId, args.remoteState.rootObjectId)

		if (!remote) {
			creates.push({
				...toMutation(object),
				parentId: desiredParentId,
			})
			continue
		}

		if (needsUpdate(object, remote)) {
			;(attachmentIds.has(object.objectId) ? attachmentUpdates : updates).push({
				...toMutation(object),
				parentId: desiredParentId,
			})
		}

		if (remote.parentObjectId !== desiredParentId) {
			moves.push({
				objectId: object.objectId,
				parentId: desiredParentId,
			})
		}
	}

	const deletes = sortDeletesByDepth(
		args.remoteState.managedObjects.filter((object) => (
			!desiredById.has(object.objectId) || deletedDesiredIds.has(object.objectId)
		)),
	).map((object): DeleteMutation => ({
		objectId: object.objectId,
	}))

	return {
		creates,
		updates,
		attachmentUpdates,
		moves,
		deletes,
		desiredRevision: args.snapshot.scope.desiredRevision,
	} satisfies MutationPlan
}
