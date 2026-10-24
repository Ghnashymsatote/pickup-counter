import { RouterProvider } from "react-router";

import { router } from "./router";
import { CartProvider } from "./feature/cart/CartContent";
import { ErrorBoundary } from "./components/ErrorBoundary";

export default function App() {
  return (
    <ErrorBoundary>
      <CartProvider>
        <RouterProvider router={router} />
      </CartProvider>
    </ErrorBoundary>
  );
}
