import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { io, Socket } from "socket.io-client";
import { generateScript, generateImage, generateTTS, analyzeVisualStyle, detectFace } from "./services/ai";
import { logActivity } from "./services/logging";
import { auth, db } from "./lib/firebase";
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from "firebase/auth";
import { collection, query, orderBy, limit, onSnapshot, Timestamp } from "firebase/firestore";
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
  Zap,
  Languages,
  Activity,
  History,
  ShieldCheck,
  User as UserIcon,
  LogOut
} from "lucide-react";
import { MovingBackground } from "./components/MovingBackground";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  const [language, setLanguage] = useState("English");
  const [videoDuration, setVideoDuration] = useState<number | "">(10);
  const [mood, setMood] = useState<"cinematic" | "dramatic" | "peaceful" | "energetic">("cinematic");
  const [motionIntensity, setMotionIntensity] = useState<"subtle" | "medium" | "dramatic">("medium");
  const [images, setImages] = useState<string[]>([]);
  const [imageB64s, setImageB64s] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState("create");
  const [systemLogs, setSystemLogs] = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) {
        logActivity({ action: "session_start", status: "success" });
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (user?.email === "pranavgupta121@gmail.com") {
      const q = query(collection(db, "logs"), orderBy("timestamp", "desc"), limit(50));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setSystemLogs(logs);
      });
      return () => unsubscribe();
    }
  }, [user]);

  const handleSignIn = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      toast.success("Signed in successfully");
    } catch (error) {
      toast.error("Failed to sign in");
    }
  };

  const handleSignOut = async () => {
    await auth.signOut();
    toast.success("Signed out");
  };

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
    const newB64s: string[] = [];
    
    for (let i = 0; i < files.length; i++) {
      formData.append("images", files[i]);
      const reader = new FileReader();
      const b64 = await new Promise<string>((resolve) => {
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.readAsDataURL(files[i]);
      });
      newB64s.push(b64);
    }

    try {
      const res = await fetch("/api/upload-images", {
        method: "POST",
        body: formData,
      });
      
      if (!res.ok) {
        let errorMessage = "Upload failed";
        try {
          const errorData = await res.json();
          errorMessage = errorData.error || errorMessage;
        } catch (jsonErr) {
          const text = await res.text();
          console.error("Server returned non-JSON error:", text);
          errorMessage = `Server Error (${res.status})`;
        }
        throw new Error(errorMessage);
      }

      const data = await res.json();
      setImages([...images, ...data.paths]);
      setImageB64s([...imageB64s, ...newB64s]);
      toast.success("Images uploaded successfully");
      logActivity({ action: "upload_images", details: { count: files.length }, status: "success" });
    } catch (error: any) {
      console.error("Upload error:", error);
      toast.error(error.message || "Failed to upload images");
      logActivity({ action: "upload_images_failed", details: { error: error.message }, status: "failed" });
    }
  };

  const startGeneration = async () => {
    if (!topic) {
      toast.error("Please enter a topic");
      return;
    }

    if (!videoDuration || videoDuration < 1 || videoDuration > 600) {
      toast.error("Please enter a valid video duration (1-600 seconds)");
      setIsGenerating(false);
      return;
    }

    setIsGenerating(true);
    setProgress({ step: "Analyzing style...", progress: 2 });
    logActivity({ action: "start_generation", details: { topic, duration: videoDuration, format, language }, status: "pending" });
    
    try {
      let visualStyle = "";
      if (imageB64s.length > 0) {
        visualStyle = await analyzeVisualStyle(imageB64s);
      }

      // 1. Generate Script
      setProgress({ step: "Generating script...", progress: 5 });
      const script = await generateScript(topic, language, visualStyle, Number(videoDuration), mood);
      
      const processedScenes = [];
      for (let i = 0; i < script.length; i++) {
        const sceneData = script[i];
        const sceneProgress = 10 + (i / script.length) * 40;
        
        let imagePath = "";
        let faceFocus = undefined;

        // PRODUCT REQUIREMENT: Only use user's picture if provided
        if (imageB64s.length > 0) {
          const currentImgB64 = imageB64s[i % imageB64s.length];
          
          setProgress({ step: `Processing Avatar scene ${i + 1}/${script.length}...`, progress: sceneProgress });
          // Free Path: Use Image + Face Centric Animation
          const uploadRes = await fetch("/api/upload-asset", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ base64: currentImgB64, type: "image", extension: "png" }),
          });
          const uploadData = await uploadRes.json();
          imagePath = uploadData.path;

          // Detect face for better focus (Free path still uses standard Gemini Flash)
          faceFocus = await detectFace(currentImgB64);
        } else {
          setProgress({ step: `Generating scene ${i + 1}/${script.length}...`, progress: sceneProgress });
          // Fallback to image generation if no pictures provided
          const imageBase64 = await generateImage(sceneData.imagePrompt);
          const uploadRes = await fetch("/api/upload-asset", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ base64: imageBase64, type: "image", extension: "png" }),
          });
          const uploadData = await uploadRes.json();
          imagePath = uploadData.path;
        }
        
        const audioBase64 = await generateTTS(sceneData.text, language);
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
          duration: sceneData.duration || 3.5,
          faceFocus,
          motionType: sceneData.motionType
        });
      }

      // 2. Start Video Processing on Server
      setProgress({ step: "Starting video processing...", progress: 50 });
      const res = await fetch("/api/process-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenes: processedScenes, format, mood, motionIntensity }),
      });
      const data = await res.json();
      setCurrentJobId(data.jobId);
      logActivity({ action: "video_processing_started", details: { jobId: data.jobId }, status: "success" });
    } catch (error: any) {
      setIsGenerating(false);
      console.error("Generation failed:", error);
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      toast.error("Failed to generate video: " + errorMsg);
      logActivity({ action: "generation_failed", details: { error: errorMsg }, status: "failed" });
    }
  };

  const removeImage = (index: number) => {
    setImages(images.filter((_, i) => i !== index));
    setImageB64s(imageB64s.filter((_, i) => i !== index));
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-orange-500/30">
      <Toaster position="top-center" richColors />
      
      <MovingBackground />

      <header className="relative z-10 border-b border-white/10 backdrop-blur-sm bg-black/10">
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
                className="absolute -inset-1 bg-gradient-to-r from-orange-500 to-red-600 rounded-xl blur opacity-30 group-hover:opacity-60 transition-opacity"
              />
              <motion.div 
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="relative w-10 h-10 bg-gradient-to-br from-orange-500 to-red-600 rounded-xl flex items-center justify-center shadow-lg shadow-orange-500/20"
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
              className="text-2xl font-bold tracking-tighter"
            >
              Clipova <span className="text-orange-500 relative">
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
                  className="absolute left-0 right-0 h-[1px] bg-amber-400/50 shadow-[0_0_8px_rgba(251,191,36,0.5)]"
                />
              </span>
            </motion.h1>
          </div>
          <div className="hidden md:flex items-center gap-6 text-sm font-medium text-white/60">
            <a href="#" className="hover:text-white transition-colors">Templates</a>
            <a href="#" className="hover:text-white transition-colors">Pricing</a>
            <a href="#" className="hover:text-white transition-colors">Docs</a>
            {user ? (
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded-full border border-white/10">
                  <div className="w-6 h-6 rounded-full overflow-hidden border border-white/20">
                    <img src={user.photoURL || ""} alt={user.displayName || "User"} referrerPolicy="no-referrer" />
                  </div>
                  <span className="text-xs">{user.displayName}</span>
                </div>
                <Button variant="ghost" size="icon" onClick={handleSignOut} className="text-white/40 hover:text-white">
                  <LogOut className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <Button onClick={handleSignIn} className="bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 border-none shadow-lg shadow-orange-500/20">Sign In</Button>
            )}
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-6 py-12">
        <div className="flex items-center justify-between mb-8">
          <div className="space-y-2">
            <h2 className="text-3xl font-extrabold tracking-tight leading-[1.1]">
              Turn your ideas into <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-red-600">living stories</span>.
            </h2>
            <p className="text-lg text-white/60 max-w-xl">
              Animate your portrait for free using Natural Motion Focus and our cinematic storytelling engine.
            </p>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-auto">
            <TabsList className="bg-white/5 border border-white/10">
              <TabsTrigger value="create" className="data-[state=active]:bg-orange-500 transition-all">
                <Zap className="w-4 h-4 mr-2" />
                Studio
              </TabsTrigger>
              {user?.email === "pranavgupta121@gmail.com" && (
                <TabsTrigger value="monitoring" className="data-[state=active]:bg-orange-500 transition-all">
                  <ShieldCheck className="w-4 h-4 mr-2" />
                  Monitoring
                </TabsTrigger>
              )}
            </TabsList>
          </Tabs>
        </div>

        <div className="grid lg:grid-cols-2 gap-12">
          {activeTab === "create" ? (
            <>
              {/* Left Column: Input */}
              <div className="space-y-8">
                <Card className="bg-white/[0.02] border-white/10 backdrop-blur-md">
                  <CardHeader>
                    <CardTitle className="text-white">Create New Video</CardTitle>
                    <CardDescription className="text-white/40">Configure your video generation settings</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="md:col-span-2 space-y-2">
                        <Label htmlFor="topic" className="text-white/80">Story / Video Requirement (About)</Label>
                        <Textarea 
                          id="topic"
                          placeholder="Describe the story or what characters should say..."
                          className="bg-white/5 border-white/10 focus:border-orange-500/50 transition-all h-24 text-white resize-none"
                          value={topic}
                          onChange={(e) => setTopic(e.target.value)}
                          disabled={isGenerating}
                        />
                      </div>

                      <div className="md:col-span-1 space-y-2">
                        <Label htmlFor="duration" className="text-white/80 flex items-center gap-2">
                          <Video className="w-4 h-4 text-orange-500" />
                          Duration (s)
                        </Label>
                        <Input 
                          id="duration"
                          type="number"
                          min={1}
                          max={600}
                          value={videoDuration}
                          onChange={(e) => {
                            let rawVal = e.target.value;
                            if (rawVal.length > 3) {
                              rawVal = rawVal.slice(0, 3);
                            }
                            if (rawVal === "") {
                              setVideoDuration("");
                              return;
                            }
                            const val = parseInt(rawVal);
                            if (!isNaN(val)) setVideoDuration(val);
                          }}
                          className="bg-white/5 border-white/10 focus:border-orange-500/50 transition-all h-12 text-white text-lg font-bold"
                          disabled={isGenerating}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <Label className="text-white/80">Video Format</Label>
                        <Tabs value={format} onValueChange={(v) => setFormat(v as any)} className="w-full">
                          <TabsList className="grid grid-cols-2 bg-white/5 border border-white/10 h-14 p-1 w-full">
                            <TabsTrigger value="landscape" className="h-full data-[state=active]:bg-gradient-to-r data-[state=active]:from-orange-500 data-[state=active]:to-red-600 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-orange-500/30 font-bold transition-all px-3 flex items-center justify-center gap-2">
                              <Layout className="w-4 h-4 shrink-0" />
                              <span className="text-xs uppercase tracking-tight whitespace-nowrap">Landscape</span>
                            </TabsTrigger>
                            <TabsTrigger value="portrait" className="h-full data-[state=active]:bg-gradient-to-r data-[state=active]:from-orange-500 data-[state=active]:to-red-600 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-orange-500/30 font-bold transition-all px-3 flex items-center justify-center gap-2">
                              <Smartphone className="w-4 h-4 shrink-0" />
                              <span className="text-xs uppercase tracking-tight whitespace-nowrap">Portrait</span>
                            </TabsTrigger>
                          </TabsList>
                        </Tabs>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-white/80">Cinematic Mood</Label>
                        <Tabs value={mood} onValueChange={(v) => setMood(v as any)} className="w-full">
                          <TabsList className="grid grid-cols-4 bg-white/5 border border-white/10 h-14 p-1 w-full overflow-hidden">
                            <TabsTrigger value="cinematic" className="h-full data-[state=active]:bg-orange-500 data-[state=active]:text-white text-[10px] uppercase font-bold transition-all px-1">Cinematic</TabsTrigger>
                            <TabsTrigger value="dramatic" className="h-full data-[state=active]:bg-orange-500 data-[state=active]:text-white text-[10px] uppercase font-bold transition-all px-1">Dramatic</TabsTrigger>
                            <TabsTrigger value="peaceful" className="h-full data-[state=active]:bg-orange-500 data-[state=active]:text-white text-[10px] uppercase font-bold transition-all px-1">Peaceful</TabsTrigger>
                            <TabsTrigger value="energetic" className="h-full data-[state=active]:bg-orange-500 data-[state=active]:text-white text-[10px] uppercase font-bold transition-all px-1">Energy</TabsTrigger>
                          </TabsList>
                        </Tabs>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-white/80">Motion Intensity</Label>
                        <Tabs value={motionIntensity} onValueChange={(v) => setMotionIntensity(v as any)} className="w-full">
                          <TabsList className="grid grid-cols-3 bg-white/5 border border-white/10 h-14 p-1 w-full">
                            <TabsTrigger value="subtle" className="h-full data-[state=active]:bg-orange-500 data-[state=active]:text-white text-[10px] uppercase font-bold transition-all px-1">Subtle</TabsTrigger>
                            <TabsTrigger value="medium" className="h-full data-[state=active]:bg-orange-500 data-[state=active]:text-white text-[10px] uppercase font-bold transition-all px-1">Medium</TabsTrigger>
                            <TabsTrigger value="dramatic" className="h-full data-[state=active]:bg-orange-500 data-[state=active]:text-white text-[10px] uppercase font-bold transition-all px-1">Dramatic</TabsTrigger>
                          </TabsList>
                        </Tabs>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-white/80">Voice Language</Label>
                        <Tabs value={language} onValueChange={setLanguage} className="w-full">
                          <TabsList className="grid grid-cols-2 bg-white/5 border border-white/10 h-14 p-1 w-full">
                            <TabsTrigger value="English" className="h-full data-[state=active]:bg-gradient-to-r data-[state=active]:from-orange-500 data-[state=active]:to-red-600 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-orange-500/30 font-bold transition-all px-3 flex items-center justify-center gap-2">
                              <Languages className="w-4 h-4 shrink-0" />
                              <span className="text-xs uppercase tracking-tight whitespace-nowrap">English</span>
                            </TabsTrigger>
                            <TabsTrigger value="Hindi" className="h-full data-[state=active]:bg-gradient-to-r data-[state=active]:from-orange-500 data-[state=active]:to-red-600 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-orange-500/30 font-bold transition-all px-3 flex items-center justify-center gap-2">
                              <Languages className="w-4 h-4 shrink-0" />
                              <span className="text-xs uppercase tracking-tight whitespace-nowrap">Hindi</span>
                            </TabsTrigger>
                          </TabsList>
                        </Tabs>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-white/80">Reference Images</Label>
                        <div className="grid grid-cols-3 gap-2">
                          {images.map((img, i) => (
                            <div key={i} className="relative aspect-square rounded-lg overflow-hidden border border-white/10 group h-14">
                              <img src={img} alt="Uploaded" className="w-full h-full object-cover" />
                              <button 
                                onClick={() => removeImage(i)}
                                className="absolute top-0 right-0 p-1 bg-black/50 rounded-bl-lg opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <X className="w-2 h-2" />
                              </button>
                            </div>
                          ))}
                          <button 
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isGenerating}
                            className="aspect-square rounded-lg border-2 border-dashed border-white/10 h-14 flex items-center justify-center hover:border-orange-500/50 hover:bg-white/5 transition-all text-white/40"
                          >
                            <Plus className="w-5 h-5" />
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
                    </div>
                  </CardContent>
                  <CardFooter className="flex flex-col gap-4">
                    <Button 
                      className="w-full h-14 bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 text-lg font-bold shadow-xl shadow-orange-500/20 transition-all active:scale-[0.98]"
                      onClick={startGeneration}
                      disabled={isGenerating}
                    >
                      {isGenerating ? (
                        <>
                          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                          Generating Living Story...
                        </>
                      ) : (
                        <>
                          <Play className="w-5 h-5 mr-2" />
                          {imageB64s.length > 0 
                            ? "Generate Expressive Avatar (Free)" 
                            : "Generate Video (Free)"}
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
                      <Card className="bg-white/[0.02] border-white/10 overflow-hidden backdrop-blur-md">
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
                                <div className="w-20 h-20 border-4 border-orange-500/20 border-t-orange-500 rounded-full animate-spin" />
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
                          
                          <Progress value={progress?.progress || 0} className="h-2 bg-white/5" style={{ "--progress-foreground": "rgba(249, 115, 22, 1)" } as any} />
                          
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
                      <Card className="bg-white/[0.02] border-white/10 backdrop-blur-md">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm uppercase tracking-widest text-white/40">Generation Log</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <ScrollArea className="h-32">
                            <div className="space-y-2 text-sm font-mono text-white/60">
                              <div className="flex items-center gap-2">
                                <span className="text-orange-500">[{new Date().toLocaleTimeString()}]</span>
                                <span>Job initialized: {currentJobId}</span>
                              </div>
                              {progress && (
                                <div className="flex items-center gap-2">
                                  <span className="text-orange-500">[{new Date().toLocaleTimeString()}]</span>
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
            </>
          ) : (
            <div className="lg:col-span-2 space-y-6">
              <Card className="bg-white/[0.02] border-white/10 backdrop-blur-md">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="w-5 h-5 text-orange-500" />
                    Live System Activity
                  </CardTitle>
                  <CardDescription>Real-time monitoring of user actions and system events</CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[600px] pr-4">
                    <div className="space-y-4">
                      {systemLogs.map((log) => (
                        <div key={log.id} className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-2 group hover:bg-white/10 transition-colors">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className={`p-2 rounded-lg ${
                                log.status === 'success' ? 'bg-green-500/20 text-green-500' :
                                log.status === 'failed' ? 'bg-red-500/20 text-red-500' :
                                'bg-orange-500/20 text-orange-500'
                              }`}>
                                <Activity className="w-4 h-4" />
                              </div>
                              <div>
                                <p className="font-bold capitalize">{log.action.replace(/_/g, ' ')}</p>
                                <p className="text-xs text-white/40">{log.userId}</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-xs font-mono text-white/40">
                                {log.timestamp instanceof Timestamp ? log.timestamp.toDate().toLocaleString() : 'Just now'}
                              </p>
                              <span className={`text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 rounded ${
                                log.status === 'success' ? 'bg-green-500/20 text-green-500' :
                                log.status === 'failed' ? 'bg-red-500/20 text-red-500' :
                                'bg-orange-500/20 text-orange-500'
                              }`}>
                                {log.status}
                              </span>
                            </div>
                          </div>
                          {log.details && (
                            <div className="pl-11">
                              <div className="bg-black/40 rounded-lg p-3 text-xs font-mono text-white/60 overflow-hidden">
                                <pre className="whitespace-pre-wrap">{JSON.stringify(log.details, null, 2)}</pre>
                              </div>
                            </div>
                          )}
                          <div className="pl-11 text-[10px] text-white/20 truncate">
                            {log.userAgent}
                          </div>
                        </div>
                      ))}
                      {systemLogs.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-20 text-white/20">
                          <History className="w-12 h-12 mb-4 opacity-50" />
                          <p>No activity logs found</p>
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          )}
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
