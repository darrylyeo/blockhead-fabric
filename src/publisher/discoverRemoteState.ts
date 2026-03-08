import type { FabricClient, FabricObject, RemoteScopeState, ScopeSnapshot } from './types.js'

const uniqueObjects = (objects: FabricObject[]) => (
	Array.from(
		new Map(
			objects.map((object) => (
				[
					object.objectId,
					object,
				]
			)),
		).values(),
	)
)

export const discoverRemoteState = async (args: {
	fabricClient: FabricClient
	fabricUrl: string
	fabricAdminKey?: string
	timeoutMs: number
	snapshot: ScopeSnapshot
}) => {
	const connection = await args.fabricClient.connectRoot({
		fabricUrl: args.fabricUrl,
		adminKey: args.fabricAdminKey,
		timeoutMs: args.timeoutMs,
	})
	const rootObject = await args.fabricClient.getObject({
		scopeId: connection.scopeId,
		objectId: connection.rootObjectId,
	})
	const rootChildren = await args.fabricClient.listObjects({
		scopeId: connection.scopeId,
		anchorObjectId: connection.rootObjectId,
	})
	const desiredEntrypointIds = new Set(
		args.snapshot.entrypoints.map((entrypoint) => (
			entrypoint.rootObjectId
		)),
	)
	const queue = rootChildren
		.filter((object) => (
			desiredEntrypointIds.has(object.objectId)
		))
		.map((object) => (
			object.objectId
		))
	const visited = new Set(queue)
	const managedObjects = [
		...rootChildren.filter((object) => (
			desiredEntrypointIds.has(object.objectId)
		)),
	]

	while (queue.length > 0) {
		const anchorObjectId = queue.shift()

		if (!anchorObjectId) {
			continue
		}

		const children = await args.fabricClient.listObjects({
			scopeId: connection.scopeId,
			anchorObjectId,
		})

		for (const child of children) {
			managedObjects.push(child)

			if (!visited.has(child.objectId)) {
				visited.add(child.objectId)
				queue.push(child.objectId)
			}
		}
	}

	return {
		scopeId: connection.scopeId,
		rootObjectId: connection.rootObjectId,
		rootObject,
		rootChildren,
		managedObjects: uniqueObjects(managedObjects),
	} satisfies RemoteScopeState
}
