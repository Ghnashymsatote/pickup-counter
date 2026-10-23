
import { useMemo, useReducer, type ReactNode } from "react";

import { cartReducer, initialCartState } from "./CartReducer";
import { getCartItemCount, getCartTotalPaise } from "./CartUtil";
import { CartContext, type CartContextValue } from "./CartContext";

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(cartReducer, initialCartState);

  const value = useMemo<CartContextValue>(
    () => ({
      items: state.items,
      itemCount: getCartItemCount(state.items),
      totalPaise: getCartTotalPaise(state.items),
      addItem: (product) => dispatch({ type: "ADD_ITEM", product }),
      removeItem: (productId) =>
        dispatch({ type: "REMOVE_ITEM", productId }),
      updateQuantity: (productId, quantity) =>
        dispatch({
          type: "UPDATE_QUANTITY",
          productId,
          quantity,
        }),
      clearCart: () => dispatch({ type: "CLEAR_CART" }),
    }),
    [state.items],
  );

  return (
    <CartContext.Provider value={value}>
      {children}
    </CartContext.Provider>
  );
}
