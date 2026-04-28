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
    faceFocus?: {
      ymin: number;
      xmin: number;
      ymax: number;
      xmax: number;
    };
    motionType?: "slow_zoom_out" | "intimate_zoom" | "gentle_pan" | "static";
  }[];
  format: "landscape" | "portrait";
  mood?: "cinematic" | "dramatic" | "peaceful" | "energetic";
  motionIntensity?: "subtle" | "medium" | "dramatic";
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

function escapeFFmpegPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "'\\\\''");
}

export async function processVideo(job: VideoJob): Promise<string> {
  const { id, scenes, format, onProgress, mood = "cinematic", motionIntensity = "medium" } = job;
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
    const textFilePath = path.join(tempDir, `scene_${i}.txt`);

    const absoluteImagePath = path.isAbsolute(scene.imagePath)
      ? scene.imagePath
      : path.join(process.cwd(), scene.imagePath);

    const absoluteAudioPath = path.isAbsolute(scene.audioPath)
      ? scene.audioPath
      : path.join(process.cwd(), scene.audioPath);

    // Write text to file to avoid escaping nightmares
    fs.writeFileSync(textFilePath, wrapText(scene.text));

    await new Promise<void>((resolve, reject) => {
      // 100% Reliable approach: Simple scale and pad, no complex filter chains or zoompan
      // This mirrors your recommended "ffmpeg_fixed_filtergraph" command.
      ffmpeg().input(absoluteImagePath)
        .inputOptions(["-loop 1", "-framerate 25"])
        // Use an array of inputs if we have audio
        .input(absoluteAudioPath.endsWith(".raw") ? absoluteAudioPath : absoluteAudioPath)
        .inputOptions(absoluteAudioPath.endsWith(".raw") ? [
          "-f s16le",
          "-ar 24000",
          "-ac 1"
        ] : [])
        .videoFilters([
          {
            filter: "scale",
            options: {
              w: width,
              h: height,
              force_original_aspect_ratio: "decrease"
            }
          },
          {
            filter: "pad",
            options: {
              w: width,
              h: height,
              x: "(ow-iw)/2",
              y: "(oh-ih)/2",
              color: "black"
            }
          },
          {
            filter: "format",
            options: "yuv420p"
          }
        ])
        .outputOptions([
          "-c:v libx264",
          "-c:a aac",
          "-b:a 192k",
          `-t ${scene.duration}`,
          "-pix_fmt yuv420p",
          "-movflags +faststart",
          "-preset ultrafast",
          "-r 25"
        ])
        .on("start", (cmd) => console.log(`Starting simple scene ${i}: ${cmd}`))
        .on("end", () => resolve())
        .on("error", (err, stdout, stderr) => {
          console.error(`Simple scene ${i} error:`, err.message);
          console.error(`FFmpeg stderr:`, stderr);
          reject(new Error(`Scene ${i} failed: ${err.message}`));
        })
        .save(sceneOutput);
    });
    
    sceneVideos.push(sceneOutput);
    onProgress(10 + ((i + 1) / scenes.length) * 60, `Processed scene ${i + 1}/${scenes.length}`);
  }

  onProgress(80, "Merging and finalizing video");

  return new Promise((resolve, reject) => {
    const command = ffmpeg();
    
    sceneVideos.forEach((video) => {
      command.input(video);
    });

    const filterInputs = sceneVideos.map((_, i) => `[${i}:v][${i}:a]`).join("");
    
    command
      .complexFilter([
        {
          filter: "concat",
          options: { n: sceneVideos.length, v: 1, a: 1 },
          inputs: filterInputs,
          outputs: ["outv", "outa"]
        }
      ])
      .outputOptions([
        "-map [outv]",
        "-map [outa]",
        "-c:v libx264",
        "-c:a aac",
        "-pix_fmt yuv420p",
        "-preset ultrafast"
      ])
      .on("start", (cmd) => console.log(`FFmpeg Final Merge starting: ${cmd}`))
      .on("error", (err, stdout, stderr) => {
        console.error("FFmpeg Merge Error:", err.message);
        console.error("FFmpeg stderr:", stderr);
        reject(new Error(`Merging failed: ${err.message}`));
      })
      .on("end", () => {
        // Clean up temp scene videos if needed? For now just keep for debugging
        onProgress(100, "Video generation complete");
        resolve(`/outputs/${outputFileName}`);
      })
      .save(outputPath);
  });
}
