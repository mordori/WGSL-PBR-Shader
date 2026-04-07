struct  Uniforms {
    mvp: mat4x4f,
    time: f32,
};

@group(0) @binding(0) var<uniform> uniforms : Uniforms;

struct VertexOutput {
    @builtin(position) position : vec4f,
    @location(0) vColor : vec3f,
};

@vertex
fn vertex(@location(0) position: vec3f, @location(1) color: vec3f) -> VertexOutput {
    var out: VertexOutput;
    out.position = uniforms.mvp * vec4f(position, 1.0);
    out.vColor = color;
    return out;
}

@fragment
fn fragment(@location(0) vColor: vec3f) -> @location(0) vec4f {
    return vec4f(vColor, 1.0);
}
