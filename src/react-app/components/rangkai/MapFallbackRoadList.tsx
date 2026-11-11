import { Banner } from "@astryxdesign/core/Banner";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { List, ListItem } from "@astryxdesign/core/List";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { MapPin, Navigation } from "lucide-react";
import { OPERATIONAL_DISCLAIMERS, UX_EMPTY_COPY } from "../../lib/constants";
import type { OperationalRoadStatus } from "../../lib/road-status";
import { formatWitaRange } from "../../lib/wita";
import { LastUpdatedWita } from "./LastUpdatedWita";
import { RoadStatusBadge } from "./RoadStatusBadge";
import { StaleStatusNotice } from "./StaleStatusNotice";

export interface RoadSegmentFallbackItem {
	id: string;
	segmentName: string;
	corridorArea: string;
	impactType:
		| "closure"
		| "intermittent_flow"
		| "parking_restriction"
		| "procession_route";
	plannedFrom: string;
	plannedTo: string;
	status: OperationalRoadStatus;
	observedAt?: string | null;
	expiresAt?: string | null;
	diversionNote?: string | null;
	isSimulation?: boolean;
}

const IMPACT_TYPE_LABELS: Record<RoadSegmentFallbackItem["impactType"], string> = {
	closure: "Penutupan Sementara",
	intermittent_flow: "Pengaturan Buka-Tutup",
	parking_restriction: "Pembatasan Parkir Tepi Jalan",
	procession_route: "Jalur Prosesi / Arak-arakan",
};

/**
 * Accessible text-first road impact list using Astryx `List` + `ListItem`
 * (docs/07-UX-FLOW.md §3.B, §7, §8, NFR-011, Astryx Layout rule: rows instead of Card-per-item).
 */
export function MapFallbackRoadList({
	segments,
	showMapUnavailableNotice = false,
	now,
}: {
	segments: RoadSegmentFallbackItem[];
	showMapUnavailableNotice?: boolean;
	now?: Date;
}) {
	return (
		<VStack gap={4}>
			{showMapUnavailableNotice ? (
				<Banner
					status="info"
					collapsible={false}
					title={UX_EMPTY_COPY.MAP_UNAVAILABLE}
					description={OPERATIONAL_DISCLAIMERS.OPEN_ROAD_NOTE}
				/>
			) : null}

			{segments.length === 0 ? (
				<Card padding={4}>
					<Text size="sm" color="secondary">
						{UX_EMPTY_COPY.NO_MATCHING_ROAD}
					</Text>
				</Card>
			) : (
				<Card padding={4}>
					<List
						hasDividers
						edge="bleed"
						density="spacious"
						header={
							<Heading level={3}>
								Daftar Ruas Jalan Terdampak ({segments.length} segmen)
							</Heading>
						}
					>
						{segments.map((seg) => (
							<ListItem
								key={seg.id}
								align="start"
								startContent={
									<Icon icon={MapPin} size="sm" color="secondary" />
								}
								label={
									<HStack gap={2} vAlign="center" wrap="wrap">
										<Text weight="semibold" size="base">
											{seg.segmentName}
										</Text>
										{seg.isSimulation ? (
											<Token color="purple" size="sm" label="SIMULASI" />
										) : null}
										<Token
											color="gray"
											size="sm"
											label={IMPACT_TYPE_LABELS[seg.impactType]}
										/>
									</HStack>
								}
								description={
									<VStack gap={2}>
										<Text size="xsm" color="secondary">
											Kawasan: {seg.corridorArea} • Jadwal rencana:{" "}
											{formatWitaRange(seg.plannedFrom, seg.plannedTo)}
										</Text>

										<StaleStatusNotice
											lastKnownStatus={seg.status}
											observedAt={seg.observedAt}
											expiresAt={seg.expiresAt}
											now={now}
										/>

										{seg.diversionNote ? (
											<HStack gap={1.5} vAlign="start">
												<Icon icon={Navigation} size="xsm" color="secondary" />
												<Text size="xsm" color="secondary">
													Catatan pengalihan panitia: {seg.diversionNote}
												</Text>
											</HStack>
										) : null}

										<LastUpdatedWita
											timestamp={seg.observedAt}
											labelPrefix="Konfirmasi lapangan terakhir"
										/>
									</VStack>
								}
								endContent={
									<RoadStatusBadge
										status={seg.status}
										expiresAt={seg.expiresAt}
										now={now}
										showCongestionHint
									/>
								}
							/>
						))}
					</List>
				</Card>
			)}
		</VStack>
	);
}
