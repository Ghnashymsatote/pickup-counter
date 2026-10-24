import { Router } from "express";
import { asyncHandler } from "../http/errors.js";
import { listProducts } from "../services/products.service.js";

const router = Router();

router.get(
    "/",
    asyncHandler(async (_req, res) => {
        res.json({ products: await listProducts() });
    }),
);

export default router;
