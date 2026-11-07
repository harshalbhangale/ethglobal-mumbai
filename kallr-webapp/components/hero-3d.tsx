"use client";

import { type ReactNode, useEffect, useRef } from "react";

/**
 * The landing's 3D story. ~18k particles form the Kall logo with real calls orbiting it, then morph as you
 * scroll: a price chart (every call is priced), a globe (any app, any device), and back to the logo.
 * Three.js loads from a pinned CDN build at runtime; without WebGL the sections still read on the dark page.
 */
const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.160.0/+esm";
const addon = (p: string) => `https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/${p}.js/+esm`;

/** Real calls and fills Kall recorded on Arkiv. */
const CALLS: Array<[string, string, string, string]> = [
  ["@AltcoinSherpa", "Time to pump $SOL", "HIT +1.20%", "#c6f25a"],
  ["@CryptoKaleo", "$ETH Up only.", "MISS −6.47%", "#ff6b5a"],
  ["@inmortalcrypto", "accumulate … $BTC", "HIT +1.23%", "#c6f25a"],
  ["@CryptoKaleo", "$100K+ IS A MAGNET", "MISS −5.11%", "#ff6b5a"],
  ["$TOSHI · 0x8544…4a8c", "Call check failed", "BLOCKED · Chainlink CRE", "#ff6b5a"],
  ["Kall Keyboard", "Sold 0.000449 ETH", "FILLED · Definitive Flash", "#c6f25a"],
  ["@lookonchain on X", "copied · $0.20", "FILLED · on Base", "#c6f25a"],
];

const VERT = /* glsl */ `
  attribute vec3 pA; attribute vec3 pB; attribute vec3 pC; attribute vec3 aDir; attribute float aRand;
  uniform float uTime, uMorph, uIntro, uPixel, uCalm; uniform vec2 uMouse;
  varying vec3 vColor; varying float vA;
  void main() {
    float m = uMorph;
    float s1 = smoothstep(0.0, 1.0, clamp(m, 0.0, 1.0));
    float s2 = smoothstep(0.0, 1.0, clamp(m - 1.0, 0.0, 1.0));
    float s3 = smoothstep(0.0, 1.0, clamp(m - 2.0, 0.0, 1.0));
    vec3 p = mix(pA, pB, s1); p = mix(p, pC, s2); p = mix(p, pA, s3);
    float burst = (m > 0.02 && m < 2.98) ? sin(fract(m) * 3.14159) : 0.0;
    p += aDir * burst * (0.6 + aRand * 2.4) * (1.0 - uCalm);
    vec3 scatter = aDir * (14.0 + aRand * 26.0);
    float k = clamp(uIntro * 1.6 - aRand * 0.6, 0.0, 1.0);
    k = 1.0 - pow(1.0 - k, 3.0);
    p = mix(scatter, p, k);
    p += aDir * 0.05 * sin(uTime * 1.6 + aRand * 40.0) * (1.0 - uCalm);
    float spin = s2 * (1.0 - s3) * uTime * 0.25;
    p.xz = mat2(cos(spin), -sin(spin), sin(spin), cos(spin)) * p.xz;
    vec2 d = p.xy - uMouse;
    float push = smoothstep(2.2, 0.0, length(d));
    p.xy += normalize(d + 1e-4) * push * 1.1;
    p.z += push * 1.6;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uPixel * (1.1 + aRand * 2.2) * (17.0 / -mv.z);
    vec3 lime = vec3(0.776, 0.949, 0.353);
    vec3 white = vec3(0.9, 0.93, 0.89);
    vec3 red = vec3(1.0, 0.42, 0.35);
    vColor = mix(lime, white, step(0.86, aRand));
    float down = step(0.5, fract(sin(floor((pB.x + 7.5) * 1.6) * 91.3) * 43758.5));
    vColor = mix(vColor, red, s1 * (1.0 - s2) * down * 0.85);
    vA = 0.55 + 0.45 * push;
  }`;

const FRAG = /* glsl */ `
  varying vec3 vColor; varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    gl_FragColor = vec4(vColor, smoothstep(0.5, 0.0, d) * vA);
  }`;

const rnd = (a = 1) => (Math.random() * 2 - 1) * a;

async function logoPoints(n: number) {
  const img = new Image();
  await new Promise((ok) => {
    img.onload = ok;
    img.onerror = ok;
    img.src = "/brand/mark.png";
    if (img.complete) ok(null);
  });
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.drawImage(img, 0, 0, 256, 256);
  const data = g.getImageData(0, 0, 256, 256).data;
  const px: Array<[number, number]> = [];
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) if (data[(y * 256 + x) * 4 + 3] > 110) px.push([x, y]);
  if (!px.length) px.push([128, 128]);
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const [x, y] = px[(Math.random() * px.length) | 0];
    out[i * 3] = ((x + Math.random()) / 256 - 0.5) * 8.6;
    out[i * 3 + 1] = -((y + Math.random()) / 256 - 0.5) * 8.6 + 0.25;
    out[i * 3 + 2] = rnd(0.35);
  }
  return out;
}

function chartPoints(n: number) {
  const steps = 240;
  const line: number[] = [];
  let v = 0;
  for (let i = 0; i < steps; i++) {
    v += rnd(0.22) + Math.sin(i / 18) * 0.05;
    line.push(v);
  }
  const min = Math.min(...line), max = Math.max(...line);
  const ys = line.map((y) => ((y - min) / (max - min)) * 5 - 2.2);
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = Math.random();
    const k = Math.min(steps - 1, (t * steps) | 0);
    const onLine = Math.random() < 0.62;
    out[i * 3] = (t - 0.5) * 15;
    out[i * 3 + 1] = onLine ? ys[k] + rnd(0.05) : -3.2 + Math.random() * (ys[k] + 3.2);
    out[i * 3 + 2] = onLine ? rnd(0.15) : rnd(1.4);
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function globePoints(n: number, THREE: any) {
  const out = new Float32Array(n * 3);
  const R = 4.1;
  const golden = Math.PI * (3 - Math.sqrt(5));
  const sphereN = Math.floor(n * 0.72);
  for (let i = 0; i < sphereN; i++) {
    const y = 1 - (i / (sphereN - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = golden * i;
    out[i * 3] = Math.cos(th) * r * R;
    out[i * 3 + 1] = y * R;
    out[i * 3 + 2] = Math.sin(th) * r * R;
  }
  const arcs = Array.from({ length: 18 }, () => [new THREE.Vector3().randomDirection(), new THREE.Vector3().randomDirection()]);
  for (let i = sphereN; i < n; i++) {
    const [p, q] = arcs[i % arcs.length];
    const t = Math.random();
    const v = p.clone().lerp(q, t).normalize();
    const lift = 1 + Math.sin(t * Math.PI) * 0.45;
    out[i * 3] = v.x * R * lift;
    out[i * 3 + 1] = v.y * R * lift;
    out[i * 3 + 2] = v.z * R * lift;
  }
  return out;
}

function cardCanvas([who, text, verdict, color]: [string, string, string, string]) {
  const c = document.createElement("canvas");
  c.width = 640;
  c.height = 320;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(13,17,15,0.92)";
  g.strokeStyle = color;
  g.lineWidth = 4;
  g.beginPath();
  g.roundRect(6, 6, 628, 308, 34);
  g.fill();
  g.stroke();
  g.fillStyle = "#8b978d";
  g.font = "500 30px ui-monospace, Menlo, monospace";
  g.fillText(who, 40, 74);
  g.fillStyle = "#e6ebe3";
  g.font = "700 48px 'Bricolage Grotesque Variable', system-ui, sans-serif";
  g.fillText(text, 40, 160);
  g.fillStyle = color;
  g.font = "700 40px 'Bricolage Grotesque Variable', system-ui, sans-serif";
  g.fillText(verdict, 40, 254);
  return c;
}

export function Hero3D({ children }: { children: ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dotsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stop = false;
    let raf = 0;
    const cleanups: Array<() => void> = [];

    (async () => {
      const canvas = canvasRef.current;
      const box = wrap.current;
      if (!canvas || !box) return;
      const probe = document.createElement("canvas");
      if (!probe.getContext("webgl2") && !probe.getContext("webgl")) return;

      const load = (url: string) => import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let THREE: any, EffectComposer: any, RenderPass: any, UnrealBloomPass: any, OutputPass: any;
      try {
        [THREE, { EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
          load(THREE_URL),
          load(addon("EffectComposer")),
          load(addon("RenderPass")),
          load(addon("UnrealBloomPass")),
          load(addon("OutputPass")),
        ]);
      } catch {
        return; // CDN unreachable: the page still reads without the 3D layer
      }
      if (stop) return;

      const small = innerWidth < 760;
      const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
      const N = small ? 9000 : 18000;
      const size = () => ({ w: canvas.clientWidth || innerWidth, h: canvas.clientHeight || innerHeight });

      const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(devicePixelRatio, small ? 1.5 : 2));
      renderer.setSize(size().w, size().h, false);
      renderer.setClearColor(0x050605, 1);
      const scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2(0x050605, 0.035);
      const camera = new THREE.PerspectiveCamera(small ? 60 : 45, size().w / size().h, 0.1, 200);
      camera.position.set(0, 0, 16);

      const geo = new THREE.BufferGeometry();
      const pA = await logoPoints(N);
      if (stop) return;
      geo.setAttribute("position", new THREE.BufferAttribute(pA, 3));
      geo.setAttribute("pA", new THREE.BufferAttribute(pA, 3));
      geo.setAttribute("pB", new THREE.BufferAttribute(chartPoints(N), 3));
      geo.setAttribute("pC", new THREE.BufferAttribute(globePoints(N, THREE), 3));
      const dir = new Float32Array(N * 3);
      const rand = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const v = new THREE.Vector3().randomDirection();
        dir[i * 3] = v.x;
        dir[i * 3 + 1] = v.y;
        dir[i * 3 + 2] = v.z;
        rand[i] = Math.random();
      }
      geo.setAttribute("aDir", new THREE.BufferAttribute(dir, 3));
      geo.setAttribute("aRand", new THREE.BufferAttribute(rand, 1));
      const uniforms = {
        uTime: { value: 0 },
        uMorph: { value: 0 },
        uIntro: { value: calm ? 1 : 0 },
        uCalm: { value: calm ? 1 : 0 },
        uMouse: { value: new THREE.Vector2(99, 99) },
        uPixel: { value: renderer.getPixelRatio() },
      };
      const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const points = new THREE.Points(geo, mat);
      scene.add(points);

      await Promise.race([document.fonts.ready, new Promise((ok) => setTimeout(ok, 1200))]);
      const cards = new THREE.Group();
      scene.add(cards);
      (small ? CALLS.slice(0, 5) : CALLS).forEach((call, i, all) => {
        const tex = new THREE.CanvasTexture(cardCanvas(call));
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        const m = new THREE.Mesh(
          new THREE.PlaneGeometry(3.2, 1.6),
          new THREE.MeshBasicMaterial({ map: tex, color: 0xb4b4b4, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
        );
        m.userData = { a: (i / all.length) * Math.PI * 2, r: 7.4 + (i % 2) * 1.4, y: ((i % 3) - 1) * 2.4, speed: 0.08 + (i % 3) * 0.02 };
        cards.add(m);
      });

      const grid = new THREE.GridHelper(80, 80, 0x2c3830, 0x1a201c);
      grid.position.y = -5.2;
      grid.material.transparent = true;
      grid.material.opacity = 0.55;
      scene.add(grid);

      const composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(size().w, size().h), 0.8, 0.6, 0.18));
      composer.addPass(new OutputPass());

      // Input: the cursor pushes particles (desktop only); scroll through the section drives the morph.
      const mouseN = new THREE.Vector2(0, 0);
      const ray = new THREE.Raycaster();
      const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
      const hit = new THREE.Vector3();
      const onMove = (e: PointerEvent) => {
        if (small) return;
        mouseN.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
        ray.setFromCamera(mouseN, camera);
        if (ray.ray.intersectPlane(plane, hit)) uniforms.uMouse.value.set(hit.x, hit.y);
      };
      addEventListener("pointermove", onMove);
      cleanups.push(() => removeEventListener("pointermove", onMove));

      let target = 0;
      const dots = dotsRef.current ? [...dotsRef.current.children] : [];
      const onScroll = () => {
        const r = box.getBoundingClientRect();
        const span = r.height - innerHeight;
        target = span > 0 ? Math.min(1, Math.max(0, -r.top / span)) * 3 : 0;
        const idx = Math.round(target);
        dots.forEach((d, i) => d.classList.toggle("on", i === idx));
      };
      addEventListener("scroll", onScroll, { passive: true });
      cleanups.push(() => removeEventListener("scroll", onScroll));
      onScroll();

      const onResize = () => {
        const { w, h } = size();
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
        composer.setSize(w, h);
      };
      addEventListener("resize", onResize);
      cleanups.push(() => removeEventListener("resize", onResize));

      // Only draw while the section is on screen.
      let visible = true;
      const io = new IntersectionObserver(([e]) => {
        visible = e.isIntersecting;
        if (visible && !raf) raf = requestAnimationFrame(frame);
      });
      io.observe(box);
      cleanups.push(() => io.disconnect());

      const clock = new THREE.Clock();
      let last = 0;
      function frame() {
        raf = 0;
        if (stop || !visible) return;
        const t = clock.getElapsedTime();
        const dt = Math.min(0.1, t - last);
        last = t;
        const ease = (rate: number) => 1 - Math.exp(-dt * rate);
        uniforms.uTime.value = t;
        if (!calm) uniforms.uIntro.value = Math.min(1, t / 2.6);
        uniforms.uMorph.value += (target - uniforms.uMorph.value) * (calm ? 1 : ease(3.6));
        const m = uniforms.uMorph.value;

        const side = small ? 0 : [3.4, -3.6, 3.6, 0][Math.min(3, Math.round(m))];
        points.position.x += (side - points.position.x) * ease(3);
        points.rotation.y = Math.sin(t * 0.3) * 0.22 * (1 - Math.min(1, Math.abs(m - 1)));

        cards.position.x = points.position.x;
        const cardsOn = Math.max(0, 1 - m * 1.4) + Math.max(0, (m - 2.4) * 1.6) * 0.3;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cards.children.forEach((c: any) => {
          const u = c.userData;
          const a = u.a + t * u.speed;
          c.position.set(Math.cos(a) * u.r, u.y + Math.sin(t * 0.8 + u.a) * 0.3, Math.sin(a) * u.r - 1.5);
          c.lookAt(camera.position);
          // Cards that drift behind the text (left half on desktop) dim so the copy stays readable.
          const behindText = !small && c.position.x + cards.position.x < 0.5 ? 0.3 : 1;
          c.material.opacity = Math.min(1, cardsOn) * (0.35 + 0.65 * (Math.sin(a) * 0.5 + 0.5)) * behindText;
          c.visible = c.material.opacity > 0.01;
        });

        camera.position.x += (mouseN.x * 1.4 - camera.position.x) * ease(2.4);
        camera.position.y += (mouseN.y * 0.9 + 0.3 - camera.position.y) * ease(2.4);
        camera.position.z = (small ? 18 : 16) - Math.sin(Math.min(1, m / 3) * Math.PI) * 1.5;
        camera.lookAt(points.position.x * 0.35, 0, 0);
        grid.position.z = (t * 1.2) % 1;

        composer.render();
        raf = requestAnimationFrame(frame);
      }
      raf = requestAnimationFrame(frame);
      cleanups.push(() => {
        geo.dispose();
        mat.dispose();
        renderer.dispose();
      });
    })();

    return () => {
      stop = true;
      cancelAnimationFrame(raf);
      cleanups.forEach((f) => f());
    };
  }, []);

  return (
    <div ref={wrap} className="hero3d relative">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="sticky top-0 h-dvh w-full overflow-hidden">
          <canvas ref={canvasRef} className="block h-full w-full" />
          <div className="hero3d-vignette absolute inset-0" />
        </div>
      </div>
      <div ref={dotsRef} className="hero3d-dots" aria-hidden="true">
        <i className="on" />
        <i />
        <i />
        <i />
      </div>
      <div className="relative z-10">{children}</div>
    </div>
  );
}
