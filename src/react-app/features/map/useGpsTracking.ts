import { useCallback, useEffect, useRef, useState } from "react";
import { isWithinBaliBounds } from "../../lib/routing-engine";

export function useGpsTracking() {
	const watch = useRef<number | null>(null);
	const generation = useRef(0);
	const [active, setActive] = useState(false);
	const [following, setFollowing] = useState(false);
	const [position, setPosition] = useState<{ coordinates: [number, number]; accuracy: number } | null>(null);
	const [error, setError] = useState("");
	const stop = useCallback(() => {
		generation.current++;
		if (watch.current !== null) navigator.geolocation?.clearWatch(watch.current);
		watch.current = null; setActive(false); setFollowing(false); setPosition(null);
	}, []);
	const start = useCallback(() => {
		if (watch.current !== null) return;
		if (!window.isSecureContext) {
			setError("GPS memerlukan HTTPS di HP. Alamat HTTP jaringan lokal tidak dapat meminta lokasi.");
			return;
		}
		if (!navigator.geolocation) { setError("GPS tidak tersedia di perangkat ini."); return; }
		setError(""); setActive(true); setFollowing(true);
		const id = ++generation.current;
		try { watch.current = navigator.geolocation.watchPosition((result) => {
			if (generation.current !== id) return;
			const coordinates: [number, number] = [result.coords.longitude, result.coords.latitude];
			if (!coordinates.every(Number.isFinite) || !isWithinBaliBounds(coordinates)) { setPosition(null); setError("Lokasi berada di luar cakupan peta Bali."); return; }
			setError(""); setPosition({ coordinates, accuracy: result.coords.accuracy });
		}, (failure) => {
			if (generation.current !== id) return;
			if (failure.code === 1) {
				stop();
				setError("Izin lokasi ditolak. Aktifkan izin lokasi di peramban dan coba lagi.");
				return;
			}
			setPosition(null);
			setError(failure.code === 3
				? "GPS masih mencari lokasi. Pelacakan tetap aktif dan akan mencoba lagi."
				: "Lokasi belum tersedia. Periksa GPS; pelacakan tetap aktif dan akan mencoba lagi.");
		}, { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }); }
		catch { stop(); setError("GPS tidak tersedia di perangkat ini. Coba lagi."); }
	}, [stop]);
	useEffect(() => {
		const hidden = () => { if (document.visibilityState === "hidden") stop(); };
		document.addEventListener("visibilitychange", hidden);
		return () => { document.removeEventListener("visibilitychange", hidden); stop(); };
	}, [stop]);
	const pauseFollowing = useCallback(() => setFollowing(false), []);
	const resumeFollowing = useCallback(() => setFollowing(true), []);
	return { active, following, position, error, start, stop, pauseFollowing, resumeFollowing };
}
