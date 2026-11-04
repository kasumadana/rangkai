export const MAX_DOCUMENT_SIZE_BYTES = 8 * 1024 * 1024; // 8,388,608 bytes

export const ALLOWED_MIME_TYPES = new Set([
	"image/jpeg",
	"image/png",
	"application/pdf",
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
