import type { ScopeSnapshot } from './types.js'

export const validateDesiredState = (snapshot: ScopeSnapshot) => {
	const errors: string[] = []
	const liveObjects = new Map(
		snapshot.objects
			.filter((object) => (
				!object.deleted
			))
			.map((object) => (
				[
					object.objectId,
					object,
				]
			)),
	)
	const entrypointRoots = new Set(
		snapshot.entrypoints.map((entrypoint) => (
			entrypoint.rootObjectId
		)),
	)
	const knownScopes = new Set(snapshot.knownScopeIds)

	for (const entrypoint of snapshot.entrypoints) {
		if (!liveObjects.has(entrypoint.rootObjectId)) {
			errors.push(`Entrypoint ${entrypoint.entrypointId} is missing root object ${entrypoint.rootObjectId}`)
		}
	}

	for (const object of liveObjects.values()) {
		if (entrypointRoots.has(object.objectId)) {
			continue
		}

		if (!liveObjects.has(object.parentObjectId)) {
			errors.push(`Object ${object.objectId} is missing parent ${object.parentObjectId}`)
		}
	}

	for (const attachment of snapshot.attachments) {
		if (!liveObjects.has(attachment.objectId)) {
			errors.push(`Attachment ${attachment.objectId} is missing target object`)
		}

		if (!knownScopes.has(attachment.childScopeId)) {
			errors.push(`Attachment ${attachment.objectId} references unknown child scope ${attachment.childScopeId}`)
		}

		const object = liveObjects.get(attachment.objectId)

		if (object && object.classId !== 73) {
			errors.push(`Attachment ${attachment.objectId} must use class 73`)
		}

		if (object && object.resourceReference !== attachment.resourceReference) {
			errors.push(`Attachment ${attachment.objectId} resource_reference does not match fabric_attachments`)
		}
	}

	return errors
}
