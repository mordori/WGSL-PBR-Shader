struct Uniforms {
	mvp: mat4x4f,
	model: mat4x4f,
	cameraPos: vec3f,
	time: f32,
	lights: array<PointLight, 4>,
};

struct PointLight {
	position: vec3f,
	emission: vec3f,
};

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;

struct VertexOutput {
	@builtin(position) position: vec4f,
	@location(0) normalWS: vec3f,
	@location(1) positionWS: vec3f,
};

const PI: f32 = 3.14159265359;

@vertex
fn vertex(@location(0) position: vec3f, @location(1) normal: vec3f) -> VertexOutput {
	var out: VertexOutput;
	out.position = uniforms.mvp * vec4f(position, 1.0);
	out.normalWS = (uniforms.model * vec4f(normal, 0.0)).xyz;
	out.positionWS = (uniforms.model * vec4f(position, 1.0)).xyz;
	return out;
}

@fragment
fn fragment(@location(0) normal: vec3f, @location(1) positionWS: vec3f) -> @location(0) vec4f {

	let albedo = vec3f(0.8, 0.2, 0.2);
	let metallic = 0.0;
	let roughness = 0.4;

	let ambient = vec3f(0.03) * albedo;
	let lightPos = vec3f(10.0, 5.0, 5.0);
	let lightEmission = vec3f(300.0, 300.0, 300.0);
	let distance = length(lightPos - positionWS);
	let attenuation = 1.0 / (distance * distance);
	let radiance = lightEmission * attenuation;

	let N = normalize(normal);
	let L = normalize(lightPos - positionWS);
	let V = normalize(uniforms.cameraPos - positionWS);
	let H = normalize(L + V);

	let NdotL = max(dot(N, L), 0.0);
	let NdotV = max(dot(N, V), 0.0);
	let NdotH = max(dot(N, H), 0.0);
	let VdotH = max(dot(V, H), 0.0);
	let LdotH = max(dot(L, H), 0.0);

	var F0 = vec3f(0.04);
	F0 = mix(F0, albedo, metallic);

	let D = D_GGX(NdotH, roughness);
	let VSmith = V_SmithCorrelated(NdotV, NdotL, roughness);
	let F = F_Schlick_vec3f(VdotH, F0);

	let fr = D * VSmith * F;
	let kd = vec3f(1.0) - F;
	let surface = (1.0 - metallic) * albedo;
	let fd = surface * disneyDiffuse(NdotL, NdotV, LdotH, roughness) * kd;

	let Lo = (fd + fr) * radiance * NdotL;
	var color = Lo + ambient;

	color = color / (color + vec3f(1.0));
	color = pow(color, vec3f(1.0 / 2.2));

	return vec4f(color, 1.0);
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
