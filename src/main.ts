/// <reference types="@webgpu/types"/>
import './style.css';
import rawShader from './shader.wgsl?raw';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { mat4 } from 'wgpu-matrix';

async function initWebGPU() {
    const canvas = document.querySelector('#renderCanvas') as HTMLCanvasElement;
    const adapter = await navigator.gpu?.requestAdapter();
    const device =  await adapter?.requestDevice();
    if (!device || !canvas) throw new Error("WebGPU not supported!");

    const context = canvas.getContext('webgpu') as GPUCanvasContext;
    const format = navigator.gpu.getPreferredCanvasFormat();
    const resize = () => {
        canvas.width = window.innerWidth * window.devicePixelRatio;
        canvas.height = window.innerHeight * window.devicePixelRatio;
        context.configure({device, format});
    };
    window.addEventListener('resize', resize);
    resize();

    const shaderModule = device.createShaderModule({code: rawShader});
    const defs = makeShaderDataDefinitions(rawShader);
    const uniforms = makeStructuredView(defs.structs.Uniforms);
    const uniformBuffer = device.createBuffer({
        size: uniforms.arrayBuffer.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const verts = new Float32Array([
         0,  1, 0,   0, 1, 0,
        -1, -1, 0,   1, 0, 0,
         1, -1, 0,   0, 0, 1,
    ]);
    const vertexBuffer = device.createBuffer({
        size: verts.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vertexBuffer, 0, verts);

    const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: shaderModule,
            entryPoint: 'vertex',
            buffers: [{
                arrayStride: 24,
                attributes: [
                    { shaderLocation: 0, offset: 0, format: 'float32x3' },
                    { shaderLocation: 1, offset: 12, format: 'float32x3' },
                ]
            }]
        },
        fragment: {
            module: shaderModule,
            entryPoint: 'fragment',
            targets: [{ format }]
        },
        primitive: { topology: 'triangle-list' }
    });

    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{binding: 0, resource: {buffer: uniformBuffer}}]
    });

    let time = 0;

    function render() {
        time += 0.01;
        const aspect = canvas.width / canvas.height;

        const projection = mat4.perspective(Math.PI / 4, aspect, 0.1, 100.0);
        const view = mat4.translation([ 0, 0, -5 ]);
        const model = mat4.rotationY(time);
        const mvp = mat4.mul(mat4.mul(projection, view), model);

        uniforms.set({ mvp, time });
        device!.queue.writeBuffer(uniformBuffer, 0, uniforms.arrayBuffer);

        const commandEncoder = device!.createCommandEncoder();
        const pass = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                clearValue: { r: 0.05, g: 0.05, b:0.05, a: 1.0 },
                loadOp: 'clear',
                storeOp: 'store',
            }]
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.setVertexBuffer(0, vertexBuffer);
        pass.draw(3);
        pass.end();

        device!.queue.submit([ commandEncoder.finish() ]);
        requestAnimationFrame(render);
    }
    requestAnimationFrame(render);
}

initWebGPU();
