import React, { useEffect, useRef } from 'react';

export const MovingBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width: number;
    let height: number;

    const particles: Particle[] = [];
    const particleCount = 50;
    const connectionDistance = 150;

    class Particle {
      x: number;
      y: number;
      vx: number;
      vy: number;
      size: number;

      constructor() {
        this.x = Math.random() * width;
        this.y = Math.random() * height;
        this.vx = (Math.random() - 0.5) * 0.5;
        this.vy = (Math.random() - 0.5) * 0.5;
        this.size = Math.random() * 2 + 1;
      }

      update() {
        this.x += this.vx;
        this.y += this.vy;

        if (this.x < 0 || this.x > width) this.vx *= -1;
        if (this.y < 0 || this.y > height) this.vy *= -1;
      }

      draw() {
        if (!ctx) return;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(249, 115, 22, 0.5)'; // Orange-500
        ctx.fill();
      }
    }

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
      
      particles.length = 0;
      for (let i = 0; i < particleCount; i++) {
        particles.push(new Particle());
      }
    };

    const drawGrid = (time: number) => {
      if (!ctx) return;
      const gridSize = 100;
      const moveSpeed = time * 0.05;

      ctx.strokeStyle = 'rgba(239, 68, 68, 0.1)'; // Increased from 0.03
      ctx.lineWidth = 1;

      // Perspective Grid Lines
      const centerX = width / 2;
      const horizon = height * 0.1; // Horizon line

      // Radial/Vanishing lines
      for (let x = -width; x < width * 2; x += gridSize * 2) {
        ctx.beginPath();
        ctx.moveTo(centerX, horizon);
        ctx.lineTo(x, height);
        ctx.stroke();
      }

      // Horizontal "moving" lines
      for (let i = 0; i < 20; i++) {
        const yPos = horizon + (Math.pow(i / 20, 2) * (height - horizon));
        const movingY = (yPos + moveSpeed) % (height - horizon);
        const finalY = horizon + movingY;
        
        ctx.beginPath();
        ctx.moveTo(0, finalY);
        ctx.lineTo(width, finalY);
        ctx.stroke();
      }
    };

    const animate = (time: number) => {
      ctx.clearRect(0, 0, width, height);

      drawGrid(time);

      particles.forEach((p, i) => {
        p.update();
        p.draw();

        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const dx = p.x - p2.x;
          const dy = p.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < connectionDistance) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            const alpha = 1 - dist / connectionDistance;
            ctx.strokeStyle = `rgba(251, 191, 36, ${alpha * 0.4})`; // Increased from 0.2
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      });

      animationFrameId = requestAnimationFrame(animate);
    };

    window.addEventListener('resize', resize);
    resize();
    animate(0);

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="fixed inset-0 pointer-events-none z-0 bg-[#0a0a0a]"
        style={{ opacity: 1.0 }}
      />
      {/* Radial overlay for depth and focus */}
      <div 
        className="fixed inset-0 pointer-events-none z-0" 
        style={{ background: 'radial-gradient(circle at 50% 50%, transparent 0%, rgba(10, 10, 10, 0.4) 40%, rgba(10, 10, 10, 1) 100%)' }}
      />
    </>
  );
};
