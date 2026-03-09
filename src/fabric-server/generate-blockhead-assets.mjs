import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const targetDir = process.argv[2]

if (!targetDir) {
	throw new Error('Expected output directory argument')
}

const cubeBufferBase64 = 'AAAAvwAAAL8AAAC/AAAAPwAAAL8AAAC/AAAAPwAAAD8AAAC/AAAAvwAAAD8AAAC/AAAAvwAAAL8AAAA/AAAAPwAAAL8AAAA/AAAAPwAAAD8AAAA/AAAAvwAAAD8AAAA/AAAAPwAAAL8AAAC/AAAAvwAAAL8AAAC/AAAAvwAAAD8AAAC/AAAAPwAAAD8AAAC/AAAAPwAAAL8AAAA/AAAAPwAAAL8AAAC/AAAAPwAAAD8AAAC/AAAAPwAAAD8AAAA/AAAAvwAAAL8AAAC/AAAAvwAAAL8AAAA/AAAAvwAAAD8AAAA/AAAAvwAAAD8AAAC/AAAAvwAAAD8AAAA/AAAAPwAAAD8AAAA/AAAAPwAAAD8AAAC/AAAAvwAAAD8AAAC/AAAAvwAAAL8AAAC/AAAAPwAAAL8AAAC/AAAAPwAAAL8AAAA/AAAAvwAAAL8AAAA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAAAAAAAAgD8AAAAAAAAAAAAAgD8AAAAAAAAAAAAAgD8AAAAAAAAAAAAAgD8AAAAAAAAAAAAAgL8AAAAAAAAAAAAAgL8AAAAAAAAAAAAAgL8AAAAAAAAAAAAAgL8AAAAAAAABAAIAAAACAAMABAAFAAYABAAGAAcACAAJAAoACAAKAAsADAANAA4ADAAOAA8AEAARABIAEAASABMAFAAVABYAFAAWABcA'

const asset = (name, color) => JSON.stringify({
	asset: {
		version: '2.0',
		generator: 'blockhead-fabric',
	},
	scene: 0,
	scenes: [
		{
			nodes: [
				0,
			],
		},
	],
	nodes: [
		{
			mesh: 0,
			name,
		},
	],
	meshes: [
		{
			primitives: [
				{
					attributes: {
						POSITION: 0,
						NORMAL: 1,
					},
					indices: 2,
					material: 0,
				},
			],
		},
	],
	materials: [
		{
			name: `${name}Material`,
			pbrMetallicRoughness: {
				baseColorFactor: color,
				metallicFactor: 0,
				roughnessFactor: 0.85,
			},
		},
	],
	buffers: [
		{
			uri: `data:application/octet-stream;base64,${cubeBufferBase64}`,
			byteLength: 648,
		},
	],
	bufferViews: [
		{
			buffer: 0,
			byteOffset: 0,
			byteLength: 288,
			target: 34962,
		},
		{
			buffer: 0,
			byteOffset: 288,
			byteLength: 288,
			target: 34962,
		},
		{
			buffer: 0,
			byteOffset: 576,
			byteLength: 72,
			target: 34963,
		},
	],
	accessors: [
		{
			bufferView: 0,
			componentType: 5126,
			count: 24,
			type: 'VEC3',
			min: [
				-0.5,
				-0.5,
				-0.5,
			],
			max: [
				0.5,
				0.5,
				0.5,
			],
		},
		{
			bufferView: 1,
			componentType: 5126,
			count: 24,
			type: 'VEC3',
		},
		{
			bufferView: 2,
			componentType: 5123,
			count: 36,
			type: 'SCALAR',
		},
	],
})

const assets = {
	'blockhead-latest.gltf': [
		0.33,
		0.62,
		0.98,
		1,
	],
	'blockhead-safe.gltf': [
		0.25,
		0.82,
		0.75,
		1,
	],
	'blockhead-finalized.gltf': [
		0.35,
		0.86,
		0.46,
		1,
	],
	'blockhead-district.gltf': [
		0.22,
		0.25,
		0.31,
		1,
	],
	'blockhead-account.gltf': [
		0.5,
		0.84,
		0.96,
		1,
	],
	'blockhead-contract.gltf': [
		0.98,
		0.72,
		0.34,
		1,
	],
	'blockhead-token.gltf': [
		0.44,
		0.84,
		0.86,
		1,
	],
	'blockhead-collection.gltf': [
		0.76,
		0.55,
		0.98,
		1,
	],
	'blockhead-pool.gltf': [
		0.26,
		0.94,
		0.82,
		1,
	],
	'blockhead-tx.gltf': [
		0.98,
		0.59,
		0.29,
		1,
	],
	'blockhead-event-erc20.gltf': [
		0.5,
		0.96,
		0.76,
		1,
	],
	'blockhead-event-erc721.gltf': [
		0.82,
		0.6,
		0.98,
		1,
	],
	'blockhead-event-erc1155.gltf': [
		0.98,
		0.48,
		0.82,
		1,
	],
	'blockhead-beam-native.gltf': [
		0.96,
		0.84,
		0.42,
		1,
	],
	'blockhead-beam-erc20.gltf': [
		0.42,
		0.92,
		0.96,
		1,
	],
	'blockhead-beam-call.gltf': [
		0.74,
		0.56,
		0.98,
		1,
	],
	'blockhead-state-activity.gltf': [
		0.94,
		0.94,
		0.94,
		1,
	],
	'blockhead-state-in.gltf': [
		0.46,
		0.94,
		0.52,
		1,
	],
	'blockhead-state-out.gltf': [
		0.98,
		0.46,
		0.46,
		1,
	],
	'blockhead-state-events.gltf': [
		0.88,
		0.54,
		0.98,
		1,
	],
}

mkdirSync(targetDir, {
	recursive: true,
})

for (const [filename, color] of Object.entries(assets)) {
	writeFileSync(
		join(targetDir, filename),
		asset(filename.replace('.gltf', ''), color),
	)
}
