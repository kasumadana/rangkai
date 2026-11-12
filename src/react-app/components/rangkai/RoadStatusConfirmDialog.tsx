import { useEffect, useRef } from "react";

export function RoadStatusConfirmDialog({ roadName, nextStatus, pending, onCancel, onConfirm }: {
	roadName: string | null;
	nextStatus: "open" | "intermittent" | "closed" | null;
	pending: boolean;
	onCancel: () => void;
	onConfirm: () => void;
}) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;
		if (roadName !== null && !dialog.open) dialog.showModal();
		if (roadName === null && dialog.open) dialog.close();
	}, [roadName]);

	return <dialog ref={dialogRef} aria-labelledby="road-status-dialog-title" aria-describedby="road-status-dialog-description"
		className="m-auto w-[min(92vw,32rem)] rounded-2xl bg-white p-6 text-stone-900 shadow-xl backdrop:bg-black/50"
		onCancel={(event) => { if (pending) event.preventDefault(); }} onClose={onCancel}>
		<h2 id="road-status-dialog-title" className="text-xl font-semibold">Konfirmasi Perubahan Status Jalan</h2>
		<p id="road-status-dialog-description" className="mt-2 text-stone-600">{roadName && nextStatus ? `Ubah status "${roadName}" menjadi ${nextStatus.toUpperCase()}? Pembaruan akan dicatat pada log audit dan langsung tampil di peta publik.` : ""}</p>
		<div className="mt-6 flex flex-wrap justify-end gap-3">
			<button type="button" className="teduh-btn-secondary" disabled={pending} onClick={onCancel}>Batal</button>
			<button type="button" className={nextStatus === "closed" ? "teduh-btn-primary bg-red-700 text-white" : "teduh-btn-primary"} disabled={pending} onClick={onConfirm}>{pending ? "Menyimpan..." : "Simpan Status"}</button>
		</div>
	</dialog>;
}
