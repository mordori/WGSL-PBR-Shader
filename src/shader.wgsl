struct  Uniforms {
	mvp: mat4x4f,
	model: mat4x4f,
	time: f32,
};

@group(0) @binding(0) var<uniform> uniforms : Uniforms;

struct VertexOutput {
	@builtin(position) position : vec4f,
	@location(0) normal : vec3f,
};

@vertex
fn vertex(@location(0) position: vec3f, @location(1) normal: vec3f) -> VertexOutput {
	var out: VertexOutput;
	out.position = uniforms.mvp * vec4f(position, 1.0);
	let normalWS = uniforms.model * vec4f(normal, 0.0);
	out.normal = normalWS.xyz;
	return out;
}

@fragment
fn fragment(@location(0) normal: vec3f) -> @location(0) vec4f {
	let lightDir = normalize(vec3f(0.0, 0.0, 1.0));
	let n = normalize(normal);
	let diffuse = max(dot(n, lightDir), 0.0);
	let baseColor = vec3f(0.8, 0.2, 0.8);
	const ambient = 0.3;
	let color = baseColor * (diffuse + ambient);
	return vec4f(color, 1.0);
}
