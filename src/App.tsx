import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { io, Socket } from "socket.io-client";
import { generateScript, generateImage, generateTTS } from "./services/ai";
import { 
  Video, 
  Upload, 
  Type, 
  Play, 
  Download, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  Layout,
  Smartphone,
  Plus,
  X,
  Zap
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Toaster, toast } from "sonner";

interface GenerationProgress {
  step: string;
  progress: number;
  videoUrl?: string;
  error?: string;
}

export default function App() {
  const [topic, setTopic] = useState("");
  const [format, setFormat] = useState<"landscape" | "portrait">("landscape");
  const [images, setImages] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);
    return () => {
      newSocket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (socket && currentJobId) {
      socket.on(`progress:${currentJobId}`, (data: GenerationProgress) => {
        setProgress(data);
        if (data.step === "Completed" || data.step === "Failed") {
          setIsGenerating(false);
        }
      });
    }
    return () => {
      if (socket && currentJobId) {
        socket.off(`progress:${currentJobId}`);
      }
    };
  }, [socket, currentJobId]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append("images", files[i]);
    }

    try {
      const res = await fetch("/api/upload-images", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      setImages([...images, ...data.paths]);
      toast.success("Images uploaded successfully");
    } catch (error) {
      toast.error("Failed to upload images");
    }
  };

  const startGeneration = async () => {
    if (!topic) {
      toast.error("Please enter a topic");
      return;
    }

    setIsGenerating(true);
    setProgress({ step: "Generating script...", progress: 5 });
    
    try {
      // 1. Generate Script
      const script = await generateScript(topic);
      
      const processedScenes = [];
      for (let i = 0; i < script.length; i++) {
        const sceneData = script[i];
        const sceneProgress = 10 + (i / script.length) * 40;
        setProgress({ step: `Generating assets for scene ${i + 1}...`, progress: sceneProgress });
        
        let imagePath = "";
        if (images[i]) {
          imagePath = images[i];
        } else {
          const imageBase64 = await generateImage(sceneData.imagePrompt);
          const uploadRes = await fetch("/api/upload-asset", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ base64: imageBase64, type: "image", extension: "png" }),
          });
          const uploadData = await uploadRes.json();
          imagePath = uploadData.path;
        }
        
        const audioBase64 = await generateTTS(sceneData.text);
        const audioRes = await fetch("/api/upload-asset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ base64: audioBase64, type: "audio", extension: "raw" }),
        });
        const audioData = await audioRes.json();
        
        processedScenes.push({
          imagePath: imagePath.startsWith("/") ? imagePath.substring(1) : imagePath,
          audioPath: audioData.path.startsWith("/") ? audioData.path.substring(1) : audioData.path,
          text: sceneData.text,
          duration: sceneData.duration || 3.5
        });
      }

      // 2. Start Video Processing on Server
      setProgress({ step: "Starting video processing...", progress: 50 });
      const res = await fetch("/api/process-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenes: processedScenes, format }),
      });
      const data = await res.json();
      setCurrentJobId(data.jobId);
    } catch (error) {
      setIsGenerating(false);
      console.error("Generation failed:", error);
      toast.error("Failed to generate video: " + (error instanceof Error ? error.message : "Unknown error"));
    }
  };

  const removeImage = (index: number) => {
    setImages(images.filter((_, i) => i !== index));
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-blue-500/30">
      <Toaster position="top-center" richColors />
      
      {/* Background Glow */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-blue-500/10 blur-[120px] rounded-full" />
        <div className="absolute -bottom-[10%] -right-[10%] w-[40%] h-[40%] bg-purple-500/10 blur-[120px] rounded-full" />
      </div>

      <header className="relative z-10 border-b border-white/10 backdrop-blur-md bg-black/20">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3 group cursor-pointer">
            <div className="relative">
              <motion.div 
                animate={{ 
                  rotate: [0, 360],
                }}
                transition={{ 
                  duration: 8, 
                  repeat: Infinity, 
                  ease: "linear" 
                }}
                className="absolute -inset-1 bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl blur opacity-30 group-hover:opacity-60 transition-opacity"
              />
              <motion.div 
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="relative w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20"
              >
                <motion.div
                  animate={{ 
                    scale: [1, 1.2, 1],
                    opacity: [0.8, 1, 0.8]
                  }}
                  transition={{ 
                    duration: 2, 
                    repeat: Infinity, 
                    ease: "easeInOut" 
                  }}
                >
                  <Zap className="w-6 h-6 text-white fill-white/20" />
                </motion.div>
              </motion.div>
            </div>
            <motion.h1 
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="text-2xl font-bold tracking-tighter italic"
            >
              Clipova <span className="text-blue-500 relative">
                AI
                <motion.span 
                  animate={{ 
                    top: ["0%", "100%", "0%"],
                  }}
                  transition={{ 
                    duration: 3, 
                    repeat: Infinity, 
                    ease: "linear" 
                  }}
                  className="absolute left-0 right-0 h-[1px] bg-blue-400/50 shadow-[0_0_8px_rgba(96,165,250,0.5)]"
                />
              </span>
            </motion.h1>
          </div>
          <div className="hidden md:flex items-center gap-6 text-sm font-medium text-white/60">
            <a href="#" className="hover:text-white transition-colors">Templates</a>
            <a href="#" className="hover:text-white transition-colors">Pricing</a>
            <a href="#" className="hover:text-white transition-colors">Docs</a>
            <Button className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 border-none shadow-lg shadow-blue-500/20">Sign In</Button>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-6 py-12 grid lg:grid-cols-2 gap-12">
        {/* Left Column: Input */}
        <div className="space-y-8">
          <div className="space-y-4">
            <h2 className="text-5xl font-extrabold tracking-tight leading-[1.1]">
              Turn your ideas into <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-600">stunning videos</span> in seconds.
            </h2>
            <p className="text-lg text-white/60 max-w-lg">
              Our AI handles the script, voiceover, and editing. Just provide a topic or upload your own images.
            </p>
          </div>

          <Card className="bg-white/5 border-white/10 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-white">Create New Video</CardTitle>
              <CardDescription className="text-white/40">Configure your video generation settings</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="topic" className="text-white/80">What is your video about?</Label>
                <Input 
                  id="topic"
                  placeholder="e.g. The future of space exploration"
                  className="bg-white/5 border-white/10 focus:border-blue-500/50 transition-all h-12 text-white"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  disabled={isGenerating}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-white/80">Video Format</Label>
                <Tabs value={format} onValueChange={(v) => setFormat(v as any)} className="w-full">
                  <TabsList className="grid grid-cols-2 bg-white/5 border border-white/10">
                    <TabsTrigger value="landscape" className="data-[state=active]:bg-blue-500 data-[state=active]:text-white">
                      <Layout className="w-4 h-4 mr-2" />
                      Landscape (16:9)
                    </TabsTrigger>
                    <TabsTrigger value="portrait" className="data-[state=active]:bg-blue-500 data-[state=active]:text-white">
                      <Smartphone className="w-4 h-4 mr-2" />
                      Portrait (9:16)
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              <div className="space-y-2">
                <Label className="text-white/80">Reference Images (Optional)</Label>
                <div className="grid grid-cols-4 gap-3">
                  {images.map((img, i) => (
                    <div key={i} className="relative aspect-square rounded-lg overflow-hidden border border-white/10 group">
                      <img src={img} alt="Uploaded" className="w-full h-full object-cover" />
                      <button 
                        onClick={() => removeImage(i)}
                        className="absolute top-1 right-1 p-1 bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isGenerating}
                    className="aspect-square rounded-lg border-2 border-dashed border-white/10 flex flex-col items-center justify-center hover:border-blue-500/50 hover:bg-white/5 transition-all"
                  >
                    <Plus className="w-6 h-6 text-white/40" />
                    <span className="text-[10px] text-white/40 mt-1 uppercase font-bold tracking-widest">Upload</span>
                  </button>
                </div>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  multiple 
                  accept="image/*"
                  onChange={handleImageUpload}
                />
              </div>
            </CardContent>
            <CardFooter>
              <Button 
                className="w-full h-14 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-lg font-bold shadow-xl shadow-blue-500/20 transition-all active:scale-[0.98]"
                onClick={startGeneration}
                disabled={isGenerating}
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Play className="w-5 h-5 mr-2" />
                    Generate Video
                  </>
                )}
              </Button>
            </CardFooter>
          </Card>
        </div>

        {/* Right Column: Progress & Result */}
        <div className="relative">
          <AnimatePresence mode="wait">
            {!progress && !isGenerating ? (
              <motion.div 
                key="empty"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="h-full flex flex-col items-center justify-center text-center space-y-6 p-12 border-2 border-dashed border-white/5 rounded-3xl"
              >
                <div className="w-24 h-24 bg-white/5 rounded-full flex items-center justify-center">
                  <Zap className="w-10 h-10 text-white/20" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-bold">Ready to generate</h3>
                  <p className="text-white/40 max-w-xs">Enter a topic and click generate to see the magic happen.</p>
                </div>
              </motion.div>
            ) : (
              <motion.div 
                key="active"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="space-y-6"
              >
                <Card className="bg-white/5 border-white/10 overflow-hidden">
                  <div className="aspect-video bg-black relative flex items-center justify-center">
                    {progress?.videoUrl ? (
                      <video 
                        src={progress.videoUrl} 
                        controls 
                        className="w-full h-full object-contain"
                        autoPlay
                      />
                    ) : progress?.error ? (
                      <div className="flex flex-col items-center text-red-500 gap-2">
                        <AlertCircle className="w-12 h-12" />
                        <p className="font-bold">Generation Failed</p>
                        <p className="text-sm text-white/40">{progress.error}</p>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-4">
                        <div className="relative">
                          <div className="w-20 h-20 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-sm font-bold">{Math.round(progress?.progress || 0)}%</span>
                          </div>
                        </div>
                        <p className="text-white/60 font-medium animate-pulse">{progress?.step || "Preparing..."}</p>
                      </div>
                    )}
                  </div>
                  <CardContent className="p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <h3 className="font-bold text-lg">
                          {progress?.step === "Completed" ? "Video Ready!" : "Generating Video..."}
                        </h3>
                        <p className="text-sm text-white/40">
                          {progress?.step === "Completed" ? "Your video is ready for download." : "This may take a few minutes."}
                        </p>
                      </div>
                      {progress?.step === "Completed" && (
                        <CheckCircle2 className="w-8 h-8 text-green-500" />
                      )}
                    </div>
                    
                    <Progress value={progress?.progress || 0} className="h-2 bg-white/5" />
                    
                    <div className="flex gap-3">
                      <Button 
                        variant="outline" 
                        className="flex-1 border-white/10 hover:bg-white/5"
                        disabled={!progress?.videoUrl}
                        onClick={() => window.open(progress?.videoUrl, "_blank")}
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Download MP4
                      </Button>
                      <Button 
                        variant="outline" 
                        className="flex-1 border-white/10 hover:bg-white/5"
                        onClick={() => {
                          setProgress(null);
                          setCurrentJobId(null);
                        }}
                      >
                        Create Another
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Log/History */}
                <Card className="bg-white/5 border-white/10">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm uppercase tracking-widest text-white/40">Generation Log</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-32">
                      <div className="space-y-2 text-sm font-mono text-white/60">
                        <div className="flex items-center gap-2">
                          <span className="text-blue-500">[{new Date().toLocaleTimeString()}]</span>
                          <span>Job initialized: {currentJobId}</span>
                        </div>
                        {progress && (
                          <div className="flex items-center gap-2">
                            <span className="text-blue-500">[{new Date().toLocaleTimeString()}]</span>
                            <span>{progress.step} - {Math.round(progress.progress)}%</span>
                          </div>
                        )}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      <footer className="relative z-10 border-t border-white/10 mt-24 py-12">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2 text-white/40 text-sm">
            <Zap className="w-4 h-4" />
            <span>© 2026 Clipova AI. All rights reserved.</span>
          </div>
          <div className="flex items-center gap-8 text-sm font-medium text-white/40">
            <a href="#" className="hover:text-white transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-white transition-colors">Terms of Service</a>
            <a href="#" className="hover:text-white transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
