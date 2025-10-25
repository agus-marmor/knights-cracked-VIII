import express from "express";
import { requireAuth } from "../middleware/auth.js";
import multer from 'multer';
import {getUsername, getProfile, updateAvatar, deleteUser  } from "../controllers/user.controller.js";

const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});
const router = express.Router();

router.get("/username", requireAuth, getUsername);
router.get("/me", requireAuth, getProfile);
router.patch("/avatar", requireAuth,upload.single('avatar'), updateAvatar);
router.delete("/delete", requireAuth, deleteUser);


export default router;