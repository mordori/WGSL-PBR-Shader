export function parseOBJ(text: string) {
	const positions: number[][] = [];
	const normals: number[][] = [];
	const vertices: number[] = [];

	const lines = text.split('\n');

	for (const line of lines) {
		const parts = line.trim().split(/\s+/);
		if (parts[0] == 'v') {
			positions.push([
				parseFloat(parts[1]),
				parseFloat(parts[2]),
				parseFloat(parts[3])
			]);
		} else if (parts[0] == 'vn') {
			normals.push([
				parseFloat(parts[1]),
				parseFloat(parts[2]),
				parseFloat(parts[3])
			]);
		} else if (parts[0] == 'f') {
			const faceVerts: { p: number, n: number }[] = [];
			for (let i = 1; i < parts.length; i++) {
				const indices = parts[i].split('/');
				faceVerts.push({
					p: parseInt(indices[0]) - 1,
					n: parseInt(indices[2]) - 1
				});
			}
			for (let i = 1; i < faceVerts.length - 1; i++) {
				const tri = [faceVerts[0], faceVerts[i], faceVerts[i + 1]];
				for (const v of tri) {
					const pos = positions[v.p];
					const normal = normals[v.n];
					vertices.push(...pos);
					vertices.push(...normal);
				}
			}
		}
	}
	return new Float32Array(vertices);
}
