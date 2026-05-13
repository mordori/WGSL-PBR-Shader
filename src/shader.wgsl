struct Uniforms {
	lights: array<PointLight, 4>,
	dirLight: PointLight,
	dirLight_mvp: mat4x4f,
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
@group(0) @binding(1) var shadowMap: texture_depth_2d;
@group(0) @binding(2) var shadowSampler: sampler_comparison;

struct VertexOutput {
	@builtin(position) Position: vec4f,
	@location(0) shadowCoords: vec3f,
	@location(1) positionWS: vec3f,
	@location(2) normalWS: vec3f,
};

const PI: f32 = 3.14159265359;

@vertex
fn vertex_shadow(@location(0) positionOS: vec3f) -> @builtin(position) vec4f {
	return uniforms.dirLight_mvp * vec4f(positionOS, 1.0);
}

@vertex
fn vertex(@location(0) positionOS: vec3f, @location(1) normalOS: vec3f) -> VertexOutput {
	var out: VertexOutput;
	let posFromLight = uniforms.dirLight_mvp * vec4f(positionOS, 1.0);
	out.shadowCoords = vec3f(posFromLight.xy * vec2f(0.5, -0.5) + vec2f(0.5), posFromLight.z);
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

	let texelSize = 1.0 / vec2f(textureDimensions(shadowMap));
	var shadowFactor = 0.0;
	let lightDir = normalize(uniforms.dirLight.position - in.positionWS);
	let bias = max(0.002 * (1.0 - dot(N, lightDir)), 0.0005);
	for (var y = -1; y <= 1; y++) {
		for (var x = -1; x <= 1; x++) {
			let offset = vec2f(f32(x), f32(y)) * texelSize;

			shadowFactor += textureSampleCompare(
				shadowMap,
				shadowSampler,
				in.shadowCoords.xy + offset,
				in.shadowCoords.z - bias
			);
		}
	}
	shadowFactor /= 9.0;

	var radiance = calculateLight(uniforms.dirLight, in.positionWS, N, V, NdotV, roughness, F0, surface) * shadowFactor;
	for (var i = 0u; i < uniforms.lightCount; i++) {
		radiance += calculateLight(uniforms.lights[i], in.positionWS, N, V, NdotV, roughness, F0, surface);
	}

	var color = radiance + ambient;
	color = color / (color + vec3f(1.0));
	color = pow(color, vec3f(1.0 / 2.2));
	return vec4f(color, 1.0);
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
