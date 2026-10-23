
import type { CartItem } from "../../types/cart";

export function getCartItemCount(items: CartItem[]): number {
  return items.reduce((total, item) => total + item.quantity, 0);
}

export function getCartTotalPaise(items: CartItem[]): number {
  return items.reduce(
    (total, item) =>
      total + item.product.pricePaise * item.quantity,
    0,
  );
}

export function formatPrice(pricePaise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(pricePaise / 100);
}
