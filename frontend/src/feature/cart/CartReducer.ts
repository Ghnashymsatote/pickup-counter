
import type { CartAction, CartState } from "../../types/cart";

export const initialCartState: CartState = {
  items: [],
};

export function cartReducer(
  state: CartState,
  action: CartAction,
): CartState {
  switch (action.type) {
    case "ADD_ITEM": {
      const existingItem = state.items.find(
        (item) => item.product.id === action.product.id,
      );

      if (existingItem) {
        return {
          items: state.items.map((item) =>
            item.product.id === action.product.id
              ? {
                  ...item,
                  quantity: Math.min(
                    item.quantity + 1,
                    action.product.availableStock,
                  ),
                }
              : item,
          ),
        };
      }

      if (action.product.availableStock <= 0) {
        return state;
      }

      return {
        items: [
          ...state.items,
          { product: action.product, quantity: 1 },
        ],
      };
    }

    case "REMOVE_ITEM":
      return {
        items: state.items.filter(
          (item) => item.product.id !== action.productId,
        ),
      };

    case "UPDATE_QUANTITY":
      return {
        items: state.items
          .map((item) => {
            if (item.product.id !== action.productId) {
              return item;
            }

            const quantity = Math.min(
              action.quantity,
              item.product.availableStock,
            );

            return { ...item, quantity };
          })
          .filter((item) => item.quantity > 0),
      };

    case "CLEAR_CART":
      return initialCartState;

    default:
      return state;
  }
}
