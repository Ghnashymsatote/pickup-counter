
import { RouterProvider } from "react-router";
import { router } from "./router";
import { CartProvider } from "./feature/cart/CartContent";


export default function App() {
  return (
    <CartProvider>
      <RouterProvider router={router} />
    </CartProvider>
  );
}
