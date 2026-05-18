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

	const shadowDepthTextureSize = 1024;
	const maxLights = 4;

	const context = canvas.getContext('webgpu') as GPUCanvasContext;
	const format = navigator.gpu.getPreferredCanvasFormat();
	let depthTexture!: GPUTexture;
	let depthView!: GPUTextureView;
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
		depthView = depthTexture.createView();
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

	const shadowDepthTexture = device.createTexture({
		size: [shadowDepthTextureSize, shadowDepthTextureSize, 6 * maxLights],
		usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
		format: 'depth32float',
	});

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
		primitive: {
			topology: 'triangle-list',
			cullMode: 'back'
		},
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
			{ binding: 1, resource: shadowDepthTexture.createView({ dimension: 'cube-array' }) },
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
		primitive: {
			topology: 'triangle-list',
		},
		depthStencil: {
			depthWriteEnabled: true,
			depthCompare: 'less',
			format: 'depth32float',
			// depthBias: 1,
			// depthBiasSlopeScale: 1.0,
		}
	});

	const shadowBindGroup = device.createBindGroup({
		layout: shadowPipeline.getBindGroupLayout(0),
		entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
	});

	const shadowLayerViews: GPUTextureView[] = [];
	for (let i = 0; i < maxLights * 6; i++) {
		shadowLayerViews.push(shadowDepthTexture.createView({
			dimension: '2d',
			baseArrayLayer: i,
			arrayLayerCount: 1,
		}));
	}

	const origin = [0.0, 0.0, 0.0];
	const up = [0.0, 1.0, 0.0];
	let time = 0.0;
	let lastTime = performance.now();

	function frame(now: number) {
		const deltaTime = (now - lastTime) / 1000.0;
		lastTime = now;
		time += deltaTime;
		const aspect = canvas.width / canvas.height;
		const near = 0.1;
		const far = 50.0;

		const cameraPos = [0.0, 0.0, 5.0];
		const projection = mat4.perspective(Math.PI / 4.0, aspect, near, far);
		const view = mat4.lookAt(cameraPos, origin, up);
		const model = mat4.rotationY(time / 5.0);
		const mvp = mat4.mul(mat4.mul(projection, view), model);

		const activeLights = [
			{ position: [0.6, 1.7, -2.0], emission: [1000.0, 1000.0, 1000.0] },
			{ position: [2.0, 3.0, 5.0], emission: [10.0, 10.0, 5000.0] },
			{ position: [-7.0, 2.0, -8.0], emission: [250.0, 0.0, 0.0] },
		]

		const lights: any[] = [];
		for (let i = 0; i < maxLights; i++) {
			lights.push(activeLights[i] || activeLights[0]);
		}

		const shadowNear = 0.1;
		const shadowFar = 15.0;
		const shadowProjection = mat4.perspective(Math.PI / 2.0, 1.0, shadowNear, shadowFar);
		shadowProjection[5] *= -1;
		const faceDirections = [
			{ t: [1, 0, 0], u: [0, -1, 0] },
			{ t: [-1, 0, 0], u: [0, -1, 0] },
			{ t: [0, 1, 0], u: [0, 0, 1] },
			{ t: [0, -1, 0], u: [0, 0, -1] },
			{ t: [0, 0, 1], u: [0, -1, 0] },
			{ t: [0, 0, -1], u: [0, -1, 0] },
		];

		const shadowMatrices: any[] = [];
		for (let i = 0; i < maxLights; i++) {
			const light = lights[i];
			faceDirections.forEach(face => {
				const target = [
					light.position[0] + face.t[0],
					light.position[1] + face.t[1],
					light.position[2] + face.t[2]
				];
				const view = mat4.lookAt(light.position, target, face.u);
				shadowMatrices.push(mat4.mul(mat4.mul(shadowProjection, view), model));
			});
		}

		uniforms.set({
			lights,
			shadowMatrices,
			mvp,
			model,
			cameraPos,
			lightCount: activeLights.length,
			time,
		});
		device!.queue.writeBuffer(uniformBuffer, 0, uniforms.arrayBuffer);

		(renderPassDescriptor.colorAttachments as any)[0]!.view = context.getCurrentTexture().createView();
		renderPassDescriptor.depthStencilAttachment!.view = depthView;

		const vertexCount = meshData.length / 6;
		const commandEncoder = device!.createCommandEncoder();
		{
			for (let i = 0; i < activeLights.length; i++) {
				for (let j = 0; j < 6; j++) {
					const layer = i * 6 + j;
					const shadowPass = commandEncoder.beginRenderPass({
						colorAttachments: [],
						depthStencilAttachment: {
							view: shadowLayerViews[layer],
							depthClearValue: 1.0,
							depthLoadOp: 'clear',
							depthStoreOp: 'store',
						},
					});
					shadowPass.setPipeline(shadowPipeline);
					shadowPass.setBindGroup(0, shadowBindGroup);
					shadowPass.setVertexBuffer(0, vertexBuffer);
					shadowPass.draw(vertexCount, 1, 0, layer);
					shadowPass.end();
				}
			}
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
