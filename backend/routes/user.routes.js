import express from "express";
import { requireAuth } from "../middleware/auth.js";
import multer from 'multer';
import {getUsername, getProfile, updateAvatar, deleteUser  } from "../controllers/user.controller.js";
import mongoose from "mongoose";
import { ensureGridfsReady } from '../middleware/gridfsready.js';
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

router.patch("/avatar", requireAuth,ensureGridfsReady,upload.single('avatar'), updateAvatar);

router.get('/avatar/:fileId', async (req, res) => {

    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.fileId)) {
            return res.status(400).json({ message: "Invalid file ID." });
         }
        const fileId = new mongoose.Types.ObjectId(req.params.fileId);
        const gridfsBucket = req.app.locals.gridfsBucket; // Access GridFS bucket
        if (!gridfsBucket) { 
            return res.status(500).json({ message: "GridFS bucket not initialized." });
         }
        
        // Find file metadata for content type
        const conn = mongoose.connection;
        const files = await conn.db.collection('avatars.files').find({ _id: fileId }).toArray();
        if (!files || files.length === 0) { 
            return res.status(404).json({ message: "Avatar not found." });
        }
        
        res.set('Content-Type', files[0].contentType);
        res.set('Cache-Control', 'public, max-age=31536000'); // Cache image

        const readStream = gridfsBucket.openDownloadStream(fileId);
        readStream.pipe(res);
        readStream.on('error', (err) => { 
            console.error("Error streaming avatar:", err);
            res.status(500).json({ message: "Error streaming avatar." });
         });

    } catch (error) { 
        console.error("Error fetching avatar:", error);
        res.status(500).json({ message: "Server error fetching avatar." });

    }

});
router.get("/me", requireAuth, getProfile);
router.delete("/delete", requireAuth, deleteUser);


export default router;