import { Button } from "@astryxdesign/core/Button";
import { Divider } from "@astryxdesign/core/Divider";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import {
	Layout,
	LayoutContent,
	LayoutHeader,
	LayoutPanel,
} from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "@astryxdesign/core/SegmentedControl";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useQuery } from "@tanstack/react-query";
import {
	CalendarDays,
	ClipboardCheck,
	FileText,
	MapPinned,
	PlusCircle,
	Radio,
	Search,
	ShieldCheck,
} from "lucide-react";
import { useMemo, useState } from "react";
import { RouterLinkBridge } from "../components/layout/AppShellLayout";
import {
	EmptyStateCard,
	ErrorStateBanner,
	EventLifecycleBadge,
	LoadingStateBlock,
	RoadStatusBadge,
} from "../components/rangkai";
import { BaliMapTilerView } from "../features/map/BaliMapTilerView";
import type { EventLifecycleStatus } from "../lib/api-client";
import {
	fetchEventRoadImpacts,
	fetchEventsList,
	mapPublicEventToCeremonyProfile,
	type EventRecord,
} from "../lib/events-api";
import { formatWitaDateTime, formatWitaRange } from "../lib/wita";
import { SYSTEM_STATE_MESSAGES } from "../lib/constants/labels";

type StatusFilterValue = "all" | EventLifecycleStatus;

const STATUS_FILTER_OPTIONS: Array<{ value: StatusFilterValue; label: string }> =
	[
		{ value: "all", label: "Semua" },
		{ value: "active", label: "Aktif" },
		{ value: "published", label: "Diumumkan" },
		{ value: "review", label: "Review" },
		{ value: "draft", label: "Draf" },
	];

export function OrganizerDashboardPage() {
	const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("all");
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedEventId, setSelectedEventId] = useState<string>("");

	const eventsQuery = useQuery({
		queryKey: [
			"events",
			{
				status: statusFilter === "all" ? undefined : statusFilter,
			},
		],
		queryFn: () =>
			fetchEventsList({
				page: 1,
				limit: 50,
				status: statusFilter === "all" ? undefined : statusFilter,
			}),
		retry: false,
	});

	// Pure backend events from Neon PostgreSQL via Hono API
	const allEvents: EventRecord[] = useMemo(() => {
		return eventsQuery.data?.events ?? [];
	}, [eventsQuery.data]);

	const filteredEvents = useMemo(() => {
		const trimmed = searchQuery.trim().toLowerCase();
		if (!trimmed) return allEvents;
		return allEvents.filter((evt) => {
			return (
				evt.title.toLowerCase().includes(trimmed) ||
				(evt.venueName || "").toLowerCase().includes(trimmed) ||
				(evt.permitReference || "").toLowerCase().includes(trimmed)
			);
		});
	}, [allEvents, searchQuery]);

	const activeEvent = useMemo(() => {
		if (filteredEvents.length === 0) return null;
		if (selectedEventId) {
			const found = filteredEvents.find((e) => e.id === selectedEventId);
			if (found) return found;
		}
		return filteredEvents[0];
	}, [filteredEvents, selectedEventId]);

	const activeRoadImpactsQuery = useQuery({
		queryKey: ["events", activeEvent?.id, "road-impacts"],
		queryFn: () => fetchEventRoadImpacts(activeEvent!.id),
		enabled: Boolean(activeEvent?.id),
		staleTime: 30_000,
	});

	const activeInspectorVillage = useMemo(() => {
		if (!activeEvent) return null;
		return mapPublicEventToCeremonyProfile(
			{
				id: activeEvent.id,
				title: activeEvent.title,
				slug: activeEvent.publicSlug || activeEvent.id,
				category: activeEvent.category ?? null,
				description: activeEvent.description ?? null,
				venueName: activeEvent.venueName,
				startsAt: activeEvent.startsAt,
				endsAt: activeEvent.endsAt,
				status: activeEvent.status,
				publishedAt: activeEvent.publishedAt ?? null,
				organizationName: "Desa Adat",
				village: "Bali",
				district: "Bali",
			},
			activeRoadImpactsQuery.data?.roadImpacts ?? [],
		);
	}, [activeEvent, activeRoadImpactsQuery.data]);

	const quickActionTargetId = activeEvent?.id || allEvents[0]?.id || "";

	return (
		<Layout
			defaultHasDividers
			height="fill"
			header={
				<LayoutHeader hasDivider>
					<VStack gap={3}>
						<HStack justify="between" vAlign="center" wrap="wrap" gap={3}>
							<Heading level={1}>Jadwal & Pengumuman Desa</Heading>
							<HStack gap={2} wrap="wrap">
								<Button
									as={RouterLinkBridge}
									href={`/field/events/${quickActionTargetId}`}
									variant="secondary"
									size="sm"
									label="Pos Pecalang"
									icon={<Icon icon={Radio} size="sm" />}
								/>
								<Button
									as={RouterLinkBridge}
									href="/dashboard/events/new"
									variant="primary"
									size="sm"
									label="Buat Pengumuman"
									icon={<Icon icon={PlusCircle} size="sm" />}
								/>
							</HStack>
						</HStack>

						<HStack justify="between" vAlign="center" wrap="wrap" gap={3}>
							<SegmentedControl
								label="Filter status"
								value={statusFilter}
								onChange={(val) => setStatusFilter(val as StatusFilterValue)}
								size="sm"
							>
								{STATUS_FILTER_OPTIONS.map((opt) => (
									<SegmentedControlItem
										key={opt.value}
										value={opt.value}
										label={opt.label}
									/>
								))}
							</SegmentedControl>

							<TextInput
								type="search"
								label="Cari kegiatan"
								isLabelHidden
								placeholder="Cari upacara atau lokasi..."
								value={searchQuery}
								onChange={setSearchQuery}
								startIcon={Search}
								hasClear
								size="sm"
								width={240}
							/>
						</HStack>
					</VStack>
				</LayoutHeader>
			}
			content={
				<LayoutContent>
					{eventsQuery.isLoading ? (
						<VStack padding={6}>
							<LoadingStateBlock
								label={SYSTEM_STATE_MESSAGES.loadingData.description}
								rows={4}
							/>
						</VStack>
					) : eventsQuery.isError ? (
						<VStack padding={6}>
							<ErrorStateBanner
								title="Gagal Memuat Jadwal Upacara"
								error={eventsQuery.error}
								onRetry={() => {
									void eventsQuery.refetch();
								}}
							/>
						</VStack>
					) : filteredEvents.length === 0 ? (
						<VStack padding={6}>
							<EmptyStateCard
								title={SYSTEM_STATE_MESSAGES.noEvents.title}
								description={SYSTEM_STATE_MESSAGES.noEvents.description}
								actions={
									<Button
										variant="secondary"
										size="sm"
										label={SYSTEM_STATE_MESSAGES.noEvents.primaryAction || "Reset Filter"}
										onClick={() => {
											setStatusFilter("all");
											setSearchQuery("");
										}}
									/>
								}
							/>
						</VStack>
					) : (
						<List hasDividers density="spacious">
							{filteredEvents.map((evt) => {
								const scheduleText =
									evt.startsAt && evt.endsAt
										? formatWitaRange(evt.startsAt, evt.endsAt)
										: evt.startsAt
											? formatWitaDateTime(evt.startsAt)
											: "Jadwal belum diisi";

								return (
									<ListItem
										key={evt.id}
										align="center"
										startContent={<Icon icon={CalendarDays} size="sm" />}
										label={
											<HStack gap={2} vAlign="center" wrap="wrap">
												<Text type="label" size="base">
													{evt.title}
												</Text>
												<EventLifecycleBadge status={evt.status} />
											</HStack>
										}
										description={`${evt.venueName || "Lokasi belum diisi"} • ${scheduleText}`}
										endContent={
											<HStack gap={1.5} vAlign="center">
												<Button
													variant={activeEvent?.id === evt.id ? "primary" : "ghost"}
													size="sm"
													label="Pratinjau"
													onClick={() => {
														setSelectedEventId(evt.id);
													}}
												/>
												<Button
													as={RouterLinkBridge}
													href={`/dashboard/events/${evt.id}`}
													variant="secondary"
													size="sm"
													label="Kelola"
												/>
											</HStack>
										}
									/>
								);
							})}
						</List>
					)}
				</LayoutContent>
			}
			end={
				<LayoutPanel
					width={380}
					hasDivider
					isScrollable
					label="Ringkasan Peta & Tindakan Cepat"
				>
					{activeInspectorVillage && activeEvent ? (
						<VStack gap={4}>
							<HStack justify="between" vAlign="start" gap={2}>
								<VStack gap={0.5}>
									<Text type="supporting" size="xsm">
										{activeInspectorVillage.desaAdatName} •{" "}
										{activeInspectorVillage.scheduleWindowWita}
									</Text>
									<Heading level={2}>
										{activeInspectorVillage.ceremonyTitle}
									</Heading>
								</VStack>
								<RoadStatusBadge status={activeInspectorVillage.primaryStatus} />
							</HStack>

							<BaliMapTilerView village={activeInspectorVillage} height={220} />

							<VStack gap={1.5}>
								<Text type="label" size="xsm" color="secondary">
									Ruas Jalan Terdampak ({activeInspectorVillage.roadSegments.length})
								</Text>
								{activeInspectorVillage.roadSegments.length > 0 ? (
									<List hasDividers edge="bleed" density="compact">
										{activeInspectorVillage.roadSegments.map((seg) => (
											<ListItem
												key={seg.id}
												label={seg.roadName}
												description={seg.windowWita}
												endContent={<RoadStatusBadge status={seg.status} />}
											/>
										))}
									</List>
								) : (
									<Text size="sm" color="secondary">
										Belum ada ruas jalan terdampak yang diverifikasi.
									</Text>
								)}
							</VStack>

							<Divider variant="subtle" />

							<VStack gap={2}>
								<Text type="label" size="xsm" color="secondary">
									Tindakan Cepat
								</Text>
								<HStack gap={2} wrap="wrap">
									<Button
										as={RouterLinkBridge}
										href={`/dashboard/events/${activeEvent.id}`}
										variant="secondary"
										size="sm"
										label="Surat Edaran"
										icon={<Icon icon={FileText} size="sm" />}
									/>
									<Button
										as={RouterLinkBridge}
										href={`/dashboard/events/${activeEvent.id}/roads`}
										variant="secondary"
										size="sm"
										label="Atur Rute"
										icon={<Icon icon={MapPinned} size="sm" />}
									/>
									<Button
										as={RouterLinkBridge}
										href={`/field/events/${activeEvent.id}`}
										variant="secondary"
										size="sm"
										label="Pecalang"
										icon={<Icon icon={ShieldCheck} size="sm" />}
									/>
									<Button
										as={RouterLinkBridge}
										href={`/dashboard/events/${activeEvent.id}/cleanup`}
										variant="secondary"
										size="sm"
										label="Kebersihan"
										icon={<Icon icon={ClipboardCheck} size="sm" />}
									/>
								</HStack>
							</VStack>
						</VStack>
					) : (
						<VStack gap={3}>
							<Heading level={2}>Ringkasan Wilayah</Heading>
							<Text size="sm" color="secondary">
								Pilih salah satu kegiatan upacara pada daftar di sebelah kiri untuk melihat peta spasial dan tindakan cepat.
							</Text>
						</VStack>
					)}
				</LayoutPanel>
			}
		/>
	);
}
