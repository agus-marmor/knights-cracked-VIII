export const ensureGridfsReady = (req, res, next) => {
  if (!req.app.locals.gridfsBucket) {
    console.warn("GridFS not ready, delaying request slightly.");
     setTimeout(() => {
         if (!req.app.locals.gridfsBucket) {
             console.error("GridFS still not ready after delay.");
             return res.status(503).json({ message: "Storage service unavailable. Please try again later." });
         }
         console.log("GridFS ready, proceeding with request.");
         next(); 
     }, 1000); // Wait 1 second
  } else {
    next(); // GridFS is ready, proceed immediately
  }
};