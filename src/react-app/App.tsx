import { LinkProvider } from "@astryxdesign/core/Link";
import { ToastViewport } from "@astryxdesign/core/Toast";
import { Theme } from "@astryxdesign/core/theme";
import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { defaultThemeSlug, themes } from "../astryx-themes";
import {
	PublicShellLayout,
	RouterLinkBridge,
	WorkspaceShellLayout,
} from "./components/layout/AppShellLayout";
import { createAppQueryClient } from "./lib/query-client";
import { EventWizardPage } from "./pages/EventWizardPage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { OrganizationOnboardingPage } from "./pages/OrganizationOnboardingPage";
import { AcceptInvitationPage } from "./pages/AcceptInvitationPage";
import { OrganizerDashboardPage } from "./pages/OrganizerDashboardPage";
import { FieldTaskListPage } from "./pages/FieldTaskListPage";
import {
	PublicEventDetailPage,
	PublicEventsListPage,
	PublicFullMapView,
	PublicHomePage,
	WorkflowRouteShellPage,
} from "./pages/RouteViews";
import { SettingsPage } from "./pages/SettingsPage";
import { UiSystemCatalogPage } from "./pages/UiSystemCatalogPage";

export function App() {
	const [queryClient] = useState(() => createAppQueryClient());

	return (
		<Theme theme={themes[defaultThemeSlug]} mode="light">
			<LinkProvider component={RouterLinkBridge}>
				<QueryClientProvider client={queryClient}>
					<BrowserRouter>
						<Routes>
							{/* Public Information Architecture */}
							<Route element={<PublicShellLayout />}>
								<Route path="/" element={<PublicHomePage />} />
								<Route path="/peta" element={<PublicFullMapView />} />
								<Route
									path="/info-desa"
									element={<Navigate to="/events" replace />}
								/>
								<Route path="/events" element={<PublicEventsListPage />} />
								<Route
									path="/events/:slug"
									element={<PublicEventDetailPage />}
								/>
								<Route
									path="/events/:slug/map"
									element={<PublicEventDetailPage mapOnly />}
								/>
								<Route path="/login" element={<LoginPage />} />
								<Route path="/register" element={<RegisterPage />} />
								<Route
									path="/onboarding/organization"
									element={<OrganizationOnboardingPage />}
								/>
								<Route
									path="/invite/:token"
									element={<AcceptInvitationPage />}
								/>
							</Route>

							{/* Authenticated Organizer & Field Officer Workspace */}
							<Route element={<WorkspaceShellLayout />}>
								<Route
									path="/dashboard"
									element={<OrganizerDashboardPage />}
								/>
								<Route
									path="/dashboard/events"
									element={<OrganizerDashboardPage />}
								/>
								<Route
									path="/dashboard/events/new"
									element={<EventWizardPage />}
								/>
								<Route
									path="/dashboard/events/:id"
									element={<EventWizardPage />}
								/>
								<Route
									path="/dashboard/events/:id/document"
									element={
										<WorkflowRouteShellPage
											stepCode="Surat Pengumuman"
											title="Unggah Surat Pengumuman Desa"
											subtitle="Unggah foto atau PDF surat pengumuman desa adat untuk dibaca otomatis menjadi draf kegiatan."
											requirementRef="Arsip Internal Panitia"
										/>
									}
								/>
								<Route
									path="/dashboard/events/:id/review"
									element={
										<WorkflowRouteShellPage
											stepCode="Pemeriksaan Data"
											title="Periksa & Konfirmasi Rincian Kegiatan"
											subtitle="Bandingkan hasil pembacaan surat dengan dokumen asli sebelum kegiatan diumumkan kepada warga."
											requirementRef="Pemeriksaan Prajuru"
										/>
									}
								/>
								<Route
									path="/dashboard/events/:id/roads"
									element={
										<WorkflowRouteShellPage
											stepCode="Jalur & Penutupan"
											title="Atur Ruas Jalan & Jalur Alternatif"
											subtitle="Tentukan ruas jalan yang ditutup sementara atau diberlakukan buka-tutup selama kegiatan berlangsung."
											requirementRef="Peta Jalur Desa"
										/>
									}
								/>
								<Route
									path="/dashboard/events/:id/cleanup"
									element={
										<WorkflowRouteShellPage
											stepCode="Penanganan Kebersihan"
											title="Pemeriksaan Kebersihan & Catatan Sampah"
											subtitle="Pantau bukti foto pembersihan area kegiatan dan catatan sampah pasca-acara."
											requirementRef="Kebersihan Desa Adat"
										/>
									}
								/>
								<Route
									path="/dashboard/events/:id/team"
									element={
										<WorkflowRouteShellPage
											stepCode="Penugasan Petugas"
											title="Penugasan Pecalang & Petugas Kebersihan"
											subtitle="Kelola daftar petugas lapangan yang bertugas memperbarui kondisi jalan dan kebersihan."
											requirementRef="Petugas Desa Adat"
										/>
									}
								/>
								<Route
									path="/field"
									element={<FieldTaskListPage />}
								/>
								<Route
									path="/field/events/:id"
									element={
										<WorkflowRouteShellPage
											stepCode="Tugas Lapangan"
											title="Pos Jaga Pecalang & Kebersihan"
											subtitle="Perbarui status jalan dari pos jaga atau kirimkan bukti pembersihan area pasca-kegiatan."
											requirementRef="Petugas Lapangan"
										/>
									}
								/>
								{["/field/events/:id/traffic", "/field/events/:id/cleanup", "/field/events/:id/cleanup/:taskId"].map((path) => (
									<Route key={path} path={path} element={<WorkflowRouteShellPage stepCode="Tugas Lapangan" title="Tugas Lapangan" subtitle="Perbarui tugas yang ditugaskan kepada Anda." requirementRef="Petugas Lapangan" />} />
								))}
								<Route path="/settings" element={<SettingsPage />} />
								<Route path="/ui-system" element={<UiSystemCatalogPage />} />
							</Route>

							<Route path="*" element={<Navigate to="/" replace />} />
						</Routes>
					</BrowserRouter>
					<ToastViewport position="bottomEnd" />
				</QueryClientProvider>
			</LinkProvider>
		</Theme>
	);
}

export default App;
