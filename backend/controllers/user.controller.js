import User from "../models/User.js";

export const getProfile = async (req, res) => {
  const user = await User.findById(req.user.id).lean();
  if (!user) return res.status(404).json({ message: "User not found" });

  // expose a clean shape including virtual winRate
  const { username, email, avatarFileId, stats } = user;
  return res.json({
    id: user._id,
    username,
    email,
    avatarFileId,
    stats: {
      avgWPM: stats?.avgWPM ?? 0,
      peakWPM: stats?.peakWPM ?? 0,
      totalMatches: stats?.totalMatches ?? 0,
      wins: stats?.wins ?? 0,
      losses: stats?.losses ?? 0,
      winRate: stats?.totalMatches ? Number(((stats.wins / stats.totalMatches) * 100).toFixed(2)) : 0
    }
  });
};

export const updateAvatar = async (req, res) => {
try {
    // Access GridFS Bucket
    const gridfsBucket = req.app.locals.gridfsBucket;
    // Check if file was uploaded by multer
    if (!req.file) {
      return res.status(400).json({ message: "No avatar file uploaded." });
    }

    // Ensure GridFS Bucket is ready
    if (!gridfsBucket) {
        console.error("GridFS Bucket not ready during upload attempt.");
        return res.status(500).json({ message: "Storage service not ready. Please try again." });
    }

    // Delete old avatar file from GridFS
    const currentUser = await User.findById(req.user.id).select('avatarFileId').lean();
    if (currentUser && currentUser.avatarFileId) {
        try {
            console.log(`Attempting to delete old avatar: ${currentUser.avatarFileId}`);
            await gridfsBucket.delete(new mongoose.Types.ObjectId(currentUser.avatarFileId));
            console.log(`Old avatar ${currentUser.avatarFileId} deleted successfully.`);
        } catch (deleteErr) {
            console.error("Failed to delete old avatar, continuing upload:", deleteErr.message);
            // Handle specific errors like 'FileNotFound'
            if (deleteErr.message.includes('File not found')) {
                 console.warn(`Old avatar file ${currentUser.avatarFileId} not found in GridFS.`);
            }
        }
    }

    // Upload new file to GridFS
    const readableStream = Readable.from(req.file.buffer); // Create stream from buffer
    const uploadStream = gridfsBucket.openUploadStream(req.file.originalname, {
      contentType: req.file.mimetype,
      metadata: { userId: req.user.id } // Store user ID with file
    });

    // Pipe buffer into GridFS and wait for finish/error
    await new Promise((resolve, reject) => {
        readableStream.pipe(uploadStream)
            .on('finish', resolve) // Resolve promise when upload finishes
            .on('error', (err) => { // Reject promise on error
                console.error("GridFS upload stream error:", err);
                reject(new Error("Failed to save image to storage."));
            });
    });

    const fileId = uploadStream.id; // Get the ID GridFS assigned
    console.log(`New avatar saved with GridFS ID: ${fileId}`);

    // Update user document with the NEW GridFS file ID
    // Ensure User schema has: avatarFileId: { type: mongoose.Schema.Types.ObjectId, default: null }
    await User.findByIdAndUpdate(
      req.user.id,
      { $set: { avatarFileId: fileId } },
      { new: true }
    );
    console.log(`User ${req.user.id} updated with new avatarFileId: ${fileId}`);

    // Fetch the FULL updated user profile to return
    const updatedUser = await User.findById(req.user.id).select("-password").lean();
    const stats = await UserStats.findOne({ userId: req.user.id }).lean();

    if (!updatedUser) {
        // This case should ideally not happen if the update succeeded, but check anyway
        return res.status(404).json({ message: "User not found after update." });
    }

    // Construct the profile object (matching frontend interface)
    const userProfile = {
        id: updatedUser._id,
        username: updatedUser.username,
        email: updatedUser.email,
        // The avatarUrl now points to your specific serving endpoint
        avatarUrl: `/api/user/avatar/${fileId}`,
        stats: {
             avgWPM: stats?.avgWPM ?? 0,
             peakWPM: stats?.peakWPM ?? 0,
             totalMatches: stats?.totalMatches ?? 0,
             wins: stats?.wins ?? 0,
             losses: stats?.losses ?? 0,
             winRate: stats?.totalMatches ? Number(((stats.wins / stats.totalMatches) * 100).toFixed(2)) : 0
        }
    };

    // 8. Return the full updated profile
    return res.status(200).json(userProfile);

  } catch (err) {
    console.error("updateAvatarController error:", err);
     // Handle specific Multer errors
     if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ message: "File too large (Max 5MB)." });
        }
     }
     // Handle file type error from Multer's fileFilter
     if (err.message === 'Only image files are allowed!') {
       return res.status(400).json({ message: err.message });
     }
     // Handle GridFS upload stream error
     if (err.message === "Failed to save image to storage."){
        return res.status(500).json({ message: err.message });
     }
     // General server error
    res.status(500).json({ message: err.message || "Server error during avatar update." });
  }
};


export const getUsername = async (req, res) => {
  try {
    // requireAuth already attached the user to req.user
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    res.status(200).json({ username: req.user.username });
  } catch (err) {
    console.error("getUsername error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const deleteUser = async (req, res) => {
  try {
    const userId = req.user.id; // from requireAuth

    // Optional: clean up any owned data (lobbies, matches, etc.)
    // await Lobby.deleteMany({ hostUserId: userId });
    // await Match.deleteMany({ players: userId });

    const deleted = await User.findByIdAndDelete(userId);
    if (!deleted) return res.status(404).json({ message: "User not found" });

    return res.json({ message: "User deleted successfully." });
  } catch (err) {
    console.error("[deleteUser] error:", err);
    return res.status(500).json({ message: "Failed to delete user." });
  }
};