/**
 * 3D Viewport — Three.js renderer with orbit controls
 * Renders the loaded GLB model and visualizes orientation/slice planes
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class Viewport3D {
  /**
   * @param {HTMLElement} container - DOM element to render into
   */
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.model = null;
    this.upArrow = null;
    this.slicePlane = null;
    this.floorPlanes = [];
    this.floorPlanesVisible = true;

    // Shared neutral material reused across models to avoid per-mesh allocations
    this._overrideMaterial = new THREE.MeshStandardMaterial({
      color: 0x8899aa,
      roughness: 0.7,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x111827, 1);
    this.renderer.shadowMap.enabled = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    // Camera
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
    this.camera.position.set(5, 5, 5);

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 200;

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);
    const directional = new THREE.DirectionalLight(0xffffff, 0.8);
    directional.position.set(5, 10, 7);
    this.scene.add(directional);
    const backLight = new THREE.DirectionalLight(0xffffff, 0.3);
    backLight.position.set(-5, -3, -5);
    this.scene.add(backLight);

    // Grid (subtle)
    const grid = new THREE.GridHelper(50, 50, 0x2d3f5a, 0x1a2235);
    this.scene.add(grid);
    this.grid = grid;

    // Axes helper (small)
    const axes = new THREE.AxesHelper(1);
    axes.position.set(0, 0, 0);
    this.scene.add(axes);

    // Handle resize
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(container);

    // Animation loop
    this._animate = this._animate.bind(this);
    this._animating = true;
    this._animate();

    // Initial size
    this.resize();
  }

  /**
   * Dispose geometries and non-shared materials on an object subtree.
   * @param {THREE.Object3D} root
   * @private
   */
  _disposeObject(root) {
    if (!root) return;
    root.traverse((obj) => {
      if (obj.geometry) {
        obj.geometry.dispose();
      }
      if (obj.material && obj.material !== this._overrideMaterial) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });
  }

  /**
   * Set the 3D model scene from the GLB loader
   * @param {THREE.Group} modelScene - The loaded GLB scene
   * @param {{min: {x,y,z}, max: {x,y,z}}} bounds - Model bounding box
   */
  setModel(modelScene, bounds) {
    if (this.model) {
      this.scene.remove(this.model);
      this._disposeObject(this.model);
    }

    this.model = modelScene;
    this.scene.add(this.model);

    this.model.traverse((child) => {
      if (child.isMesh) {
        child.material = this._overrideMaterial;
      }
    });

    this._frameBounds(bounds);
  }

  /**
   * Show the up direction arrow
   * @param {string} upAxis - e.g., '+y', '-z', '+x'
   */
  showUpArrow(upAxis) {
    if (this.upArrow) {
      this.scene.remove(this.upArrow);
      this._disposeObject(this.upArrow);
    }

    const dir = this._axisToVector(upAxis).normalize();
    const origin = new THREE.Vector3(0, 0, 0);

    if (this.model) {
      const box = new THREE.Box3().setFromObject(this.model);
      box.getCenter(origin);
    }

    const length = 2;
    const arrowColor = 0x10b981;
    this.upArrow = new THREE.ArrowHelper(dir, origin, length, arrowColor, 0.4, 0.2);
    this.scene.add(this.upArrow);
  }

  /**
   * Show horizontal planes at detected floor slice levels, sized and centered to model bounds.
   * @param {Array<{floorHeight: number, sliceHeight: number, name: string}>} floors
   * @param {string} upAxis
   * @param {{min: {x,y,z}, max: {x,y,z}} | null} [bounds=null]
   */
  showFloorPlanes(floors, upAxis, bounds = null) {
    this.floorPlanes.forEach((p) => {
      this.scene.remove(p);
      this._disposeObject(p);
    });
    this.floorPlanes = [];

    const axisIndex = this._axisIndex(upAxis);
    const colors = [0x3b82f6, 0x8b5cf6, 0x10b981, 0xf59e0b, 0xef4444];

    let cx = 0;
    let cy = 0;
    let cz = 0;
    let planeW = 20;
    let planeH = 20;

    if (bounds && bounds.min && bounds.max) {
      cx = (bounds.min.x + bounds.max.x) * 0.5;
      cy = (bounds.min.y + bounds.max.y) * 0.5;
      cz = (bounds.min.z + bounds.max.z) * 0.5;
      const sx = Math.max(1, bounds.max.x - bounds.min.x);
      const sy = Math.max(1, bounds.max.y - bounds.min.y);
      const sz = Math.max(1, bounds.max.z - bounds.min.z);

      if (axisIndex === 1) {
        planeW = sx * 1.15;
        planeH = sz * 1.15;
      } else if (axisIndex === 2) {
        planeW = sx * 1.15;
        planeH = sy * 1.15;
      } else {
        planeW = sz * 1.15;
        planeH = sy * 1.15;
      }
    }

    floors.forEach((floor, i) => {
      const geometry = new THREE.PlaneGeometry(planeW, planeH);
      const material = new THREE.MeshBasicMaterial({
        color: colors[i % colors.length],
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const plane = new THREE.Mesh(geometry, material);

      if (axisIndex === 1) {
        plane.rotation.x = -Math.PI / 2;
        plane.position.set(cx, floor.sliceHeight, cz);
      } else if (axisIndex === 2) {
        plane.position.set(cx, cy, floor.sliceHeight);
      } else {
        plane.rotation.y = Math.PI / 2;
        plane.position.set(floor.sliceHeight, cy, cz);
      }

      plane.visible = this.floorPlanesVisible;
      this.scene.add(plane);
      this.floorPlanes.push(plane);

      const wireGeo = new THREE.EdgesGeometry(geometry);
      const wireMat = new THREE.LineBasicMaterial({
        color: colors[i % colors.length],
        transparent: true,
        opacity: 0.45,
      });
      const wireframe = new THREE.LineSegments(wireGeo, wireMat);
      wireframe.position.copy(plane.position);
      wireframe.rotation.copy(plane.rotation);
      wireframe.visible = this.floorPlanesVisible;
      this.scene.add(wireframe);
      this.floorPlanes.push(wireframe);
    });
  }

  /**
   * Toggle visibility of 3D floor slice planes.
   * @param {boolean} visible
   */
  setFloorPlanesVisible(visible) {
    this.floorPlanesVisible = Boolean(visible);
    for (const obj of this.floorPlanes) {
      obj.visible = this.floorPlanesVisible;
    }
  }

  /**
   * Frame the camera to fit the given bounding box
   */
  _frameBounds(bounds) {
    const center = new THREE.Vector3(
      (bounds.min.x + bounds.max.x) / 2,
      (bounds.min.y + bounds.max.y) / 2,
      (bounds.min.z + bounds.max.z) / 2
    );
    const size = new THREE.Vector3(
      bounds.max.x - bounds.min.x,
      bounds.max.y - bounds.min.y,
      bounds.max.z - bounds.min.z
    );
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const distance = maxDim * 1.5;

    this.camera.position.set(
      center.x + distance * 0.6,
      center.y + distance * 0.6,
      center.z + distance * 0.6
    );
    this.controls.target.copy(center);
    this.camera.near = Math.max(0.01, maxDim * 0.001);
    this.camera.far = Math.max(100, maxDim * 10);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  /**
   * Convert axis string to Three.js Vector3
   * @param {string} axis - e.g., '+y', '-z'
   * @returns {THREE.Vector3}
   */
  _axisToVector(axis) {
    const sign = axis.startsWith('-') ? -1 : 1;
    const letter = axis.replace(/[+-]/, '');
    switch (letter) {
      case 'x': return new THREE.Vector3(sign, 0, 0);
      case 'y': return new THREE.Vector3(0, sign, 0);
      case 'z': return new THREE.Vector3(0, 0, sign);
      default: return new THREE.Vector3(0, sign, 0);
    }
  }

  /**
   * Get the position array index for an axis
   * @param {string} axis
   * @returns {number} 0, 1, or 2
   */
  _axisIndex(axis) {
    const letter = axis.replace(/[+-]/, '');
    return letter === 'x' ? 0 : letter === 'y' ? 1 : 2;
  }

  /** Resize renderer to container */
  resize() {
    const rect = this.container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    this.camera.aspect = rect.width / rect.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(rect.width, rect.height);
  }

  /** Animation loop */
  _animate() {
    if (!this._animating) return;
    requestAnimationFrame(this._animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  /** Clean up resources */
  dispose() {
    this._animating = false;
    this._resizeObserver.disconnect();
    window.removeEventListener('resize', this._onResize);
    if (this.model) this._disposeObject(this.model);
    if (this.upArrow) this._disposeObject(this.upArrow);
    this.floorPlanes.forEach((p) => this._disposeObject(p));
    this._overrideMaterial.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
