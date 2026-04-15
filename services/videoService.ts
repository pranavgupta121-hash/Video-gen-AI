import ffmpeg from "fluent-ffmpeg";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";

export interface VideoJob {
  id: string;
  scenes: {
    imagePath: string;
    audioPath: string;
    text: string;
    duration: number;
  }[];
  format: "landscape" | "portrait";
  onProgress: (progress: number, step: string) => void;
}

function wrapText(text: string, maxChars: number = 50): string {
  const words = text.split(" ");
  let lines = [];
  let currentLine = "";

  words.forEach((word) => {
    if ((currentLine + word).length > maxChars) {
      lines.push(currentLine.trim());
      currentLine = word + " ";
    } else {
      currentLine += word + " ";
    }
  });
  lines.push(currentLine.trim());
  return lines.join("\n");
}

function escapeFFmpegText(text: string): string {
  const wrapped = wrapText(text);
  return wrapped
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "'\\\\''")
    .replace(/:/g, "\\:");
}

export async function processVideo(job: VideoJob): Promise<string> {
  const { id, scenes, format, onProgress } = job;
  const outputFileName = `${id}.mp4`;
  const outputPath = path.join(process.cwd(), "public/outputs", outputFileName);
  const tempDir = path.join(process.cwd(), "temp", id);
  
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const sceneVideos: string[] = [];
  const width = format === "landscape" ? 1280 : 720;
  const height = format === "landscape" ? 720 : 1280;

  onProgress(10, "Creating scene videos");

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const sceneOutput = path.join(tempDir, `scene_${i}.mp4`);
    
    await new Promise<void>((resolve, reject) => {
      const escapedText = escapeFFmpegText(scene.text);
      
      const command = ffmpeg()
        .input(scene.imagePath)
        .inputOptions(["-loop 1"]);

      // Gemini TTS returns raw PCM (s16le, 24kHz, mono)
      if (scene.audioPath.endsWith(".raw")) {
        command.input(scene.audioPath).inputOptions([
          "-f s16le",
          "-ar 24000",
          "-ac 1"
        ]);
      } else {
        command.input(scene.audioPath);
      }

      command
        .complexFilter([
          // Scale and pad the image to fit the target resolution
          {
            filter: "scale",
            options: {
              w: width,
              h: height,
              force_original_aspect_ratio: "decrease"
            },
            inputs: "0:v",
            outputs: "scaled"
          },
          {
            filter: "pad",
            options: {
              w: width,
              h: height,
              x: `(ow-iw)/2`,
              y: `(oh-ih)/2`,
              color: "black"
            },
            inputs: "scaled",
            outputs: "padded"
          },
          // Add text overlay
          {
            filter: "drawtext",
            options: {
              text: escapedText,
              fontsize: 32,
              fontcolor: "white",
              x: "(w-text_w)/2",
              y: "h-text_h-100",
              box: 1,
              boxcolor: "black@0.6",
              boxborderw: 10,
              line_spacing: 10
            },
            inputs: "padded",
            outputs: "v"
          }
        ])
        .outputOptions([
          "-map [v]",
          "-map 1:a",
          "-c:v libx264",
          "-c:a aac",
          "-pix_fmt yuv420p",
          "-shortest",
          "-r 25",
          "-preset ultrafast"
        ])
        .on("end", () => resolve())
        .on("error", (err, stdout, stderr) => {
          console.error("FFmpeg Scene Error:", err.message);
          console.error("FFmpeg stderr:", stderr);
          reject(err);
        })
        .save(sceneOutput);
    });
    
    sceneVideos.push(sceneOutput);
    onProgress(10 + ((i + 1) / scenes.length) * 60, `Processed scene ${i + 1}/${scenes.length}`);
  }

  onProgress(80, "Merging scenes");

  return new Promise((resolve, reject) => {
    const command = ffmpeg();
    
    sceneVideos.forEach((video) => {
      command.input(video);
    });

    command
      .on("error", (err) => reject(err))
      .on("end", () => {
        onProgress(100, "Video generation complete");
        resolve(`/outputs/${outputFileName}`);
      })
      .mergeToFile(outputPath, tempDir);
  });
}
