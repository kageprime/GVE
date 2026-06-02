import { useRef, useEffect, useState } from "react";
import type * as THREE from "three";

/**
 * ParticleSpirit — Procedural idle animation for the thinking state.
 *
 * A digital genie made of hundreds of flowing particles that spiral,
 * coalesce, and dissolve. Fully self-contained Three.js scene with
 * no external assets. Dark-themed with cyan/amber accents.
 */
export function ParticleSpirit({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let renderer: import("three").WebGLRenderer | null = null;
    let animationId = 0;

    async function init() {
      const THREE = await import("three");
      if (cancelled) return;

      const width = container!.clientWidth || 400;
      const height = container!.clientHeight || 280;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0a0a0f);

      const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);
      camera.position.set(0, 0, 5);

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      renderer.domElement.style.display = "block";
      renderer.domElement.style.borderRadius = "12px";
      container!.appendChild(renderer.domElement);

      // --- Particle System ---
      const particleCount = 400;
      const positions = new Float32Array(particleCount * 3);
      const colors = new Float32Array(particleCount * 3);
      const sizes = new Float32Array(particleCount);
      const seeds = new Float32Array(particleCount);

      const colorA = new THREE.Color(0x38bdf8); // cyan
      const colorB = new THREE.Color(0xfbbf24); // amber
      const colorC = new THREE.Color(0xa78bfa); // violet

      for (let i = 0; i < particleCount; i++) {
        const t = i / particleCount;
        seeds[i] = Math.random() * Math.PI * 2;
        sizes[i] = 0.02 + Math.random() * 0.04;

        // Initial spiral positions
        const angle = t * Math.PI * 8 + seeds[i];
        const radius = 0.5 + t * 2.5;
        const y = (Math.random() - 0.5) * 2;
        positions[i * 3] = Math.cos(angle) * radius;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = Math.sin(angle) * radius;

        // Gradient colors
        const colorMix = Math.random();
        const c = colorMix < 0.4 ? colorA : colorMix < 0.7 ? colorB : colorC;
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));

      const material = new THREE.PointsMaterial({
        size: 0.05,
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      });

      const points = new THREE.Points(geometry, material);
      scene.add(points);

      // --- Ambient glow spheres ---
      const glowGeo = new THREE.SphereGeometry(0.3, 16, 16);
      const glowMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.08,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const glow = new THREE.Mesh(glowGeo, glowMat);
      scene.add(glow);

      const glow2Mat = new THREE.MeshBasicMaterial({
        color: 0xfbbf24,
        transparent: true,
        opacity: 0.05,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const glow2 = new THREE.Mesh(glowGeo.clone(), glow2Mat);
      glow2.scale.setScalar(1.5);
      scene.add(glow2);

      setIsReady(true);

      // --- Animation Loop ---
      const clock = new THREE.Clock();

      function animate() {
        if (cancelled) return;
        animationId = requestAnimationFrame(animate);

        const time = clock.getElapsedTime();
        const posArray = geometry.attributes.position.array as Float32Array;

        for (let i = 0; i < particleCount; i++) {
          const seed = seeds[i];
          const t = i / particleCount;
          const phase = time * 0.6 + seed;

          // Spiral motion
          const spiralAngle = phase + t * Math.PI * 4;
          const spiralRadius = 0.3 + Math.sin(phase * 0.7) * 0.5 + t * 1.8;

          // Vertical wave
          const yWave = Math.sin(phase * 1.3 + t * Math.PI * 2) * 0.6;
          const yBreath = Math.sin(time * 1.2 + seed) * 0.15;

          // Coalescence effect — particles pull toward center periodically
          const coalesce = (Math.sin(time * 0.4) + 1) * 0.5; // 0→1→0 over ~15s
          const pullStrength = coalesce * 0.7;

          const x = Math.cos(spiralAngle) * spiralRadius * (1 - pullStrength * 0.5);
          const z = Math.sin(spiralAngle) * spiralRadius * (1 - pullStrength * 0.5);
          const y = yWave + yBreath + Math.sin(coalesce * Math.PI) * 0.3;

          posArray[i * 3] = x * (1 - pullStrength) + x * pullStrength * 0.3;
          posArray[i * 3 + 1] = y;
          posArray[i * 3 + 2] = z * (1 - pullStrength) + z * pullStrength * 0.3;

          // Pulsing sizes
          sizes[i] = 0.02 + Math.sin(phase * 2) * 0.015 + coalesce * 0.02;
        }

        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.size.needsUpdate = true;

        // Rotate entire system slowly
        points.rotation.y = time * 0.08;
        points.rotation.x = Math.sin(time * 0.15) * 0.1;

        // Glow orbs drift
        glow.position.x = Math.sin(time * 0.5) * 0.4;
        glow.position.y = Math.cos(time * 0.3) * 0.2;
        glow.position.z = Math.sin(time * 0.4) * 0.3;
        glow.scale.setScalar(1 + Math.sin(time * 1.5) * 0.3);

        glow2.position.x = Math.cos(time * 0.4) * 0.5;
        glow2.position.y = Math.sin(time * 0.6) * 0.3;
        glow2.position.z = Math.cos(time * 0.35) * 0.4;
        glow2.scale.setScalar(1.5 + Math.cos(time * 1.2) * 0.4);

        renderer!.render(scene, camera);
      }

      animate();
    }

    init();

    return () => {
      cancelled = true;
      if (animationId) cancelAnimationFrame(animationId);
      if (renderer) {
        renderer.dispose();
        if (container.contains(renderer.domElement)) {
          container.removeChild(renderer.domElement);
        }
      }
    };
  }, []);

  return (
    <div className={`relative overflow-hidden rounded-xl bg-[#0a0a0f] ${className || ""}`}>
      <div ref={containerRef} className="w-full h-[240px]" />
      {!isReady && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-2 w-2 rounded-full bg-cyan-400/40 animate-pulse" />
        </div>
      )}
      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
        <span className="text-[10px] font-mono uppercase tracking-wider text-white/20">
          AI Thinking
        </span>
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-cyan-400/60 animate-pulse" />
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400/60 animate-pulse" style={{ animationDelay: "0.2s" }} />
          <span className="h-1.5 w-1.5 rounded-full bg-violet-400/60 animate-pulse" style={{ animationDelay: "0.4s" }} />
        </div>
      </div>
    </div>
  );
}
