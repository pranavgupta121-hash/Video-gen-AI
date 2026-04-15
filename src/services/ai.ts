import { GoogleGenAI, Type, Modality } from "@google/genai";

// Initialize AI in the frontend as per SKILL.md
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface Scene {
  text: string;
  imagePrompt: string;
  duration: number;
}

export async function generateScript(topic: string): Promise<Scene[]> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Generate a short video script for a video about: ${topic}. 
    Break it down into 2-3 scenes. 
    For each scene, provide the spoken text and a descriptive prompt for an image generator.
    The total duration of all scenes combined MUST be exactly 10 seconds.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            text: { type: Type.STRING },
            imagePrompt: { type: Type.STRING },
            duration: { type: Type.NUMBER, description: "Duration in seconds" },
          },
          required: ["text", "imagePrompt", "duration"],
        },
      },
    },
  });

  return JSON.parse(response.text || "[]");
}

export async function generateImage(prompt: string): Promise<string> {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: { parts: [{ text: prompt }] },
  });

  let base64Data = "";
  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      base64Data = part.inlineData.data;
      break;
    }
  }

  if (!base64Data) throw new Error("Failed to generate image");
  return base64Data;
}

export async function generateTTS(text: string): Promise<string> {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: `Say clearly: ${text}` }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: "Kore" },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) throw new Error("Failed to generate TTS");
  return base64Audio;
}
