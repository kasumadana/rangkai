export function shouldLoadCleanupTasks(pathname: string, isOrganizer: boolean, canCleanup: boolean) {
 return /\/cleanup(?:\/[^/]+)?$/.test(pathname) || (pathname.startsWith("/field") && !isOrganizer && canCleanup);
}
export function validateCleanupPhoto(file: Pick<File, "type" | "size">): void {
 if (!["image/jpeg", "image/png"].includes(file.type)) throw new Error("Gunakan foto JPEG atau PNG. WebP/HEIC belum didukung.");
 if (file.size === 0) throw new Error("Foto kosong. Pilih foto lain.");
 if (file.size > 5 * 1024 * 1024) throw new Error("Ukuran foto maksimal 5 MB.");
}
