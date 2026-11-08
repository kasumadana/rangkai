import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./api-client";

export interface AuthUser {
	id: string;
	name: string;
	email: string;
	emailVerified: boolean;
	image?: string | null;
	createdAt?: string;
	updatedAt?: string;
}

export interface AuthSessionRecord {
	id: string;
	userId: string;
	expiresAt: string;
	token?: string;
}

export interface AuthSessionResponse {
	user: AuthUser;
	session: AuthSessionRecord;
}

export interface SignInEmailInput {
	email: string;
	password: string;
}

export const AUTH_SESSION_QUERY_KEY = ["auth", "session"] as const;

export async function fetchActiveSession(): Promise<AuthSessionResponse | null> {
	const result = await apiFetch<AuthSessionResponse | null>(
		"/api/auth/get-session",
		{
			method: "GET",
		},
	);
	if (!result || !result.user) {
		return null;
	}
	return result;
}

export async function signInWithEmail(
	input: SignInEmailInput,
): Promise<{ user: AuthUser; token?: string }> {
	return apiFetch<{ user: AuthUser; token?: string }>(
		"/api/auth/sign-in/email",
		{
			method: "POST",
			body: {
				email: input.email.trim(),
				password: input.password,
			},
		},
	);
}

export async function signOutCurrentSession(): Promise<{ success?: boolean }> {
	return apiFetch<{ success?: boolean }>("/api/auth/sign-out", {
		method: "POST",
		body: {},
	});
}

export interface SignUpEmailInput {
	name: string;
	email: string;
	password: string;
}

export async function signUpWithEmail(
	input: SignUpEmailInput,
): Promise<{ user: AuthUser; token?: string }> {
	return apiFetch<{ user: AuthUser; token?: string }>(
		"/api/auth/sign-up/email",
		{
			method: "POST",
			body: {
				name: input.name.trim(),
				email: input.email.trim(),
				password: input.password,
			},
		},
	);
}

export interface UserOrganization {
	id: string;
	name: string;
	village: string | null;
	district: string | null;
	createdAt: string;
	role: "organizer" | "officer";
	hasOperationalAuthority?: boolean;
}

export interface CreateOrganizationInput {
	name: string;
	village?: string;
	district?: string;
}

export async function createOrganization(
	input: CreateOrganizationInput,
): Promise<{ organization: UserOrganization; membership: { id: string; role: string } }> {
	return apiFetch<{
		organization: UserOrganization;
		membership: { id: string; role: string };
	}>("/api/organizations", {
		method: "POST",
		body: input,
	});
}

export async function fetchMyOrganizations(): Promise<{
	organizations: UserOrganization[];
}> {
	return apiFetch<{ organizations: UserOrganization[] }>(
		"/api/organizations/my",
		{ method: "GET" },
	);
}

export interface InvitationDetails {
	invitationRole: "organizer" | "officer";
	valid: boolean;
	token: string;
	event: {
		id: string;
		title: string;
		venueName?: string | null;
	} | null;
	organization: {
		id: string;
		name: string;
		village?: string | null;
		district?: string | null;
	};
	permissions: {
		canUpdateTraffic: boolean;
		canUpdateCleanup: boolean;
	};
	recipientEmail: string;
	expiresAt: string;
}

export async function fetchInvitationDetails(
	token: string,
): Promise<InvitationDetails> {
	return apiFetch<InvitationDetails>(
		`/api/invitations/${encodeURIComponent(token)}`,
		{ method: "GET" },
	);
}

export async function acceptInvitation(
	token: string,
): Promise<{ success: boolean; eventId: string; role: string }> {
	return apiFetch<{ success: boolean; eventId: string; role: string }>(
		`/api/invitations/${encodeURIComponent(token)}/accept`,
		{
			method: "POST",
			body: {},
		},
	);
}

export function useAuthSession() {
	return useQuery({
		queryKey: AUTH_SESSION_QUERY_KEY,
		queryFn: fetchActiveSession,
		staleTime: 30_000,
		retry: false,
	});
}

export function useSignUpMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: signUpWithEmail,
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: AUTH_SESSION_QUERY_KEY });
			await queryClient.invalidateQueries({ queryKey: ["events"] });
		},
	});
}

export function useCreateOrganizationMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: createOrganization,
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: AUTH_SESSION_QUERY_KEY });
			await queryClient.invalidateQueries({ queryKey: ["organizations", "my"] });
			await queryClient.invalidateQueries({ queryKey: ["events"] });
		},
	});
}

export function useMyOrganizationsQuery() {
	return useQuery({
		queryKey: ["organizations", "my"],
		queryFn: fetchMyOrganizations,
		staleTime: 30_000,
	});
}

export function useInvitationQuery(token: string) {
	return useQuery({
		queryKey: ["invitations", token],
		queryFn: () => fetchInvitationDetails(token),
		enabled: Boolean(token),
		retry: false,
	});
}

export function useAcceptInvitationMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: acceptInvitation,
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: AUTH_SESSION_QUERY_KEY });
			await queryClient.invalidateQueries({ queryKey: ["organizations", "my"] });
			await queryClient.invalidateQueries({ queryKey: ["events"] });
		},
	});
}

export function useSignInMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: signInWithEmail,
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: AUTH_SESSION_QUERY_KEY });
			await queryClient.invalidateQueries({ queryKey: ["events"] });
		},
	});
}

export function useSignOutMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: signOutCurrentSession,
		onSuccess: async () => {
			queryClient.setQueryData(AUTH_SESSION_QUERY_KEY, null);
			await queryClient.invalidateQueries({ queryKey: AUTH_SESSION_QUERY_KEY });
			await queryClient.invalidateQueries({ queryKey: ["events"] });
		},
	});
}

export interface EventAssignmentItem {
	id: string;
	eventId: string;
	userId: string;
	userName: string;
	userEmail: string;
	canUpdateTraffic: boolean;
	canUpdateCleanup: boolean;
	createdAt: string;
}

export interface InvitationItem {
	id: string;
	role: "organizer" | "officer";
	organizationId: string;
	eventId?: string | null;
	eventTitle?: string | null;
	recipientEmail?: string | null;
	canUpdateTraffic: boolean;
	canUpdateCleanup: boolean;
	status: "pending" | "accepted" | "revoked" | "expired";
	expiresAt: string;
	createdAt: string;
	createdByName?: string | null;
	token?: string | null;
	inviteUrl?: string;
}

export interface CreateInvitationInput {
	organizationId?: string;
	eventId?: string;
	role: "organizer" | "officer";
	recipientEmail: string;
	canUpdateTraffic?: boolean;
	canUpdateCleanup?: boolean;
}

export async function fetchEventAssignments(
	eventId: string,
): Promise<{ assignments: EventAssignmentItem[] }> {
	return apiFetch<{ assignments: EventAssignmentItem[] }>(
		`/api/events/${encodeURIComponent(eventId)}/assignments`,
		{ method: "GET" },
	);
}

export async function revokeEventAssignment(
	eventId: string,
	assignmentId: string,
): Promise<{ success: boolean; revokedAssignmentId: string }> {
	return apiFetch<{ success: boolean; revokedAssignmentId: string }>(
		`/api/events/${encodeURIComponent(eventId)}/assignments/${encodeURIComponent(assignmentId)}`,
		{ method: "DELETE" },
	);
}

export async function fetchInvitations(
	organizationId?: string,
): Promise<{ invitations: InvitationItem[] }> {
	const query = organizationId
		? `?organizationId=${encodeURIComponent(organizationId)}`
		: "";
	return apiFetch<{ invitations: InvitationItem[] }>(
		`/api/invitations${query}`,
		{ method: "GET" },
	);
}

export async function createInvitation(
	input: CreateInvitationInput,
): Promise<{ invitation: InvitationItem }> {
	return apiFetch<{ invitation: InvitationItem }>("/api/invitations", {
		method: "POST",
		body: input,
	});
}

export async function revokeInvitation(
	invitationId: string,
): Promise<{ success: boolean; revokedId: string }> {
	return apiFetch<{ success: boolean; revokedId: string }>(
		`/api/invitations/${encodeURIComponent(invitationId)}`,
		{ method: "DELETE" },
	);
}
