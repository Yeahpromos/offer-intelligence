export const ACCESS_LEVELS = [0, 1, 2] as const;

export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export interface AuthUser {
  readonly id: number | string | null;
  readonly username: string;
  readonly displayName: string;
  readonly email: string;
  readonly level: AccessLevel;
  readonly expiresAt?: number;
  readonly authDisabled?: boolean;
}
