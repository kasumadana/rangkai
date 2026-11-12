import { LocateFixed } from "lucide-react";
import type { useGpsTracking } from "./useGpsTracking";

export function GpsControls({ gps, fullMap = false }: { gps: ReturnType<typeof useGpsTracking>; fullMap?: boolean }) {
	return <div className={`landing-gps-controls ${fullMap ? "map-full-gps" : ""}`}>
		<button type="button" className="landing-gps-button" aria-label={gps.active ? "Hentikan pelacakan lokasi" : "Aktifkan pelacakan lokasi"} aria-pressed={gps.active} onClick={() => gps.active ? gps.stop() : gps.start()}><LocateFixed size={20} aria-hidden="true" /></button>
		{gps.active && !gps.following && gps.position ? <button type="button" className="teduh-btn-secondary" onClick={gps.resumeFollowing}>Ikuti lokasi</button> : null}
		{gps.error ? <p role="alert">{gps.error}</p> : null}
	</div>;
}
