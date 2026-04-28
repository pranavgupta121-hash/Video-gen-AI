import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import cors from "cors";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import { processVideo } from "./services/videoService.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

const PORT = 3000;

// Ensure directories exist
const dirs = ["temp", "public/outputs", "public/assets", "uploads"];
dirs.forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

app.use(cors());
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));
app.use("/outputs", express.static(path.join(process.cwd(), "public/outputs")));
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// Global error handler for middleware errors
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    console.error("Multer Error:", err);
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  if (err) {
    console.error("Global Server Error:", err);
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
  next();
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}${path.extname(file.originalname)}`);
  },
});
const upload = multer({ storage });

// Socket.io connection
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);
  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// Global job store (In-memory for simplicity)
const jobs = new Map<string, any>();

// API Routes
app.post("/api/v1/stories/create", (req, res) => {
  upload.array("images")(req, res, async (err) => {
    if (err) return res.status(500).json({ error: err.message });
    
    // In a real app we'd parse the 'config' field from req.body too
    // For now we'll use defaults or whatever is passed in body
    const { mood = "cinematic", motionIntensity = "medium", format = "landscape" } = req.body;
    const jobId = uuidv4();
    const files = req.files as any[];

    if (!files || files.length === 0) {
      return res.status(400).json({ error: "At least 1 image required" });
    }

    const jobData = {
      job_id: jobId,
      status: "queued",
      progress: 0,
      message: "Job queued for processing",
      output_url: null,
      metadata: { mood, motionIntensity, format }
    };

    jobs.set(jobId, jobData);
    res.json(jobData);

    // This would be handled by the frontend orchestrator normally, 
    // but for the API we'll mock the start (the frontend will still use /api/process-video)
  });
});

app.get("/api/v1/stories/:jobId/status", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

app.get("/api/v1/stories/:jobId/download", (req, res) => {
  const output_path = path.join(process.cwd(), "public/outputs", `${req.params.jobId}.mp4`);
  if (!fs.existsSync(output_path)) {
    return res.status(404).json({ error: "Video not ready or expired" });
  }
  res.download(output_path);
});

app.post("/api/upload-images", upload.array("images"), (req, res) => {
  console.log("Upload attempt received");
  
  if (!req.files || (req.files as any[]).length === 0) {
    console.warn("Upload attempt: No files received");
    return res.status(400).json({ error: "No files uploaded" });
  }

  const files = req.files as any[];
  console.log(`Successfully uploaded ${files.length} images`);
  const paths = files.map(f => `/uploads/${f.filename}`);
  res.json({ paths });
});

app.post("/api/upload-asset", async (req, res) => {
  const { base64, type, extension } = req.body;
  const fileName = `${uuidv4()}.${extension}`;
  const folder = type === "image" ? "uploads" : "temp";
  const filePath = path.join(process.cwd(), folder, fileName);
  
  fs.writeFileSync(filePath, Buffer.from(base64, "base64"));
  res.json({ path: `/${folder}/${fileName}`, fullPath: filePath });
});

app.post("/api/process-video", async (req, res) => {
  const { scenes, format = "landscape", mood = "cinematic", motionIntensity = "medium" } = req.body;
  if (!scenes || !Array.isArray(scenes) || scenes.length === 0) {
    return res.status(400).json({ error: "Missing or invalid scenes" });
  }
  const jobId = uuidv4();
  
  const jobData = {
    job_id: jobId,
    status: "processing",
    progress: 0,
    message: "Initializing...",
    output_url: null
  };
  jobs.set(jobId, jobData);
  
  console.log(`Starting video processing job: ${jobId}`);
  res.json({ jobId });

  try {
    const videoUrl = await processVideo({
      id: jobId,
      scenes,
      format,
      mood,
      motionIntensity,
      onProgress: (progress, step) => {
        console.log(`Job ${jobId} Progress: ${progress}% - ${step}`);
        const currentJob = jobs.get(jobId);
        if (currentJob) {
          currentJob.progress = progress;
          currentJob.message = step;
          currentJob.status = progress === 100 ? "completed" : "processing";
        }
        io.emit(`progress:${jobId}`, { step, progress });
      }
    });

    console.log(`Job ${jobId} Completed: ${videoUrl}`);
    const finalJob = jobs.get(jobId);
    if (finalJob) {
      finalJob.output_url = `/api/v1/stories/${jobId}/download`;
      finalJob.status = "completed";
      finalJob.progress = 100;
      finalJob.output_path = videoUrl; // store internal path
    }

    io.emit(`progress:${jobId}`, { step: "Completed", progress: 100, videoUrl: `/outputs/${jobId}.mp4` });
  } catch (error) {
    console.error(`Job ${jobId} Failed:`, error);
    const failedJob = jobs.get(jobId);
    if (failedJob) {
      failedJob.status = "failed";
      failedJob.message = error instanceof Error ? error.message : "Unknown error";
    }
    io.emit(`progress:${jobId}`, { step: "Failed", progress: 0, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

// JSON fallback for missing API routes
app.all("/api/*all", (req, res) => {
  res.status(404).json({ error: `API route ${req.method} ${req.originalUrl} not found` });
});

// Vite middleware
if (process.env.NODE_ENV !== "production") {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  const distPath = path.join(process.cwd(), "dist");
  app.use(express.static(distPath));
  app.get("*all", (req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
