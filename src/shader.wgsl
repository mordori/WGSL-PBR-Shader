struct Uniforms {
	lights: array<PointLight, 4>,
	shadowMatrices: array<mat4x4f, 24>,
	mvp: mat4x4f,
	model: mat4x4f,
	cameraPos: vec3f,
	lightCount: u32,
	time: f32,
};

struct PointLight {
	position: vec3f,
	emission: vec3f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var shadowCube: texture_depth_cube_array;
@group(0) @binding(2) var shadowSampler: sampler_comparison;

struct VertexOutput {
	@builtin(position) Position: vec4f,
	@location(0) positionWS: vec3f,
	@location(1) normalWS: vec3f,
};

const PI: f32 = 3.14159265359;

@vertex
fn vertex_shadow(@location(0) positionOS: vec3f, @builtin(instance_index) layerIndex: u32) -> @builtin(position) vec4f {
	return uniforms.shadowMatrices[layerIndex] * vec4f(positionOS, 1.0);
}

@vertex
fn vertex(@location(0) positionOS: vec3f, @location(1) normalOS: vec3f) -> VertexOutput {
	var out: VertexOutput;
	out.Position = uniforms.mvp * vec4f(positionOS, 1.0);
	out.positionWS = (uniforms.model * vec4f(positionOS, 1.0)).xyz;
	out.normalWS = (uniforms.model * vec4f(normalOS, 0.0)).xyz;
	return out;
}

@fragment
fn fragment(in: VertexOutput) -> @location(0) vec4f {

	let albedo = vec3f(1.0, 1.0, 1.0);
	let metallic = 0.0;
	let roughness = 0.4;

	let ambient = vec3f(0.005) * albedo;

	let N = normalize(in.normalWS);
	let V = normalize(uniforms.cameraPos - in.positionWS);
	let NdotV = max(dot(N, V), 0.0);

	var F0 = vec3f(0.04);
	F0 = mix(F0, albedo, metallic);
	let surface = (1.0 - metallic) * albedo;

	var lighting = vec3f(0.0);
	for (var i = 0u; i < uniforms.lightCount; i++) {
		let light = uniforms.lights[i];
		let radiance = calculateLight(uniforms.lights[i], in.positionWS, N, V, NdotV, roughness, F0, surface);
		let shadow = calculateShadow(light.position, in.positionWS, N, in.Position.xy, i32(i));
		lighting += radiance * shadow;
	}

	var color = lighting + ambient;
	color = color / (color + vec3f(1.0));
	color = pow(color, vec3f(1.0 / 2.2));
	return vec4f(color, 1.0);
}

fn calculateShadow(lightPos: vec3f, positionWS: vec3f, N: vec3f, positionSS: vec2f, lightIndex: i32) -> f32 {
	let lightToFrag = positionWS - lightPos;
	let lightDir = normalize(-lightToFrag);
	let NdotL_dir = max(dot(N, lightDir), 0.0);

	var shadowFactor = 0.0;

	let slope = 1.0 - NdotL_dir;
	let normalBias = 0.005 + (0.015 * slope);
	let biasedPos = positionWS + N * normalBias;
	let biasedLightToFrag = biasedPos - lightPos;

	var dist = max(max(abs(biasedLightToFrag.x), abs(biasedLightToFrag.y)), abs(biasedLightToFrag.z));
	let near = 0.1;
	let far = 15.0;
	let expectedDepth = (far / (far - near)) * (1.0 - near / dist);

	let offsets = array<vec3f, 20>(
		vec3f( 0.0,  0.0,  0.0), vec3f( 0.5,  0.5,  0.5), vec3f(-0.5, -0.5, -0.5),
		vec3f(-0.5,  0.5,  0.5), vec3f( 0.5, -0.5, -0.5), vec3f( 0.5,  0.5, -0.5),
		vec3f(-0.5, -0.5,  0.5), vec3f( 0.5, -0.5,  0.5), vec3f(-0.5,  0.5, -0.5),
		vec3f( 0.8,  0.0,  0.0), vec3f(-0.8,  0.0,  0.0), vec3f( 0.0,  0.8,  0.0),
		vec3f( 0.0, -0.8,  0.0), vec3f( 0.0,  0.0,  0.8), vec3f( 0.0,  0.0, -0.8),
		vec3f( 0.0,  0.4,  0.4), vec3f( 0.0, -0.4, -0.4), vec3f( 0.4,  0.0,  0.4),
		vec3f(-0.4,  0.0, -0.4), vec3f( 0.4,  0.4,  0.0)
	);

	let diskRadius = 0.005;
	let val = vec2f(0.06711056, 0.00583715);
	let noise = fract(52.9829189 * fract(dot(positionSS, val) + f32(lightIndex)));
	let jitterRadius = diskRadius * (0.8 + 0.4 * noise);

	let sampleDir = -lightDir;
	for (var j = 0; j < 20; j++){
		shadowFactor += textureSampleCompare(
			shadowCube,
			shadowSampler,
			normalize(sampleDir + offsets[j] * jitterRadius),
			lightIndex,
			expectedDepth
		);
	};
	shadowFactor /= 20.0;

	return shadowFactor;
}

fn calculateLight(light: PointLight, positionWS: vec3f, N: vec3f, V: vec3f, NdotV: f32, roughness: f32, F0: vec3f, surface: vec3f) -> vec3f {
	let distance = length(light.position - positionWS);
	let attenuation = 1.0 / (distance * distance);
	let radiance = light.emission * attenuation;

	let L = normalize(light.position - positionWS);
	let H = normalize(L + V);

	let NdotL = max(dot(N, L), 0.0);
	let NdotH = max(dot(N, H), 0.0);
	let VdotH = max(dot(V, H), 0.0);
	let LdotH = max(dot(L, H), 0.0);

	let D = D_GGX(NdotH, roughness);
	let VSmith = V_SmithCorrelated(NdotV, NdotL, roughness);
	let F = F_Schlick_vec3f(VdotH, F0);

	let fr = D * VSmith * F;
	let kd = vec3f(1.0) - F;
	let fd = surface * disneyDiffuse(NdotL, NdotV, LdotH, roughness) * kd;
	return (fd + fr) * radiance * NdotL;
}

fn D_GGX(NdotH: f32, roughness: f32) -> f32 {
	let a = roughness * roughness;
	let a2 = a * a;
	let NdotH2 = NdotH * NdotH;

	let denom = (NdotH2 * (a2 - 1.0) + 1.0);
	return a2 / (PI * denom * denom);
}

fn V_SmithCorrelated(NdotV: f32, NdotL: f32, roughness: f32) -> f32 {
	let a = roughness * roughness;
	let GGXV = NdotL * (NdotV * (1.0 - a) + a);
	let GGXL = NdotV * (NdotL * (1.0 - a) + a);
	return 0.5 / (GGXV + GGXL);
}

fn F_Schlick_vec3f(u: f32, F0: vec3f) -> vec3f {
	return F0 + (1.0 - F0) * pow(clamp(1.0 - u, 0.0, 1.0), 5.0);
}

fn F_Schlick(u: f32, F0: f32, F90: f32) -> f32 {
	return F0 + (F90 - F0) * pow(1.0 - u, 5.0);
}

fn disneyDiffuse(NdotL: f32, NdotV: f32, LdotH: f32, roughness: f32) -> f32 {
	let F90 = 0.5 + 2.0 * roughness * LdotH * LdotH;
	let LScatter = F_Schlick(NdotL, 1.0, F90);
	let VScatter = F_Schlick(NdotV, 1.0, F90);
	return LScatter * VScatter * (1.0 / PI);
}
