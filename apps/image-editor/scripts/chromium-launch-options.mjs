export function chromiumLaunchOptions(options = {}) {
	const executablePath = process.env.CH5_IMAGE_EDITOR_CHROMIUM_EXECUTABLE;
	return {
		...(executablePath ? { executablePath } : { channel: "chrome" }),
		...options
	};
}
