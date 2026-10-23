
import { createContext } from "react";
import type { Product } from "../../types/product";
import type { CartItem } from "../../types/cart";

export type CartContextValue = {
  items: CartItem[];
  itemCount: number;
  totalPaise: number;
  addItem: (product: Product) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
};

export const CartContext = createContext<CartContextValue | undefined>(
  undefined,
);
