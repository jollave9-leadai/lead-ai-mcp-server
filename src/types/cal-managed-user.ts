// Type definitions for the cal_managed_users table
export interface CalManagedUser {
  id: number;
  client_id: number;
  cal_user_id: number;
  email: string;
  username?: string;
  access_token: string;
  refresh_token: string;
  created_at?: string;
  updated_at?: string;
  is_active?: boolean;
}

export interface BaseManagedUser {
  access_token: string;
  refresh_token?: string;
  cal_user_id: number | string;
  client_id: number | string;
  email: string;
  username?: string;
  id?: string | number; // Allow both string and number for id
}
