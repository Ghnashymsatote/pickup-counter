
import { Link, Outlet } from "react-router";

export default function StoreLayout() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="brand">
          Pickup Counter
        </Link>

        <nav>
          <Link to="/">Store</Link>
          <Link to="/checkout">Checkout</Link>
        </nav>
      </header>

      <main>
        <Outlet />
      </main>
    </div>
  );
}
