// User
export interface User {
  uid: string;
  email: string;
  role: "customer" | "admin";
  createdAt: Date;
}

// Location (MikroTik Router)
export interface Location {
  id: string;
  name: string;
  routerIp: string;
  routerUser: string;
  routerPass: string;
  active: boolean;
  createdAt: Date;
}

// Plan
export interface Plan {
  id: string;
  locationId: string;
  locationName: string;
  name: string;
  price: number;
  duration: string;
  dataLimit: string;
  mikrotikProfile: string;
  active: boolean;
  createdAt: Date;
}

// Voucher
export interface Voucher {
  id: string;
  userId: string;
  userEmail: string;
  planId: string;
  planName: string;
  locationId: string;
  locationName: string;
  username: string;
  password: string;
  duration: string;
  dataLimit?: string;
  status: "active" | "expired" | "failed";
  paystackReference: string;
  failureReason?: string;
  retryCount: number;
  createdAt: Date;
  expiresAt: Date;
}

// Payment
export interface Payment {
  id: string;
  userId: string;
  userEmail: string;
  planId: string;
  planName: string;
  locationId: string;
  amount: number;
  paystackReference: string;
  status: "pending" | "success" | "failed";
  voucherId?: string;
  createdAt: Date;
}

// MikroTik Hotspot User
export interface MikrotikHotspotUser {
  name: string;
  password: string;
  profile: string;
  comment?: string;
}

// API Response
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
