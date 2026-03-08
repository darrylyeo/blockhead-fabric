/**
 * Validates spec 003: Manifolder can load the blockhead fabric hierarchy.
 * Run after e2e (or with Fabric + publisher already running).
 *
 * Env: FABRIC_URL (default http://localhost:3000/fabric), MANIFOLDER_URL (default http://localhost:3000/app.html)
 */
const fabricUrl = process.env.FABRIC_URL ?? 'http://localhost:3000/fabric'
const manifolderUrl = process.env.MANIFOLDER_URL ?? 'http://localhost:3000/app.html'

const main = async () => {
	const fabricRes = await fetch(fabricUrl, { headers: { accept: 'application/json' } })
	if (!fabricRes.ok) {
		console.error('manifolder-e2e: fabric descriptor fetch failed', { fabricUrl, status: fabricRes.status })
		process.exit(1)
	}
	const fabricBody = (await fabricRes.json()) as { map?: unknown }
	const descriptor = (fabricBody?.map ?? fabricBody) as { sConnect?: unknown, wClass?: unknown, twObjectIx?: unknown }
	if (
		typeof descriptor.sConnect !== 'string' ||
		typeof descriptor.wClass !== 'number' ||
		(typeof descriptor.twObjectIx !== 'number' && typeof descriptor.twObjectIx !== 'string')
	) {
		console.error('manifolder-e2e: invalid fabric descriptor', { fabricUrl, descriptor })
		process.exit(1)
	}

	const manifolderPageUrl = `${manifolderUrl}?msf=${encodeURIComponent(fabricUrl)}`
	const manifolderRes = await fetch(manifolderPageUrl)
	if (!manifolderRes.ok) {
		console.error('manifolder-e2e: Manifolder page fetch failed', { manifolderPageUrl, status: manifolderRes.status })
		process.exit(1)
	}
	const html = await manifolderRes.text()
	if (!html.includes('Manifolder') || !html.includes('hierarchy')) {
		console.error('manifolder-e2e: Manifolder page content unexpected')
		process.exit(1)
	}

	console.log('manifolder-e2e: ok', { fabricUrl, manifolderUrl })
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
