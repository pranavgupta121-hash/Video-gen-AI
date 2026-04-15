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
app.use(express.json({ limit: "50mb" }));
app.use("/outputs", express.static(path.join(__dirname, "public/outputs")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

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

// API Routes
app.post("/api/upload-asset", async (req, res) => {
  const { base64, type, extension } = req.body;
  const fileName = `${uuidv4()}.${extension}`;
  const folder = type === "image" ? "uploads" : "temp";
  const filePath = path.join(process.cwd(), folder, fileName);
  
  fs.writeFileSync(filePath, Buffer.from(base64, "base64"));
  res.json({ path: `/${folder}/${fileName}`, fullPath: filePath });
});

app.post("/api/process-video", async (req, res) => {
  const { scenes, format = "landscape" } = req.body;
  const jobId = uuidv4();
  
  res.json({ jobId });

  try {
    const videoUrl = await processVideo({
      id: jobId,
      scenes,
      format,
      onProgress: (progress, step) => {
        io.emit(`progress:${jobId}`, { step, progress });
      }
    });

    io.emit(`progress:${jobId}`, { step: "Completed", progress: 100, videoUrl });
  } catch (error) {
    console.error("Video processing failed:", error);
    io.emit(`progress:${jobId}`, { step: "Failed", progress: 0, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/upload-images", upload.array("images"), (req: any, res) => {
  const files = req.files as any[];
  const paths = files.map(f => `/uploads/${f.filename}`);
  res.json({ paths });
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
  app.get("*", (req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
