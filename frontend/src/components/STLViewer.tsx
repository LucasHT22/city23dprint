import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls, STLLoader } from 'three-stdlib';

export default function STLViewer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const width = canvasRef.current.clientWidth;
    const height = canvasRef.current.clientHeight;

    const renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current, antialias: true });
    renderer.setSize(width, height);
    renderer.setClearColor(0xf0f0f0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, canvasRef.current.clientWidth / canvasRef.current.clientHeight, 0.1, 1000);
    camera.position.set(0, 0, 100);

    scene.add(new THREE.AmbientLight(0x404040));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(10, 10, 10);
    scene.add(dirLight);

    const controls = new OrbitControls(camera, renderer.domElement);
    

    const loader = new STLLoader();
    loader.load('/modelo.stl', geometry => {
      const material = new THREE.MeshNormalMaterial();
      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);
      camera.position.z = 100;

      const animate = () => {
        requestAnimationFrame(animate);
        mesh.rotation.y += 0.01;
        renderer.render(scene, camera);
      };

      animate();
    });
  }, []);
  return <canvas ref={canvasRef} style={{ width: '100%', height: '600px' }} />;
}