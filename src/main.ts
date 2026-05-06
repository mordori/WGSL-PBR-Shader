/// <reference types="@webgpu/types"/>
import './style.css';
import rawShader from './shader.wgsl?raw';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { mat4 } from 'wgpu-matrix';
import { parseOBJ } from './parser';

async function initWebGPU() {
	const canvas = document.querySelector('#renderCanvas') as HTMLCanvasElement;
	let adapter = await navigator.gpu?.requestAdapter();
	if (!adapter) {
		console.warn("Core WebGPU features not available. Enabling compatibility mode.");
		adapter = await navigator.gpu?.requestAdapter({
			featureLevel: 'compatibility'
		});
	}
	const device = await adapter?.requestDevice();
	if (!device || !canvas) throw new Error("WebGPU not supported!");

	const context = canvas.getContext('webgpu') as GPUCanvasContext;
	const format = navigator.gpu.getPreferredCanvasFormat();
	let depthTexture: GPUTexture;
	const resize = () => {
		canvas.width = window.innerWidth * window.devicePixelRatio;
		canvas.height = window.innerHeight * window.devicePixelRatio;
		context.configure({ device, format });

		if (depthTexture) depthTexture.destroy();
		depthTexture = device.createTexture({
			size: [canvas.width, canvas.height],
			format: 'depth24plus',
			usage: GPUTextureUsage.RENDER_ATTACHMENT,
		});
	};
	window.addEventListener('resize', resize);
	resize();

	const shaderModule = device.createShaderModule({ code: rawShader });
	const defs = makeShaderDataDefinitions(rawShader);
	const uniforms = makeStructuredView(defs.structs.Uniforms);
	const uniformBuffer = device.createBuffer({
		size: uniforms.arrayBuffer.byteLength,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	});

	const response = await fetch('/WGSL-PBR-Shader/models/suzanne.obj');
	if (!response.ok) throw new Error("Could not find the model file!");
	const objText = await response.text();
	const meshData = parseOBJ(objText);

	const vertexBuffer = device.createBuffer({
		size: meshData.byteLength,
		usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
	});
	device.queue.writeBuffer(vertexBuffer, 0, meshData);

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
		primitive: { topology: 'triangle-list' },
		depthStencil: {
			depthWriteEnabled: true,
			depthCompare: 'less',
			format: 'depth24plus'
		},
	});

	const bindGroup = device.createBindGroup({
		layout: pipeline.getBindGroupLayout(0),
		entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
	});

	let time = 0.0;
	let lastTime = performance.now();

	function frame(now: number) {
		const deltaTime = (now - lastTime) / 1000.0;
		lastTime = now;
		time += deltaTime;
		const aspect = canvas.width / canvas.height;

		const cameraPos = [0.0, 0.0, 5.0];
		const projection = mat4.perspective(Math.PI / 4.0, aspect, 0.1, 100.0);
		const view = mat4.lookAt(
			cameraPos,
			[0.0, 0.0, 0.0],
			[0.0, 1.0, 0.0]
		);
		const model = mat4.rotationY(time);
		const mvp = mat4.mul(mat4.mul(projection, view), model);

		const lights = [
			{ position: [1.0, 6.0, -10.0], emission: [400.0, 400.0, 5500.0] },
			{ position: [2.0, 4.0, 5.0], emission: [10.0, 10.0, 5000.0] },
			{ position: [-7.0, 2.0, -8.0], emission: [250.0, 0.0, 0.0] },
		]

		uniforms.set({
			lightCount: lights.length,
			mvp,
			model,
			cameraPos,
			lights,
			time,
		});
		device!.queue.writeBuffer(uniformBuffer, 0, uniforms.arrayBuffer);

		const commandEncoder = device!.createCommandEncoder();
		const pass = commandEncoder.beginRenderPass({
			colorAttachments: [{
				view: context.getCurrentTexture().createView(),
				clearValue: { r: 0.05, g: 0.05, b: 0.05, a: 1.0 },
				loadOp: 'clear',
				storeOp: 'store',
			}],
			depthStencilAttachment: {
				view: depthTexture.createView(),
				depthClearValue: 1.0,
				depthLoadOp: 'clear',
				depthStoreOp: 'store',
			},
		});
		pass.setPipeline(pipeline);
		pass.setBindGroup(0, bindGroup);
		pass.setVertexBuffer(0, vertexBuffer);
		const vertexCount = meshData.length / 6;
		pass.draw(vertexCount);
		pass.end();

		device!.queue.submit([commandEncoder.finish()]);
		requestAnimationFrame(frame);
	}
	requestAnimationFrame(frame);
}

initWebGPU();
