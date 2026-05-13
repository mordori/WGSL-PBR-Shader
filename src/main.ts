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
	let depthTexture!: GPUTexture;
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

	const response = await fetch('/WGSL-PBR-Shader/models/suzanne.obj');
	if (!response.ok) throw new Error("Could not find the model file!");
	const objText = await response.text();
	const meshData = parseOBJ(objText);

	const shaderModule = device.createShaderModule({ code: rawShader });
	const defs = makeShaderDataDefinitions(rawShader);
	const uniforms = makeStructuredView(defs.structs.Uniforms);
	const uniformBuffer = device.createBuffer({
		size: uniforms.arrayBuffer.byteLength,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	});

	const vertexBuffer = device.createBuffer({
		size: meshData.byteLength,
		usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
	});
	device.queue.writeBuffer(vertexBuffer, 0, meshData);

	const shadowDepthTextureSize = 1024;
	const shadowDepthTexture = device.createTexture({
		size: [shadowDepthTextureSize, shadowDepthTextureSize, 1],
		usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
		format: 'depth32float',
	});

	const shadowPassDescriptor: GPURenderPassDescriptor = {
		colorAttachments: [],
		depthStencilAttachment: {
			view: shadowDepthTexture.createView(),
			depthClearValue: 1.0,
			depthLoadOp: 'clear',
			depthStoreOp: 'store',
		},
	};

	const renderPassDescriptor: GPURenderPassDescriptor = {
		colorAttachments: [{
			view: undefined as any,
			clearValue: { r: 0.05, g: 0.05, b: 0.05, a: 1.0 },
			loadOp: 'clear',
			storeOp: 'store',
		}],
		depthStencilAttachment: {
			view: undefined as any,
			depthClearValue: 1.0,
			depthLoadOp: 'clear',
			depthStoreOp: 'store',
		},
	};

	const renderPipeline = device.createRenderPipeline({
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

	const renderBindGroup = device.createBindGroup({
		layout: renderPipeline.getBindGroupLayout(0),
		entries: [
			{ binding: 0, resource: { buffer: uniformBuffer } },
			{ binding: 1, resource: shadowDepthTexture.createView() },
			{
				binding: 2, resource: device.createSampler({
					compare: 'less',
					magFilter: 'linear',
					minFilter: 'linear',
				})
			},
		]
	});

	const shadowPipeline = device.createRenderPipeline({
		layout: 'auto',
		vertex: {
			module: shaderModule,
			entryPoint: 'vertex_shadow',
			buffers: [{
				arrayStride: 24,
				attributes: [
					{ shaderLocation: 0, offset: 0, format: 'float32x3' },
				]
			}]
		},
		primitive: { topology: 'triangle-list' },
		depthStencil: {
			depthWriteEnabled: true,
			depthCompare: 'less',
			format: 'depth32float',
		}
	});

	const shadowBindGroup = device.createBindGroup({
		layout: shadowPipeline.getBindGroupLayout(0),
		entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
	});

	const origin = [0.0, 0.0, 0.0];
	const up = [0.0, 1.0, 0.0];
	let time = 0.0;
	let lastTime = performance.now();

	function frame(now: number) {
		const deltaTime = (now - lastTime) / 1000.0;
		lastTime = now;
		time += deltaTime;
		const aspect = canvas.width / canvas.height;

		const cameraPos = [0.0, 0.0, 5.0];
		const projection = mat4.perspective(Math.PI / 4.0, aspect, 0.1, 100.0);
		const view = mat4.lookAt(cameraPos, origin, up);
		const model = mat4.rotationY(time);
		const mvp = mat4.mul(mat4.mul(projection, view), model);

		// const dirLight = { position: [1.0, 6.0, -10.0], emission: [400.0, 400.0, 5500.0] };
		const dirLight = { position: [3.0, 1.0, 5.0], emission: [10.0, 10.0, 5000.0] };
		const dirLightView = mat4.lookAt(dirLight.position, origin, up);
		const dirLightProjection = mat4.create();
		{
			const left = -2;
			const right = 2;
			const bottom = -2;
			const top = 2;
			const near = 0.1;
			const far = 50.0;
			mat4.ortho(left, right, bottom, top, near, far, dirLightProjection);
		}
		const dirLight_mvp = mat4.mul(mat4.mul(dirLightProjection, dirLightView), model);

		const lights = [
			// { position: [2.0, 4.0, 5.0], emission: [10.0, 10.0, 5000.0] },
			{ position: [-7.0, 2.0, -8.0], emission: [250.0, 0.0, 0.0] },
		]

		uniforms.set({
			lights,
			dirLight,
			dirLight_mvp,
			mvp,
			model,
			cameraPos,
			lightCount: lights.length,
			time,
		});
		device!.queue.writeBuffer(uniformBuffer, 0, uniforms.arrayBuffer);

		renderPassDescriptor.colorAttachments[0]!.view = context.getCurrentTexture().createView();
		renderPassDescriptor.depthStencilAttachment!.view = depthTexture.createView();

		const vertexCount = meshData.length / 6;
		const commandEncoder = device!.createCommandEncoder();
		{
			const shadowPass = commandEncoder.beginRenderPass(shadowPassDescriptor);
			shadowPass.setPipeline(shadowPipeline);
			shadowPass.setBindGroup(0, shadowBindGroup);
			shadowPass.setVertexBuffer(0, vertexBuffer);
			shadowPass.draw(vertexCount);
			shadowPass.end();
		}
		{
			const renderPass = commandEncoder.beginRenderPass(renderPassDescriptor);
			renderPass.setPipeline(renderPipeline);
			renderPass.setBindGroup(0, renderBindGroup);
			renderPass.setVertexBuffer(0, vertexBuffer);
			renderPass.draw(vertexCount);
			renderPass.end();
		}

		device!.queue.submit([commandEncoder.finish()]);
		requestAnimationFrame(frame);
	}
	requestAnimationFrame(frame);
}

initWebGPU();
