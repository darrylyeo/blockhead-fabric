import type { FabricClient, MutationPlan } from './types.js'

const runCreates = async (args: {
	scopeId: string
	fabricClient: FabricClient
	mutations: MutationPlan['creates']
}) => {
	for (const mutation of args.mutations) {
		await args.fabricClient.createObject({
			scopeId: args.scopeId,
			parentId: mutation.parentId,
			objectId: mutation.objectId,
			name: mutation.name,
			classId: mutation.classId,
			type: mutation.type,
			subtype: mutation.subtype,
			resourceReference: mutation.resourceReference,
			resourceName: mutation.resourceName,
			transform: mutation.transform,
			bounds: mutation.bounds,
		})
	}
}

const runUpdates = async (args: {
	scopeId: string
	fabricClient: FabricClient
	mutations: MutationPlan['updates']
}) => {
	for (const mutation of args.mutations) {
		await args.fabricClient.updateObject({
			scopeId: args.scopeId,
			parentId: mutation.parentId,
			objectId: mutation.objectId,
			name: mutation.name,
			classId: mutation.classId,
			type: mutation.type,
			subtype: mutation.subtype,
			resourceReference: mutation.resourceReference,
			resourceName: mutation.resourceName,
			transform: mutation.transform,
			bounds: mutation.bounds,
		})
	}
}

const runMoves = async (args: {
	scopeId: string
	fabricClient: FabricClient
	mutations: MutationPlan['moves']
}) => {
	for (const mutation of args.mutations) {
		await args.fabricClient.moveObject({
			scopeId: args.scopeId,
			objectId: mutation.objectId,
			parentId: mutation.parentId,
		})
	}
}

const runDeletes = async (args: {
	scopeId: string
	fabricClient: FabricClient
	mutations: MutationPlan['deletes']
}) => {
	for (const mutation of args.mutations) {
		await args.fabricClient.deleteObject({
			scopeId: args.scopeId,
			objectId: mutation.objectId,
		})
	}
}

export const executeMutations = async (args: {
	scopeId: string
	fabricClient: FabricClient
	plan: MutationPlan
}) => {
	await runCreates({
		scopeId: args.scopeId,
		fabricClient: args.fabricClient,
		mutations: args.plan.creates,
	})
	await runUpdates({
		scopeId: args.scopeId,
		fabricClient: args.fabricClient,
		mutations: args.plan.updates,
	})
	await runMoves({
		scopeId: args.scopeId,
		fabricClient: args.fabricClient,
		mutations: args.plan.moves,
	})
	await runUpdates({
		scopeId: args.scopeId,
		fabricClient: args.fabricClient,
		mutations: args.plan.attachmentUpdates,
	})
	await runDeletes({
		scopeId: args.scopeId,
		fabricClient: args.fabricClient,
		mutations: args.plan.deletes,
	})
}
