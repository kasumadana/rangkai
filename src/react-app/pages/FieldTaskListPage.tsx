import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { Layout, LayoutContent, LayoutHeader } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ClipboardCheck, Radio } from "lucide-react";
import { useNavigate } from "react-router";
import { EmptyStateCard, LoadingStateBlock } from "../components/rangkai";
import { fetchFieldTasks } from "../lib/events-api";
import { formatWitaRange } from "../lib/wita";

export function FieldTaskListPage() {
	const navigate = useNavigate();

	const {
		data,
		isLoading,
		isError,
		error,
		refetch,
	} = useQuery({
		queryKey: ["field", "tasks"],
		queryFn: fetchFieldTasks,
		staleTime: 15_000,
		retry: false,
	});

	const assignments = data?.assignments ?? [];

	return (
		<Layout
			defaultHasDividers
			height="fill"
			contentWidth={760}
			header={
				<LayoutHeader hasDivider>
					<HStack justify="between" vAlign="center" wrap="wrap" gap={2}>
						<VStack gap={1}>
							<Heading level={1}>Penugasan Lapangan Desa Adat</Heading>
							<Text type="supporting" size="sm">
								Daftar kegiatan yang menugaskan Anda sebagai Pecalang (pengaturan lalu lintas) atau Petugas Kebersihan.
							</Text>
						</VStack>
					</HStack>
				</LayoutHeader>
			}
			content={
				<LayoutContent>
					<VStack gap={4}>
						<Banner
							status="info"
							collapsible={false}
							title="Pedoman Koordinasi Operasional Lapangan"
							description="Pembaruan status ruas jalan berlaku 30 menit per SPO. Rangkai adalah instrumen koordinasi internal desa adat dan bukan pengganti wewenang penutupan jalan resmi kepolisian atau Dishub."
						/>

						{isLoading ? (
							<LoadingStateBlock label="Memuat daftar penugasan lapangan..." rows={3} />
						) : isError ? (
							<VStack gap={3}>
								<Banner
									status="error"
									collapsible={false}
									title="Gagal Memuat Penugasan"
									description={
										error instanceof Error
											? error.message
											: "Terjadi kesalahan saat memuat data penugasan lapangan."
									}
								/>
								<HStack gap={2}>
									<Button
										variant="secondary"
										size="sm"
										label="Coba Lagi"
										onClick={() => void refetch()}
									/>
									<Button
										variant="primary"
										size="sm"
										label="Masuk Akun Petugas"
										onClick={() => navigate("/login")}
									/>
								</HStack>
							</VStack>
						) : assignments.length === 0 ? (
							<EmptyStateCard
								title="Belum Ada Penugasan Kegiatan"
								description="Anda belum terdaftar dalam penugasan Pos Pecalang maupun Kebersihan pada kegiatan manapun. Hubungi Prajuru Desa Adat Anda untuk menerima tautan undangan tugas lapangan."
								actions={
									<Button
										variant="secondary"
										size="sm"
										label="Lihat Jadwal Upacara Se-Bali"
										onClick={() => navigate("/events")}
									/>
								}
							/>
						) : (
							<List hasDividers edge="bleed" density="spacious">
								{assignments.map((task) => (
									<ListItem
										key={`${task.eventId}-${task.assignmentId ?? "oversight"}`}
										startContent={
											<Icon
												icon={task.canUpdateTraffic ? Radio : ClipboardCheck}
												size="md"
											/>
										}
										label={
											<HStack gap={2} vAlign="center" wrap="wrap">
												<Text weight="semibold">
													{task.eventTitle}
												</Text>
												{task.isSimulation ? (
													<Token color="orange" size="sm" label="SIMULASI" />
												) : null}
											</HStack>
										}
										description={
											<VStack gap={1.5}>
												<Text type="supporting" size="sm">
													{task.organizationName} • {task.venueName || "Lokasi Acara"} •{" "}
													{formatWitaRange(task.startsAt, task.endsAt)}
												</Text>
												<HStack gap={1.5} wrap="wrap">
													{task.canUpdateTraffic ? (
														<Token color="blue" size="sm" label="Pos Pecalang (Jalan)" />
													) : null}
													{task.canUpdateCleanup ? (
														<Token color="green" size="sm" label="Tim Kebersihan" />
													) : null}
													{task.isOrganizerOversight ? (
														<Token color="purple" size="sm" label="Prajuru Desa" />
													) : null}
												</HStack>
											</VStack>
										}
										endContent={
											<Button
												variant="primary"
												size="sm"
												label="Buka Pos Jaga"
												icon={<Icon icon={ArrowRight} size="sm" />}
												onClick={() => {
													navigate(`/field/events/${task.eventId}`);
												}}
											/>
										}
									/>
								))}
							</List>
						)}
					</VStack>
				</LayoutContent>
			}
		/>
	);
}
