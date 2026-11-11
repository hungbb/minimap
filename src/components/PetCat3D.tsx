// The office cat in 3D on its card: the same model as the 3D map, turning slowly on a small
// stage, in the same mood, size and hop. Loaded with lazy() when the card opens. PetCard shows
// the 2D drawing while this loads, and instead of it when 3D can't run (onFail).
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { watchContextLoss } from '../lib/contextLoss.ts';
import type { PetShown } from '../lib/petLook.ts';
import { createOfficeCat, type OfficeCat3D } from '../map/cat3d.ts';

const SIZE = 2.4;
const SPIN = 0.5; // Radians a second.

export interface PetCat3DProps {
  pet: PetShown;
  reduced: boolean;
  onFail: () => void;
}

export default function PetCat3D({ pet, reduced, onFail }: PetCat3DProps) {
  const host = useRef<HTMLDivElement>(null);
  const cat = useRef<OfficeCat3D | null>(null);
  const latest = useRef({ pet, reduced, onFail });
  latest.current = { pet, reduced, onFail };

  useEffect(() => {
    const root = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (error) {
      console.error('Could not show the 3D cat', error);
      latest.current.onFail();
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.domElement.style.display = 'block';
    root.append(renderer.domElement);
    const stopWatching = watchContextLoss(renderer.domElement, () => latest.current.onFail());

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xfff6e8, 0xb9a7d8, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(3, 6, 5);
    scene.add(sun);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(2.1, 32), new THREE.MeshStandardMaterial({ color: 0xffe9c9 }));
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const office = createOfficeCat(SIZE);
    office.set(latest.current.pet);
    scene.add(office.group);
    cat.current = office;

    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    // Close enough that a kitten fills the frame, and far enough back that a big cat's ears
    // still fit, so the cat looks bigger as it grows.
    camera.position.set(0, 2.9, 8.6);
    camera.lookAt(0, 1.7, 0);

    function fit() {
      const { clientWidth: w, clientHeight: h } = root;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(root);

    let angle = 0.5;
    let last = performance.now();
    let frame = requestAnimationFrame(function draw(now) {
      frame = requestAnimationFrame(draw);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!latest.current.reduced) {
        angle += dt * SPIN;
        office.animate(now / 1000);
      }
      office.group.rotation.y = angle;
      renderer.render(scene, camera);
    });

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      stopWatching();
      cat.current = null;
      scene.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.geometry.dispose();
          (node.material as THREE.Material).dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  // A new mood, size or feed changes the model without building it again.
  useEffect(() => {
    cat.current?.set(pet);
  }, [pet]);

  // Pinned to fill its frame (which must be position: relative), so it has a size before the
  // canvas is in it. Sized by its content instead, it measures 0 and the canvas stays at the
  // browser's default 300 × 150, mostly cut off.
  return <div ref={host} style={{ position: 'absolute', inset: 0 }} aria-hidden="true" />;
}
