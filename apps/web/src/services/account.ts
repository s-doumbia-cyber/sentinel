import { api } from "./api";

export interface UserAccountResponse {
  _id: string;
  name: string;
  email: string;
  role: "Analyst" | "Admin" | "Viewer";
  createdAt: string;
}

export const usersApi = {
  list: () => api.get<UserAccountResponse[]>("/users").then((r) => r.data),
  updateRole: (id: string, role: string) => api.patch(`/users/${id}/role`, { role }).then((r) => r.data),
};

export interface SessionResponse {
  id: string;
  userAgent: string;
  ip: string;
  lastSeenAt: string;
  createdAt: string;
  current: boolean;
}

export const sessionsApi = {
  list: () => api.get<SessionResponse[]>("/auth/sessions").then((r) => r.data),
  revoke: (id: string) => api.delete(`/auth/sessions/${id}`).then((r) => r.data),
};

export const accountApi = {
  exportData: () => api.get("/auth/export").then((r) => r.data),
};
