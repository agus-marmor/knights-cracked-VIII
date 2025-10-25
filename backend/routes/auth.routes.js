import express from "express";
import { signup, login } from "../controllers/auth.controller.js";
import { updatePassword } from "../controllers/auth.controller.js";  // ← add
import { requireAuth } from "../middleware/auth.js";


const router = express.Router();

//run signup when signup POST
router.post("/signup", signup);
//run login on login POST
router.post("/login", login);

router.post("/updatepassword", requireAuth, updatePassword);

export default router;