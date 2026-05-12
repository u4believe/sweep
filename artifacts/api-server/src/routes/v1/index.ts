import { Router, type IRouter } from "express";
import plansRouter          from "./plans.js";
import subscriptionsRouter  from "./subscriptions.js";
import paymentsRouter       from "./payments.js";
import confirmationCodesRouter from "./confirmationCodes.js";
import passportRouter       from "./passport.js";
import webhooksRouter       from "./webhooks.js";

const router: IRouter = Router();

router.use("/plans",              plansRouter);
router.use("/subscriptions",      subscriptionsRouter);
router.use("/payments",           paymentsRouter);
router.use("/confirmation-codes", confirmationCodesRouter);
router.use("/passport",           passportRouter);
router.use("/webhooks",           webhooksRouter);

export default router;