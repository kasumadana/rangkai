import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapPin, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function VenueLocationInput({
	longitude,
	latitude,
	onChange,
}: {
	longitude: string;
	latitude: string;
	onChange: (longitude: string, latitude: string) => void;
}) {
	const container = useRef<HTMLDivElement>(null);
	const mapRef = useRef<maplibregl.Map | null>(null);
	const markerRef = useRef<maplibregl.Marker | null>(null);
	const focusedRef = useRef(false);
	const changeRef = useRef(onChange);
	const [error, setError] = useState(false);
	const [mapAttempt, setMapAttempt] = useState(0);

	useEffect(() => {
		changeRef.current = onChange;
	}, [onChange]);

	useEffect(() => {
		if (!container.current) return;
		let active = true;
		let map: maplibregl.Map | null = null;
		let resizeObserver: ResizeObserver | null = null;

		try {
			map = new maplibregl.Map({
				container: container.current,
				center: [115.1889, -8.4095],
				zoom: 9.2,
				style: {
					version: 8,
					sources: {
						osm: {
							type: "raster",
							tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
							tileSize: 256,
							attribution: "© OpenStreetMap contributors",
						},
					},
					layers: [{ id: "osm", type: "raster", source: "osm" }],
				},
			});
			mapRef.current = map;
			map.addControl(new maplibregl.NavigationControl(), "top-right");
			map.on("click", (event) =>
				changeRef.current(
					event.lngLat.lng.toFixed(6),
					event.lngLat.lat.toFixed(6),
				),
			);
			map.on("load", () => {
				map?.resize();
			});
			map.on("error", () => {
				if (active) setError(true);
			});

			if (typeof ResizeObserver !== "undefined") {
				resizeObserver = new ResizeObserver(() => {
					map?.resize();
				});
				resizeObserver.observe(container.current);
			}
		} catch {
			queueMicrotask(() => {
				if (active) setError(true);
			});
			return () => {
				active = false;
			};
		}

		return () => {
			active = false;
			resizeObserver?.disconnect();
			markerRef.current?.remove();
			markerRef.current = null;
			mapRef.current = null;
			map?.remove();
		};
	}, [mapAttempt]);

	useEffect(() => {
		markerRef.current?.remove();
		markerRef.current = null;
		const lng = Number(longitude);
		const lat = Number(latitude);
		if (!longitude.trim() && !latitude.trim()) focusedRef.current = false;
		if (
			!mapRef.current ||
			!longitude.trim() ||
			!latitude.trim() ||
			!Number.isFinite(lng) ||
			!Number.isFinite(lat) ||
			lng < 114.3 ||
			lng > 115.9 ||
			lat < -8.95 ||
			lat > -7.95
		) {
			return;
		}
		markerRef.current = new maplibregl.Marker({ color: "#5C8437" })
			.setLngLat([lng, lat])
			.addTo(mapRef.current);
		if (!focusedRef.current) {
			mapRef.current.jumpTo({ center: [lng, lat], zoom: 14 });
			focusedRef.current = true;
		}
	}, [longitude, latitude, mapAttempt]);

	const lngNum = Number(longitude);
	const latNum = Number(latitude);
	const hasCoords = Boolean(longitude.trim() && latitude.trim());
	const isValidBaliCoord =
		hasCoords &&
		Number.isFinite(lngNum) &&
		Number.isFinite(latNum) &&
		lngNum >= 114.3 &&
		lngNum <= 115.9 &&
		latNum >= -8.95 &&
		latNum <= -7.95;

	return (
		<section
			aria-label="Titik lokasi acara"
			className="venue-location-input md:col-span-2"
		>
			<div className="venue-location-header">
				<div className="venue-location-title-group">
					<span className="venue-location-icon" aria-hidden="true">
						<MapPin size={16} />
					</span>
					<div>
						<h4 className="venue-location-title">Titik Koordinat Lokasi Upacara</h4>
						<p className="venue-location-subtitle">
							Klik peta untuk memilih atau memindahkan titik acara, atau masukkan koordinat secara manual.
						</p>
					</div>
				</div>
				<span
					className={`venue-location-status-pill ${
						isValidBaliCoord
							? "is-set"
							: hasCoords
								? "is-invalid"
								: "is-empty"
					}`}
				>
					{isValidBaliCoord
						? `Titik Terpilih (${latNum.toFixed(4)}°, ${lngNum.toFixed(4)}°)`
						: hasCoords
							? "Koordinat di luar wilayah Bali"
							: "Titik lokasi belum ditentukan"}
				</span>
			</div>

			{error ? (
				<p role="alert" className="venue-location-error">
					<span>Peta tidak tersedia. Masukkan koordinat secara manual.</span>
					<button
						className="teduh-btn-secondary"
						type="button"
						onClick={() => {
							setError(false);
							focusedRef.current = false;
							setMapAttempt((attempt) => attempt + 1);
						}}
					>
						Coba lagi
					</button>
				</p>
			) : null}

			<div
				ref={container}
				className="venue-location-map"
				aria-label="Peta pemilihan titik acara"
			/>

			<div className="venue-location-controls">
				<label className="venue-location-field">
					<span className="venue-location-label-text">Bujur (longitude)</span>
					<input
						className="teduh-form-input"
						type="number"
						step="any"
						placeholder="Contoh: 115.2625"
						value={longitude}
						onChange={(e) => {
							focusedRef.current = false;
							onChange(e.target.value, latitude);
						}}
					/>
				</label>
				<label className="venue-location-field">
					<span className="venue-location-label-text">Lintang (latitude)</span>
					<input
						className="teduh-form-input"
						type="number"
						step="any"
						placeholder="Contoh: -8.5069"
						value={latitude}
						onChange={(e) => {
							focusedRef.current = false;
							onChange(longitude, e.target.value);
						}}
					/>
				</label>
				<div className="venue-location-actions">
					<button
						className="teduh-btn-secondary venue-location-clear-btn"
						type="button"
						onClick={() => onChange("", "")}
					>
						<Trash2 size={14} aria-hidden="true" />
						<span>Hapus titik lokasi</span>
					</button>
				</div>
			</div>
		</section>
	);
}
