import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls, STLLoader } from 'three-stdlib';

export default function STLViewer({ stlBlob }: { stlBlob: Blob | null }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!stlBlob || !canvasRef.current) return;

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
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.autoRotate = true;

    const url = URL.createObjectURL(stlBlob);
    const loader = new STLLoader();

    loader.load(url, (geometry: THREE.BufferGeometry<THREE.NormalBufferAttributes> | undefined) => {
        const material = new THREE.MeshNormalMaterial();
        const mesh = new THREE.Mesh(geometry, material);
        scene.add(mesh);

        const box = new THREE.Box3().setFromObject(mesh);
        const center = box.getCenter(new THREE.Vector3());
        mesh.position.set(0, 0, box.getSize(new THREE.Vector3()).length() * 1.5);
        controls.update();

        const animate = () => {
            requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
        };
        animate();
    });
    return () => {
        renderer.dispose();
        URL.revokeObjectURL(url);
    };
  }, [stlBlob]);

    const handleDownload = () => {
        if (!stlBlob) return;
        const url = URL.createObjectURL(stlBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'model.stl';
        a.click();
    };

  return (
    <div>
        <canvas ref={canvasRef} style={{ width: '100%', height: '600px' }} />
        {stlBlob && (
            <button
                onClick={handleDownload}
                style={{
                    marginTop: '10px',
                    padding: '10px 20px',
                    background: '#0070f3',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer'
                }}
            >
                Download STL
            </button>
        )}
    </div>
  )
}