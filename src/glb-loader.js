import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { SUPPORTED_3D_EXTENSIONS, isSupported3DFile } from './utils/model-formats.js';

export { SUPPORTED_3D_EXTENSIONS, isSupported3DFile };

/**
 * Loads 3D scan/model files (.glb, .gltf, .obj, .stl, .ply) and extracts
 * world-space triangle mesh geometry data.
 */
export class GLBLoader {
  constructor() {
    /**
     * Callback function for progress updates.
     * @type {((progress: number) => void) | null}
     */
    this.onProgress = null;
  }

  /**
   * Loads a supported 3D model File and extracts mesh data.
   * @param {File} file - The file to load.
   * @returns {Promise<Object>} An object containing scene and extracted mesh data.
   */
  async load(file) {
    if (!(file instanceof File)) {
      throw new Error('Invalid input: Expected a File object.');
    }

    const lower = file.name.toLowerCase();

    if (lower.endsWith('.glb') || lower.endsWith('.gltf')) {
      const url = URL.createObjectURL(file);
      const loader = new GLTFLoader();
      try {
        const gltf = await new Promise((resolve, reject) => {
          loader.load(
            url,
            (loaded) => resolve(loaded),
            (xhr) => {
              if (this.onProgress && xhr.total > 0) {
                const percent = (xhr.loaded / xhr.total) * 100;
                this.onProgress(percent);
              }
            },
            (error) => reject(new Error(`Failed to load GLB/GLTF: ${error.message}`))
          );
        });
        return this._processScene(gltf.scene);
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    if (lower.endsWith('.obj')) {
      this.onProgress?.(45);
      const text = await file.text();
      this.onProgress?.(85);
      const result = this.parseOBJ(text);
      this.onProgress?.(100);
      return result;
    }

    if (lower.endsWith('.stl')) {
      this.onProgress?.(45);
      const buffer = await file.arrayBuffer();
      this.onProgress?.(85);
      const result = this.parseSTL(buffer);
      this.onProgress?.(100);
      return result;
    }

    if (lower.endsWith('.ply')) {
      this.onProgress?.(45);
      const buffer = await file.arrayBuffer();
      this.onProgress?.(85);
      const result = this.parsePLY(buffer);
      this.onProgress?.(100);
      return result;
    }

    throw new Error(`Unsupported 3D format. Supported extensions: ${SUPPORTED_3D_EXTENSIONS.join(', ')}`);
  }

  /**
   * Parses Wavefront .obj text into extracted mesh data.
   * @param {string} text
   * @returns {Object}
   */
  parseOBJ(text) {
    const loader = new OBJLoader();
    const group = loader.parse(text);
    group.traverse((child) => {
      if (child.isMesh && child.geometry && !child.geometry.attributes.normal) {
        child.geometry.computeVertexNormals();
      }
    });
    return this._processScene(group);
  }

  /**
   * Parses binary or ASCII .stl ArrayBuffer into extracted mesh data.
   * @param {ArrayBuffer | string} buffer
   * @returns {Object}
   */
  parseSTL(buffer) {
    const loader = new STLLoader();
    const geometry = loader.parse(buffer);
    if (!geometry.attributes.normal) {
      geometry.computeVertexNormals();
    }
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    mesh.name = 'STL Mesh';
    group.add(mesh);
    return this._processScene(group);
  }

  /**
   * Parses binary or ASCII .ply ArrayBuffer into extracted mesh data.
   * Rejects point-cloud-only PLY files that contain no triangle faces.
   * @param {ArrayBuffer | string} buffer
   * @returns {Object}
   */
  parsePLY(buffer) {
    if (buffer instanceof ArrayBuffer) {
      const headerSlice = new Uint8Array(buffer, 0, Math.min(2048, buffer.byteLength));
      const headerText = new TextDecoder().decode(headerSlice);
      if (headerText.startsWith('ply')) {
        const faceMatch = headerText.match(/element\s+face\s+(\d+)/i);
        const faceCount = faceMatch ? parseInt(faceMatch[1], 10) : 0;
        if (!faceMatch || faceCount === 0) {
          throw new Error(
            'This PLY file appears to be a point cloud without triangle faces. Export a meshed .ply, .obj, or .glb model to extract floor plans.'
          );
        }
      }
    } else if (typeof buffer === 'string') {
      const faceMatch = buffer.slice(0, 2048).match(/element\s+face\s+(\d+)/i);
      const faceCount = faceMatch ? parseInt(faceMatch[1], 10) : 0;
      if (!faceMatch || faceCount === 0) {
        throw new Error(
          'This PLY file appears to be a point cloud without triangle faces. Export a meshed .ply, .obj, or .glb model to extract floor plans.'
        );
      }
    }

    const loader = new PLYLoader();
    const geometry = loader.parse(buffer);
    if (!geometry.index && (!geometry.attributes.position || geometry.attributes.position.count < 3)) {
      throw new Error(
        'This PLY file appears to be a point cloud without triangle faces. Export a meshed .ply, .obj, or .glb model to extract floor plans.'
      );
    }
    if (!geometry.attributes.normal) {
      geometry.computeVertexNormals();
    }
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    mesh.name = 'PLY Mesh';
    group.add(mesh);
    return this._processScene(group);
  }

  /**
   * Backward-compatible wrapper around _processScene.
   * @param {Object} gltf
   * @returns {Object}
   * @private
   */
  _processGLTF(gltf) {
    return this._processScene(gltf.scene);
  }

  /**
   * Processes a Three.js scene/group to extract meshes and world bounds.
   * @param {THREE.Object3D} scene - The loaded scene or group.
   * @returns {Object} Extracted data.
   * @private
   */
  _processScene(scene) {
    scene.updateMatrixWorld(true);

    const meshes = [];
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let totalTriangles = 0;

    scene.traverse((child) => {
      if (child.isMesh) {
        const meshData = this._extractMeshData(child);
        if (meshData) {
          meshes.push(meshData);
          totalTriangles += meshData.triangleCount;
          const b = meshData.bounds;
          if (b.min[0] < minX) minX = b.min[0];
          if (b.min[1] < minY) minY = b.min[1];
          if (b.min[2] < minZ) minZ = b.min[2];
          if (b.max[0] > maxX) maxX = b.max[0];
          if (b.max[1] > maxY) maxY = b.max[1];
          if (b.max[2] > maxZ) maxZ = b.max[2];
        }
      }
    });

    if (meshes.length === 0) {
      minX = minY = minZ = 0;
      maxX = maxY = maxZ = 0;
    }

    return {
      scene,
      meshes,
      bounds: {
        min: { x: minX, y: minY, z: minZ },
        max: { x: maxX, y: maxY, z: maxZ },
      },
      totalTriangles,
      meshCount: meshes.length,
    };
  }

  /**
   * Extracts world-space geometry data and bounding box from a single mesh.
   * @param {THREE.Mesh} mesh - The mesh to extract data from.
   * @returns {Object|null} Extracted mesh data.
   * @private
   */
  _extractMeshData(mesh) {
    const geometry = mesh.geometry;
    const positionAttribute = geometry.attributes.position;
    if (!positionAttribute || positionAttribute.count === 0) return null;

    const normalAttribute = geometry.attributes.normal;
    const vertexCount = positionAttribute.count;
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);

    const matrixWorld = mesh.matrixWorld;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrixWorld);
    const vec3 = new THREE.Vector3();

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (let i = 0; i < vertexCount; i++) {
      vec3.fromBufferAttribute(positionAttribute, i).applyMatrix4(matrixWorld);
      const px = vec3.x;
      const py = vec3.y;
      const pz = vec3.z;
      const base = i * 3;
      positions[base] = px;
      positions[base + 1] = py;
      positions[base + 2] = pz;

      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (pz < minZ) minZ = pz;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
      if (pz > maxZ) maxZ = pz;

      if (normalAttribute) {
        vec3.fromBufferAttribute(normalAttribute, i).applyMatrix3(normalMatrix).normalize();
        normals[base] = vec3.x;
        normals[base + 1] = vec3.y;
        normals[base + 2] = vec3.z;
      }
    }

    let indices = geometry.index ? geometry.index.array : null;
    let triangleCount = 0;

    if (indices) {
      triangleCount = Math.floor(indices.length / 3);
      if (!(indices instanceof Uint16Array) && !(indices instanceof Uint32Array)) {
        indices = vertexCount > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
      }
    } else {
      triangleCount = Math.floor(vertexCount / 3);
      const indexArray = vertexCount > 65535 ? new Uint32Array(vertexCount) : new Uint16Array(vertexCount);
      for (let i = 0; i < vertexCount; i++) {
        indexArray[i] = i;
      }
      indices = indexArray;
    }

    return {
      positions,
      normals,
      indices,
      triangleCount,
      bounds: {
        min: [minX, minY, minZ],
        max: [maxX, maxY, maxZ],
      },
      name: mesh.name || 'Unnamed Mesh',
    };
  }
}

export const ModelLoader = GLBLoader;
