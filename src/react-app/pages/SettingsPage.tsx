import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Divider } from "@astryxdesign/core/Divider";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import {
	Layout,
	LayoutContent,
	LayoutHeader,
} from "@astryxdesign/core/Layout";
import {
	MetadataList,
	MetadataListItem,
} from "@astryxdesign/core/MetadataList";
import { Selector } from "@astryxdesign/core/Selector";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import {
	ArrowLeft,
	Clock,
	Database,
	Globe,
	KeyRound,
	LogOut,
	ShieldCheck,
	Sparkles,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { RouterLinkBridge } from "../components/layout/AppShellLayout";
import { useAuthSession, useSignOutMutation } from "../lib/auth";
import {
	getSavedOrganizationId,
	saveOrganizationId,
} from "../lib/events-api";

const DESA_ADAT_OPTIONS = [
	{
		value: "11111111-1111-4111-8111-111111111111",
		label: "Banjar Uji Coba / Desa Adat Simulasi (Pangkalan Data Neon)",
	},
	{
		value: "00000000-0000-4000-8000-000000000001",
		label: "Desa Adat Ubud (Gianyar)",
	},
	{
		value: "550e8400-e29b-41d4-a716-446655440000",
		label: "Desa Adat Padangtegal (Gianyar)",
	},
	{
		value: "550e8400-e29b-41d4-a716-446655440001",
		label: "Desa Adat Intaran Sanur (Denpasar)",
	},
	{
		value: "550e8400-e29b-41d4-a716-446655440002",
		label: "Desa Adat Kuta (Badung)",
	},
];

export function SettingsPage() {
	const navigate = useNavigate();
	const { data: sessionData, isLoading: isSessionLoading } = useAuthSession();
	const signOutMutation = useSignOutMutation();

	const [selectedOrgId, setSelectedOrgId] = useState(() => {
		return getSavedOrganizationId() || DESA_ADAT_OPTIONS[0].value;
	});
	const [saveFeedback, setSaveFeedback] = useState<string | null>(null);

	function handleOrgChange(nextId: string) {
		setSelectedOrgId(nextId);
		saveOrganizationId(nextId);
		setSaveFeedback("Desa Adat aktif berhasil diperbarui.");
		setTimeout(() => setSaveFeedback(null), 3000);
	}

	const activeOrgLabel =
		DESA_ADAT_OPTIONS.find((o) => o.value === selectedOrgId)?.label ||
		selectedOrgId;

	return (
		<Layout
			defaultHasDividers
			height="fill"
			contentWidth={760}
			header={
				<LayoutHeader hasDivider>
					<HStack justify="between" vAlign="center" wrap="wrap" gap={2}>
						<HStack gap={2} vAlign="center">
							<Button
								as={RouterLinkBridge}
								href="/dashboard"
								variant="ghost"
								size="sm"
								label="Kembali ke Panel"
								icon={<Icon icon={ArrowLeft} size="sm" />}
							/>
							<Heading level={1}>Pengaturan Akun & Desa Adat</Heading>
						</HStack>
						<Token color="gray" size="sm" label="Sesi Terotentikasi" />
					</HStack>
				</LayoutHeader>
			}
			content={
				<LayoutContent>
					<VStack gap={5}>
						{saveFeedback ? (
							<Banner
								status="success"
								collapsible={false}
								title="Pengaturan Disimpan"
								description={saveFeedback}
							/>
						) : null}

						{/* 1. Profil Pengguna */}
						<VStack gap={3}>
							<Heading level={2}>Profil Petugas Desa Adat</Heading>
							{!isSessionLoading && sessionData?.user ? (
								<MetadataList columns={2}>
									<MetadataListItem label="Nama Petugas">
										{sessionData.user.name || "Prajuru Desa Adat"}
									</MetadataListItem>
									<MetadataListItem label="Alamat Surel">
										{sessionData.user.email}
									</MetadataListItem>
									<MetadataListItem label="ID Akun">
										<Text size="xsm" type="supporting">
											{sessionData.user.id}
										</Text>
									</MetadataListItem>
									<MetadataListItem label="Status Verifikasi">
										<HStack gap={1} vAlign="center">
											<Icon icon={ShieldCheck} size="xsm" />
											<Text size="sm">
												{sessionData.user.emailVerified
													? "Terverifikasi"
													: "Aktif (Otoritas Panitia)"}
											</Text>
										</HStack>
									</MetadataListItem>
								</MetadataList>
							) : (
								<Banner
									status="info"
									collapsible={false}
									title="Sesi Tamu Terbuka"
									description="Anda sedang mengakses dalam mode peninjauan. Masuk akun untuk mendapatkan hak akses mutasi resmi."
								/>
							)}

							<HStack justify="end">
								{!isSessionLoading && sessionData?.user ? (
									<Button
										variant="destructive"
										size="sm"
										label="Keluar dari Akun"
										icon={<Icon icon={LogOut} size="sm" />}
										isLoading={signOutMutation.isPending}
										onClick={() => {
											signOutMutation.mutate(undefined, {
												onSuccess: () => navigate("/login"),
											});
										}}
									/>
								) : (
									<Button
										as={RouterLinkBridge}
										href="/login"
										variant="primary"
										size="sm"
										label="Masuk Akun Petugas"
										icon={<Icon icon={KeyRound} size="sm" />}
									/>
								)}
							</HStack>
						</VStack>

						<Divider variant="subtle" />

						{/* 2. Pemilihan Organisasi Desa Adat Aktif */}
						<VStack gap={3}>
							<Heading level={2}>Desa Adat & Organisasi Kerja</Heading>
							<Text size="sm" type="supporting">
								Pilih Desa Adat yang aktif digunakan untuk pembuatan draf pengumuman
								dan pengelolaan ruas jalan.
							</Text>

							<Selector
								label="Desa Adat Penyelenggara Aktif"
								value={selectedOrgId}
								onChange={handleOrgChange}
								options={DESA_ADAT_OPTIONS}
							/>

							<Text size="xsm" type="supporting">
								Desa aktif saat ini: {activeOrgLabel} (UUID: {selectedOrgId})
							</Text>
						</VStack>

						<Divider variant="subtle" />

						{/* 3. Konfigurasi Sistem & Standar Operasional */}
						<VStack gap={3}>
							<Heading level={2}>Standar Operasional & Integrasi Sistem</Heading>
							<MetadataList columns={2}>
								<MetadataListItem label="Zona Waktu Operasional">
									<HStack gap={1} vAlign="center">
										<Icon icon={Clock} size="xsm" />
										<Text size="sm">WITA (Asia/Makassar, UTC+8)</Text>
									</HStack>
								</MetadataListItem>
								<MetadataListItem label="Pangkalan Data">
									<HStack gap={1} vAlign="center">
										<Icon icon={Database} size="xsm" />
										<Text size="sm">Neon PostgreSQL + PostGIS</Text>
									</HStack>
								</MetadataListItem>
								<MetadataListItem label="Model AI Multimodal">
									<HStack gap={1} vAlign="center">
										<Icon icon={Sparkles} size="xsm" />
										<Text size="sm">Google Gemini 2.5 Flash</Text>
									</HStack>
								</MetadataListItem>
								<MetadataListItem label="Penyimpanan Berkas">
									<HStack gap={1} vAlign="center">
										<Icon icon={Globe} size="xsm" />
										<Text size="sm">Cloudflare R2 Encrypted Bucket</Text>
									</HStack>
								</MetadataListItem>
							</MetadataList>

							<Banner
								status="info"
								collapsible={false}
								title="Batasan Hukum & Operasional Rangkai"
								description="Rangkai adalah platform koordinasi upacara adat dan penutupan jalan desa adat. Rangkai bukan izin resmi penutupan jalan kepolisian dan tidak menggantikan wewenang Dishub atau Pecalang."
							/>
						</VStack>
					</VStack>
				</LayoutContent>
			}
		/>
	);
}
