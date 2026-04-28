import { GoogleGenAI, Type, Modality } from "@google/genai";

// Standard AI for text/images
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

/**
 * Robust retry wrapper for Gemini API calls to handle quota (429) errors.
 */
async function withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 2000): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const isQuotaError = error?.message?.includes('429') || 
                         error?.message?.includes('RESOURCE_EXHAUSTED') ||
                         error?.status === 429;
                         
    if (isQuotaError && retries > 0) {
      console.warn(`Gemini Quota hit. Retrying in ${delay / 1000}s... (${retries} left)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return withRetry(fn, retries - 1, delay * 2); // Exponential backoff
    }
    throw error;
  }
}

export interface Scene {
  text: string;
  imagePrompt: string;
  duration: number;
  motionType?: "slow_zoom_out" | "intimate_zoom" | "gentle_pan" | "static";
}

export interface FaceBox {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

export async function detectFace(base64Image: string): Promise<FaceBox | null> {
  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { inlineData: { mimeType: "image/png", data: base64Image } },
          { text: "Detect the main face in this image. Return ONLY a JSON object with ymin, xmin, ymax, xmax normalized from 0 to 1000. Example: {\"ymin\": 100, \"xmin\": 200, \"ymax\": 300, \"xmax\": 400}" }
        ]
      },
      config: {
        responseMimeType: "application/json"
      }
    });

    try {
      const text = response.text || "null";
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  });
}

export async function analyzeVisualStyle(imageB64s: string[]): Promise<string> {
  if (imageB64s.length === 0) return "";

  return withRetry(async () => {
    const parts: any[] = imageB64s.map(b64 => ({
      inlineData: {
        mimeType: "image/png",
        data: b64
      }
    }));

    parts.push({ 
      text: "Analyze these images and provide a concise one-paragraph description of their consistent visual style, artistic medium, color palette, lighting, and mood. This description will be used to generate a cinematic talking-head video where the character speaks naturally." 
    });

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts }
    });

    return response.text || "";
  });
}

export async function generateScript(topic: string, language: string = "English", visualStyle: string = "", targetDuration: number = 10, mood: string = "cinematic"): Promise<Scene[]> {
  const stylePrompt = visualStyle 
    ? `\nCRITICAL: The video features a consistent character from this style: ${visualStyle}\nEnsure the imagePrompt field focus on facial performance and cinematic lighting.`
    : "";

  const responseText = await withRetry(async () => {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: `You are a professional video scriptwriter for AI Avatars. Create a deep, engaging, and highly visual script specifically about: "${topic}".
      
      USER INSTRUCTIONS:
      - The script and spoken text MUST be in ${language}.${stylePrompt}
      - The mood of the story is: ${mood}.
      - The story must follow the user's specific request.
      - Break it down into 3-6 scenes. 
      - Each scene represents a shot of a character speaking.
      
      TECHNICAL CONSTRAINTS:
      1. The TOTAL duration (sum of all scene durations) MUST be EXACTLY ${targetDuration} seconds.
      2. Match the 'text' length to the 'duration' (exactly 2.5 words per second for natural speed).
      3. Use 'motionType' to suggest a cinematic move: slow_zoom_out, intimate_zoom, gentle_pan, or static.
      4. The 'duration' must be a number representing seconds.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING, description: "The spoken voiceover text" },
              imagePrompt: { type: Type.STRING, description: "Visual description for the speaking shot" },
              duration: { type: Type.NUMBER, description: "Display duration in seconds" },
              motionType: { type: Type.STRING, enum: ["slow_zoom_out", "intimate_zoom", "gentle_pan", "static"] }
            },
            required: ["text", "imagePrompt", "duration", "motionType"],
          },
        },
      },
    });
    return response.text || "[]";
  });

  let scenes: Scene[] = JSON.parse(responseText);
  
  // Normalize durations to ensure they sum exactly to targetDuration
  const currentTotal = scenes.reduce((acc, s) => acc + (s.duration || 0), 0);
  if (currentTotal > 0 && Math.abs(currentTotal - targetDuration) > 0.1) {
    const factor = targetDuration / currentTotal;
    scenes = scenes.map(s => ({
      ...s,
      duration: Number((s.duration * factor).toFixed(2))
    }));
    
    // Fix rounding errors
    const newTotal = scenes.reduce((acc, s) => acc + s.duration, 0);
    const diff = targetDuration - newTotal;
    if (scenes.length > 0) {
      scenes[scenes.length - 1].duration = Number((scenes[scenes.length - 1].duration + diff).toFixed(2));
    }
  }

  return scenes;
}

export async function generateImage(prompt: string): Promise<string> {
  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: { parts: [{ text: prompt }] },
    });

    let base64Data = "";
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        base64Data = part.inlineData.data || "";
        break;
      }
    }

    if (!base64Data) throw new Error("Failed to generate image");
    return base64Data;
  });
}

export async function generateTTS(text: string, language: string = "English"): Promise<string> {
  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-tts-preview",
      contents: [{ parts: [{ text: `Say clearly and naturally: ${text}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { 
              voiceName: "Kore" 
            },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) throw new Error("Failed to generate TTS");
    return base64Audio;
  });
}
