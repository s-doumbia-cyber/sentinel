import { useQuery } from "@tanstack/react-query";
import type { InviteStatus, Role } from "@sentinel/shared";
import { useAuth } from "@/features/auth/AuthContext";
import { api } from "@/lib/api";
import { useOrgMutation } from "@/lib/queries";

export interface Invite {
  id: string;
  email: string;
  role: Role;
  status: InviteStatus;
  expiresAt: string;
  createdAt: string;
  createdBy: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}

export interface CreatedInvite {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  /** Shown once; the server keeps only its hash. */
  token: string;
}

export interface InviteLookup {
  orgName: string;
  role: Role;
  email: string;
  expiresAt: string;
  accountExists: boolean;
}

/** The token travels in the URL fragment, which browsers never send to a server or in a Referer. */
export function inviteLink(token: string): string {
  return `${window.location.origin}/accept-invite#${token}`;
}

export function useInvites(enabled: boolean) {
  const org = useAuth().activeOrg?.id ?? "none";
  return useQuery({ queryKey: [org, "invites"], queryFn: () => api<{ items: Invite[] }>("/invites"), enabled });
}

export function useCreateInvite() {
  return useOrgMutation((body: { email: string; role: Role; expiresInDays: number }) => api<CreatedInvite>("/invites", { method: "POST", body }), ["invites"]);
}

export function useRevokeInvite() {
  return useOrgMutation((id: string) => api(`/invites/${id}`, { method: "DELETE" }), ["invites"]);
}

export function useRemoveMember() {
  return useOrgMutation((userId: string) => api(`/members/${userId}`, { method: "DELETE" }), ["members"]);
}
