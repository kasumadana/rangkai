import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Map, setWorkerUrl } from "maplibre-gl";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { DashboardRoadMapInput } from "../../../src/react-app/features/map/DashboardRoadMapInput";

setWorkerUrl(mapWorkerUrl);
const addSource = Map.prototype.addSource;
Map.prototype.addSource = function (...args) {
 window.testMap = this;
 return addSource.apply(this, args);
};
const geometry = { type: "LineString", coordinates: [[115.214, -8.6559], [115.2198, -8.6559]] };
const segment = { id: "segment-test", displayName: "Jalan Katalog Sintetis", coverageArea: "Uji", verifiedBy: "test", verifiedAt: "2030-01-01T00:00:00Z", geometry: { type: "LineString", coordinates: [[115.214, -8.6548], [115.2198, -8.6548]] } };
const impact = { id: "impact-test", roadSegmentId: segment.id, displayName: "Jalan Dampak Sintetis", impactType: "closure", plannedFrom: "2030-01-01T01:00:00Z", plannedTo: "2030-01-01T03:30:00Z", diversionNote: null, geometry, operationalStatus: { effectiveStatus: "closed", rawStatus: "closed", isStale: false, observedAt: "2030-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z" } };
export function Harness() {
 const [mode, setMode] = useState("catalog");
 const [points, setPoints] = useState([]);
 return <DashboardRoadMapInput mode={mode} onModeChange={setMode} catalogSegments={[segment]} roadImpacts={[impact]} drawnCoordinates={points} onChangeDrawnCoordinates={setPoints} />;
}
createRoot(document.getElementById("root")).render(<Harness />);
