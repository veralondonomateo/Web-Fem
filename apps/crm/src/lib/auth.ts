'use client';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'AGENT' | 'ANALYST';
  avatar?: string;
}

export function getUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('fem_user');
  return raw ? JSON.parse(raw) : null;
}

export function setAuth(token: string, user: AuthUser) {
  localStorage.setItem('fem_token', token);
  localStorage.setItem('fem_user', JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem('fem_token');
  localStorage.removeItem('fem_user');
}

export function isAuthenticated() {
  return !!localStorage.getItem('fem_token');
}
