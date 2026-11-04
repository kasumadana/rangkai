export const MAX_DOCUMENT_SIZE_BYTES = 8 * 1024 * 1024; // 8,388,608 bytes (8 MB)
export const MAX_PHOTO_SIZE_BYTES = 5 * 1024 * 1024; // 5,242,880 bytes (5 MB)

export const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
	"image/jpeg",
	"image/png",
	"application/pdf",
]);

export const ALLOWED_DOCUMENT_EXTENSIONS = new Set([
	".jpg",
	".jpeg",
	".png",
	".pdf",
]);

export const ALLOWED_PHOTO_MIME_TYPES = new Set([
	"image/jpeg",
	"image/png",
]);

export const ALLOWED_PHOTO_EXTENSIONS = new Set([
	".jpg",
	".jpeg",
	".png",
]);

export function detectMimeTypeFromMagicBytes(bytes: Uint8Array): string | null {
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return "image/jpeg";
	}
	if (
		bytes.length >= 8 &&
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47 &&
		bytes[4] === 0x0d &&
		bytes[5] === 0x0a &&
		bytes[6] === 0x1a &&
		bytes[7] === 0x0a
	) {
		return "image/png";
	}
	if (
		bytes.length >= 4 &&
		bytes[0] === 0x25 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x44 &&
		bytes[3] === 0x46
	) {
		return "application/pdf";
	}
	return null;
}

export function sanitizeFilename(name: string): string {
	const base = name.replace(/^.*[\\/]/, "");
	const cleaned = base.replace(/[\0\r\n\t]/g, "").trim();
	return cleaned.length > 0 ? cleaned.slice(0, 255) : "document";
}

/**
 * Stream-bounds request body to prevent unbounded buffering or chunked DOS.
 * Reads up to maxBytes; if the stream exceeds maxBytes, immediately cancels the reader
 * and returns FILE_TOO_LARGE error without exhausting worker memory.
 */
export async function readBoundedRequestBody(
	request: Request,
	maxBytes: number,
): Promise<{ buffer: ArrayBuffer; error?: undefined } | { buffer?: undefined; error: "FILE_TOO_LARGE" }> {
	const body = request.body;
	if (!body) {
		return { buffer: new ArrayBuffer(0) };
	}

	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let totalBytes = 0;

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value) {
				totalBytes += value.byteLength;
				if (totalBytes > maxBytes) {
					await reader.cancel();
					return { error: "FILE_TOO_LARGE" };
				}
				chunks.push(value);
			}
		}
	} catch {
		return { error: "FILE_TOO_LARGE" };
	}

	const merged = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}

	return { buffer: merged.buffer };
}

// In-memory per-user sliding window upload limiter (max 10 uploads per 60s)
const userUploadTimestamps = new Map<string, number[]>();

export function checkUploadRateLimit(userId: string, maxUploads = 10, windowMs = 60000): boolean {
	const now = Date.now();
	const timestamps = (userUploadTimestamps.get(userId) || []).filter(
		(t) => now - t < windowMs,
	);
	if (timestamps.length >= maxUploads) {
		userUploadTimestamps.set(userId, timestamps);
		return false;
	}
	timestamps.push(now);
	userUploadTimestamps.set(userId, timestamps);
	return true;
}

export function resetUploadRateLimits(): void {
	userUploadTimestamps.clear();
}

// In-memory per-user sliding window extraction limiter (max 5 extractions per 10 minutes)
const userExtractionTimestamps = new Map<string, number[]>();

export function checkExtractionRateLimit(
	userId: string,
	maxExtractions = 5,
	windowMs = 10 * 60 * 1000,
): boolean {
	const now = Date.now();
	const timestamps = (userExtractionTimestamps.get(userId) || []).filter(
		(t) => now - t < windowMs,
	);
	if (timestamps.length >= maxExtractions) {
		userExtractionTimestamps.set(userId, timestamps);
		return false;
	}
	timestamps.push(now);
	userExtractionTimestamps.set(userId, timestamps);
	return true;
}

export function resetExtractionRateLimits(): void {
	userExtractionTimestamps.clear();
}
