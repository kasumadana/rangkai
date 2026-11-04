export const ALLOWED_DOCUMENT_MIME_TYPES = [
	"application/pdf",
	"image/jpeg",
	"image/png",
] as const;

export type AllowedDocumentMimeType =
	(typeof ALLOWED_DOCUMENT_MIME_TYPES)[number];

export const MAX_DOCUMENT_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB (8,388,608 bytes)
export const MAX_CLEANUP_PHOTO_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB (5,242,880 bytes)
export const MAX_MULTIPART_ENVELOPE_OVERHEAD_BYTES = 64 * 1024; // 64 KB multipart framing margin

const EXTENSION_MIME_MAP: Record<string, AllowedDocumentMimeType> = {
	".pdf": "application/pdf",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
};

/**
 * Inspects file magic bytes to verify genuine content format.
 * Rejects spoofed Content-Type headers.
 */
export function detectMimeFromMagicBytes(
	bytes: Uint8Array,
): AllowedDocumentMimeType | null {
	if (bytes.byteLength < 8) {
		return null;
	}

	// PDF: %PDF- (25 50 44 46 2D)
	if (
		bytes[0] === 0x25 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x44 &&
		bytes[3] === 0x46 &&
		bytes[4] === 0x2d
	) {
		return "application/pdf";
	}

	// PNG: 89 50 4E 47 0D 0A 1A 0A
	if (
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

	// JPEG: FF D8 FF
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return "image/jpeg";
	}

	return null;
}

/**
 * Validates that the file bytes contain a complete, non-truncated structure
 * for the detected MIME type (IHDR+IEND for PNG, SOI+SOF+EOI for JPEG, %PDF-+%%EOF for PDF).
 */
export function validateBinaryFormatStructure(
	bytes: Uint8Array,
	mime: AllowedDocumentMimeType,
): boolean {
	if (mime === "image/png") {
		// Minimum valid PNG: 8-byte sig + 25-byte IHDR + 12-byte IEND = 45 bytes
		if (bytes.byteLength < 45) return false;
		// Check IHDR chunk type at offset 12..15 ('IHDR' = 0x49 0x48 0x44 0x52)
		if (
			bytes[12] !== 0x49 ||
			bytes[13] !== 0x48 ||
			bytes[14] !== 0x44 ||
			bytes[15] !== 0x52
		) {
			return false;
		}
		const view = new DataView(
			bytes.buffer,
			bytes.byteOffset,
			bytes.byteLength,
		);
		const width = view.getUint32(16, false);
		const height = view.getUint32(20, false);
		if (width < 2 || height < 2 || width > 20000 || height > 20000) return false;

		// Check IEND trailer ('IEND' + CRC AE 42 60 82) at end of file
		const n = bytes.byteLength;
		if (
			bytes[n - 8] !== 0x49 ||
			bytes[n - 7] !== 0x45 ||
			bytes[n - 6] !== 0x4e ||
			bytes[n - 5] !== 0x44 ||
			bytes[n - 4] !== 0xae ||
			bytes[n - 3] !== 0x42 ||
			bytes[n - 2] !== 0x60 ||
			bytes[n - 1] !== 0x82
		) {
			return false;
		}
		return true;
	}

	if (mime === "image/jpeg") {
		// Minimum valid JPEG with SOI, SOF, SOS, EOI
		if (bytes.byteLength < 20) return false;
		const n = bytes.byteLength;
		// Must end with EOI (FF D9)
		if (bytes[n - 2] !== 0xff || bytes[n - 1] !== 0xd9) {
			return false;
		}
		// Scan for a Start-Of-Frame marker (FF C0, FF C1, FF C2) with positive dimensions
		let hasSof = false;
		for (let i = 2; i < n - 8; i++) {
			if (
				bytes[i] === 0xff &&
				(bytes[i + 1] === 0xc0 ||
					bytes[i + 1] === 0xc1 ||
					bytes[i + 1] === 0xc2)
			) {
				const height = (bytes[i + 5] << 8) | bytes[i + 6];
				const width = (bytes[i + 7] << 8) | bytes[i + 8];
				if (width >= 2 && height >= 2 && width <= 20000 && height <= 20000) {
					hasSof = true;
					break;
				}
			}
		}
		return hasSof;
	}

	if (mime === "application/pdf") {
		if (bytes.byteLength < 16) return false;
		const tailStart = Math.max(0, bytes.byteLength - 1024);
		const tailText = new TextDecoder("latin1").decode(
			bytes.subarray(tailStart),
		);
		return tailText.includes("%%EOF");
	}

	return false;
}

/**
 * Checks whether the filename extension matches the detected MIME type.
 */
export function doesExtensionMatchMime(
	filename: string,
	mime: AllowedDocumentMimeType,
): boolean {
	const trimmed = filename.trim();
	const dotIdx = trimmed.lastIndexOf(".");
	if (dotIdx <= 0 || dotIdx === trimmed.length - 1) {
		return false;
	}
	const ext = trimmed.slice(dotIdx).toLowerCase();
	return EXTENSION_MIME_MAP[ext] === mime;
}

/**
 * Sanitizes an untrusted filename:
 * - Strips path traversal segments (../, ..\, /, \)
 * - Removes control characters and non-printable chars
 * - Replaces unsafe characters with underscores
 * - Bounds length to 120 characters
 */
export function sanitizeDocumentFilename(rawName: string): string {
	const base = rawName.split(/[/\\]/).pop() || "document";
	const nonControl = Array.from(base)
		.filter((c) => {
			const code = c.charCodeAt(0);
			return code >= 32 && code !== 127;
		})
		.join("");
	const cleaned = nonControl
		.replace(/[^a-zA-Z0-9._-]/g, "_")
		.replace(/\.{2,}/g, "_")
		.replace(/^[_.-]+/, "");

	if (!cleaned || cleaned.length === 0) {
		return "document";
	}

	if (cleaned.length > 120) {
		const extMatch = cleaned.match(/(\.[a-zA-Z0-9]{1,8})$/);
		const ext = extMatch ? extMatch[1] : "";
		return cleaned.slice(0, 120 - ext.length) + ext;
	}

	return cleaned;
}

/**
 * Generates an unguessable, scoped R2 object key:
 * events/{eventId}/documents/{documentId}/{sanitizedFilename}
 */
export function buildPrivateDocumentR2Key(
	eventId: string,
	documentId: string,
	sanitizedFilename: string,
): string {
	return `events/${eventId}/documents/${documentId}/${sanitizedFilename}`;
}

// Per-user sliding-window rate limiter for uploads (10 uploads / 10 minutes per user)
const UPLOAD_RATE_WINDOW_MS = 10 * 60 * 1000;
const UPLOAD_MAX_REQUESTS = 10;
const uploadHistory = new Map<string, number[]>();

export function checkUploadRateLimit(
	userId: string,
	nowMs = Date.now(),
): boolean {
	const timestamps = uploadHistory.get(userId) || [];
	const cutoff = nowMs - UPLOAD_RATE_WINDOW_MS;
	const recent = timestamps.filter((t) => t > cutoff);

	if (recent.length >= UPLOAD_MAX_REQUESTS) {
		uploadHistory.set(userId, recent);
		return false;
	}

	recent.push(nowMs);
	uploadHistory.set(userId, recent);
	return true;
}

export function resetUploadRateLimits(): void {
	uploadHistory.clear();
}

// Per-organization sliding-window rate limiter for AI extraction (5 requests / 10 minutes per organization)
const EXTRACTION_RATE_WINDOW_MS = 10 * 60 * 1000;
const EXTRACTION_MAX_REQUESTS = 5;
const extractionHistory = new Map<string, number[]>();

export function checkExtractionRateLimit(
	organizationId: string,
	nowMs = Date.now(),
): boolean {
	const timestamps = extractionHistory.get(organizationId) || [];
	const cutoff = nowMs - EXTRACTION_RATE_WINDOW_MS;
	const recent = timestamps.filter((t) => t > cutoff);

	if (recent.length >= EXTRACTION_MAX_REQUESTS) {
		extractionHistory.set(organizationId, recent);
		return false;
	}

	recent.push(nowMs);
	extractionHistory.set(organizationId, recent);
	return true;
}

export function resetExtractionRateLimits(): void {
	extractionHistory.clear();
}
