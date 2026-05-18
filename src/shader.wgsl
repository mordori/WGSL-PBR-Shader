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
	@builtin(position) positionSS: vec4f,
	@location(0) positionWS: vec3f,
	@location(1) normalWS: vec3f,
};

struct Surface {
	positionWS: vec3f,
	N: vec3f,
	V: vec3f,
	F0: vec3f,
	color: vec3f,
	NdotV: f32,
	roughness: f32,
}

const PI: f32 = 3.14159265359;

@vertex
fn vertex_shadow(@location(0) positionOS: vec3f, @builtin(instance_index) layerIndex: u32) -> @builtin(position) vec4f {
	return uniforms.shadowMatrices[layerIndex] * vec4f(positionOS, 1.0);
}

@vertex
fn vertex(@location(0) positionOS: vec3f, @location(1) normalOS: vec3f) -> VertexOutput {
	var out: VertexOutput;
	out.positionSS = uniforms.mvp * vec4f(positionOS, 1.0);
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
	let color = (1.0 - metallic) * albedo;

	var params: Surface;
	params.positionWS = in.positionWS;
	params.N = N;
	params.V = V;
	params.F0 = F0;
	params.NdotV = NdotV;
	params.roughness = roughness;
	params.color = color;

	var lighting = vec3f(0.0);
	for (var i = 0u; i < uniforms.lightCount; i++) {
		let light = uniforms.lights[i];
		let radiance = calculateLight(uniforms.lights[i], params);
		let shadow = calculateShadow(light.position, in.positionWS, N, in.positionSS.xy, i32(i));
		lighting += radiance * shadow;
	}

	var frag = lighting + ambient;
	frag = frag / (frag + vec3f(1.0)); // Reinhard tone mapping
	frag = pow(frag, vec3f(1.0 / 2.2)); // Gamma correction
	return vec4f(frag, 1.0);
}

fn calculateShadow(lightPos: vec3f, positionWS: vec3f, N: vec3f, positionSS: vec2f, lightIndex: i32) -> f32 {
	let lightToFrag = positionWS - lightPos;
	let lightDir = normalize(-lightToFrag);
	let NdotL_dir = max(dot(N, lightDir), 0.0);
	var shadowFactor = 0.0;

	// Dynamic normal bias
	let slope = 1.0 - NdotL_dir;
	let normalBias = 0.025 + (0.02 * slope);
	let biasedPos = positionWS + N * normalBias;
	let biasedLightToFrag = biasedPos - lightPos;
	let sampleDir = normalize(biasedLightToFrag);

	// Non-linear fragment depth
	var dist = max(max(abs(biasedLightToFrag.x), abs(biasedLightToFrag.y)), abs(biasedLightToFrag.z));
	let near = 0.1;
	let far = 15.0;
	let projectedDepth = (far / (far - near)) * (1.0 - near / dist);

	// Percentage-Closer Filtering with Poisson distribution
	let offsets = array<vec3f, 20>(
		vec3f( 0.0,  0.0,  0.0), vec3f( 0.5,  0.5,  0.5), vec3f(-0.5, -0.5, -0.5),
		vec3f(-0.5,  0.5,  0.5), vec3f( 0.5, -0.5, -0.5), vec3f( 0.5,  0.5, -0.5),
		vec3f(-0.5, -0.5,  0.5), vec3f( 0.5, -0.5,  0.5), vec3f(-0.5,  0.5, -0.5),
		vec3f( 0.8,  0.0,  0.0), vec3f(-0.8,  0.0,  0.0), vec3f( 0.0,  0.8,  0.0),
		vec3f( 0.0, -0.8,  0.0), vec3f( 0.0,  0.0,  0.8), vec3f( 0.0,  0.0, -0.8),
		vec3f( 0.0,  0.4,  0.4), vec3f( 0.0, -0.4, -0.4), vec3f( 0.4,  0.0,  0.4),
		vec3f(-0.4,  0.0, -0.4), vec3f( 0.4,  0.4,  0.0)
	);

	// Interleaved Gradient Noise by Jorge Jimenez
	let diskRadius = 0.007;
	let val = vec2f(0.06711056, 0.00583715);
	let ign = fract(52.9829189 * fract(dot(positionSS, val) + f32(lightIndex)));
	let jitterRadius = diskRadius * (0.8 + 0.4 * ign);

	// Compare depth against shadow cubemap with PCF offsets
	for (var j = 0; j < 20; j++){
		shadowFactor += textureSampleCompare(
			shadowCube,
			shadowSampler,
			normalize(sampleDir + offsets[j] * jitterRadius),
			lightIndex,
			projectedDepth
		);
	};
	shadowFactor /= 20.0;
	// let terminatorFade = smoothstep(0.0, 0.25, NdotL_dir);
	// return shadowFactor * terminatorFade;
	return shadowFactor;
}

fn calculateLight(light: PointLight, params: Surface) -> vec3f {
	let distance = length(light.position - params.positionWS);
	let attenuation = 1.0 / (distance * distance);
	let radiance = light.emission * attenuation;

	let L = normalize(light.position - params.positionWS);
	let H = normalize(L + params.V);

	let NdotL = max(dot(params.N, L), 0.0);
	let NdotH = max(dot(params.N, H), 0.0);
	let VdotH = max(dot(params.V, H), 0.0);
	let LdotH = max(dot(L, H), 0.0);

	let D = D_GGX(NdotH, params.roughness);
	let VSmith = V_SmithCorrelated(params.NdotV, NdotL, params.roughness);
	let F = F_Schlick_vec3f(VdotH, params.F0);

	let fr = D * VSmith * F;
	let kd = vec3f(1.0) - F;
	let fd = params.color * disneyDiffuse(NdotL, params.NdotV, LdotH, params.roughness) * kd;
	return (fd + fr) * radiance * NdotL;
}

fn D_GGX(NdotH: f32, roughness: f32) -> f32 {
	let a = roughness * roughness;
	let a2 = a * a;
	let NdotH2 = NdotH * NdotH;

	let denom = (NdotH2 * (a2 - 1.0) + 1.0);
	return a2 / (PI * denom * denom + 0.00001);
}

fn V_SmithCorrelated(NdotV: f32, NdotL: f32, roughness: f32) -> f32 {
	let a = roughness * roughness;
	let GGXV = NdotL * (NdotV * (1.0 - a) + a);
	let GGXL = NdotV * (NdotL * (1.0 - a) + a);
	return 0.5 / (GGXV + GGXL + 0.00001);
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
