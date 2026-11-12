import { Clock } from "lucide-react";
import { useState } from "react";
import { formatRelativeAgeId, formatWitaDateTime, parseDate } from "../../lib/wita";

export interface LastUpdatedWitaProps {
	timestamp: string | number | Date | null | undefined;
	labelPrefix?: string;
	showRelative?: boolean;
}

export function LastUpdatedWita({ timestamp, labelPrefix = "Pembaruan terakhir", showRelative = true }: LastUpdatedWitaProps) {
	const [copyMessage, setCopyMessage] = useState("");
	const parsed = parseDate(timestamp);
	if (!parsed) return <p className="inline-flex items-center gap-1.5 text-xs text-stone-600"><Clock size={14} aria-hidden="true" />{labelPrefix}: Belum ada catatan waktu</p>;
	const wita = formatWitaDateTime(parsed);
	const utc = parsed.toISOString();
	async function copy(value: string) {
		try { await navigator.clipboard.writeText(value); setCopyMessage("Waktu disalin."); }
		catch { setCopyMessage("Tidak dapat menyalin. Pilih dan salin waktu secara manual."); }
	}
	return <div className="text-xs text-stone-600">
		<p className="inline-flex flex-wrap items-center gap-1.5"><Clock size={14} aria-hidden="true" />{labelPrefix}: <time dateTime={utc}>{wita}</time>{showRelative ? ` (${formatRelativeAgeId(parsed)})` : null}</p>
		<details className="mt-1"><summary className="cursor-pointer">Lihat zona waktu</summary>
			<p>WITA: {wita} <button type="button" className="underline" onClick={() => void copy(wita)}>Salin WITA</button></p>
			<p>UTC: <time dateTime={utc}>{utc}</time> <button type="button" className="underline" onClick={() => void copy(utc)}>Salin UTC</button></p>
			<p role="status">{copyMessage}</p>
		</details>
	</div>;
}
