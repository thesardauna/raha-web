export type Role = "customer" | "merchant" | "rider" | "admin";

export type OrderStatus =
  | "pending"
  | "confirmed"
  | "preparing"
  | "ready_for_pickup"
  | "out_for_delivery"
  | "delivered"
  | "cancelled";

export type DeliveryStatus =
  | "awaiting_rider"
  | "assigned"
  | "picked_up"
  | "in_transit"
  | "delivered"
  | "failed"
  | "cancelled";

export type PaymentStatus = "unpaid" | "paid" | "refunded";

export interface Profile {
  id: string;
  full_name: string | null;
  phone: string | null;
  role: Role;
}
