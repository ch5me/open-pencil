export const chromiumGpuArguments = process.platform === "darwin" ?
	["--enable-unsafe-webgpu", "--use-angle=metal"] :
	["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer", "--use-angle=vulkan"];
