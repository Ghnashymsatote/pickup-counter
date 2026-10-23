
import { Link } from "react-router";
import { useCart } from "../../feature/cart/useCart";
import { formatPrice } from "../../feature/cart/CartUtil";


export default function CartSummary() {
  const { itemCount, totalPaise } = useCart();

  return (
    <aside className="cart-summary">
      <h2>Your Cart</h2>

      <div className="cart-summary-row">
        <span>Items</span>
        <strong>{itemCount}</strong>
      </div>

      <div className="cart-summary-row">
        <span>Total</span>
        <strong>{formatPrice(totalPaise)}</strong>
      </div>

      <Link
        to="/checkout"
        className="checkout-button"
        aria-disabled={itemCount === 0}
        onClick={(event) => {
          if (itemCount === 0) {
            event.preventDefault();
          }
        }}
      >
        Proceed to Checkout
      </Link>
    </aside>
  );
}
