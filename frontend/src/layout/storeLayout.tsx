import { Link, NavLink, Outlet } from "react-router";

import { useCart } from "../feature/cart/useCart";

export default function StoreLayout() {
  const { itemCount } = useCart();

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="brand">
          <span className="brand-icon" aria-hidden="true">
            🛒
          </span>

          <span>
            <h1>Pickup Counter</h1>
            <p>Self-service snacks</p>
          </span>
        </Link>

        <div className="header-actions">
          <nav className="app-nav" aria-label="Main">
            <NavLink to="/" end>
              Store
            </NavLink>

            <NavLink to="/checkout">
              Cart
              {itemCount > 0 && (
                <span className="cart-badge">{itemCount}</span>
              )}
            </NavLink>
          </nav>

          <p className="store-status">
            <span className="status-dot" aria-hidden="true" />
            Counter open
          </p>
        </div>
      </header>

      {/* Each page owns its own .store-page container, so it can choose the
          wide product grid or the narrow single-column flow. */}
      <main className="app-main">
        <Outlet />
      </main>

      <footer className="app-footer">
        <p>Pay by UPI · Collect from the locker · Items held for 120s</p>
      </footer>
    </div>
  );
}
