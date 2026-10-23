
import { useCart } from "../../feature/cart/useCart";
import { formatPrice } from "../../feature/cart/CartUtil";
import type { CartItem as CartItemType } from "../../types/cart";


type CartItemProps = {
  item: CartItemType;
};

export default function CartItem({ item }: CartItemProps) {
  const { updateQuantity, removeItem } = useCart();
  const { product, quantity } = item;

  return (
    <article className="cart-item">
      <div className="cart-item-info">
        <h3>{product.name}</h3>
        <p>{formatPrice(product.pricePaise)} each</p>
      </div>

      <div className="cart-item-actions">
        <button
          type="button"
          aria-label={`Decrease ${product.name} quantity`}
          onClick={() => updateQuantity(product.id, quantity - 1)}
        >
          −
        </button>

        <span>{quantity}</span>

        <button
          type="button"
          aria-label={`Increase ${product.name} quantity`}
          disabled={quantity >= product.availableStock}
          onClick={() => updateQuantity(product.id, quantity + 1)}
        >
          +
        </button>
      </div>

      <strong>
        {formatPrice(product.pricePaise * quantity)}
      </strong>

      <button
        type="button"
        className="remove-cart-item"
        onClick={() => removeItem(product.id)}
      >
        Remove
      </button>
    </article>
  );
}
