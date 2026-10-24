import { createBrowserRouter } from "react-router";

import StoreLayout from "./layout/storeLayout";
import CheckoutPage from "./pages/checkout/checkoutPage";
import OrderStatusPage from "./pages/orders/orderStatusPage";
import NotFoundPage from "./pages/not-found/notFound";
import StorePage from "./pages/store/storePage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <StoreLayout />,
    children: [
      { index: true, element: <StorePage /> },
      { path: "checkout", element: <CheckoutPage /> },
      { path: "orders/:orderId", element: <OrderStatusPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
