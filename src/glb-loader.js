import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Class to load GLB files and extract mesh geometry data in world space.
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
   * Loads a GLB file and extracts mesh data.
   * @param {File} file - The file to load.
   * @returns {Promise<Object>} An object containing scene and extracted mesh data.
   */
  async load(file) {
    if (!(file instanceof File)) {
      throw new Error('Invalid input: Expected a File object.');
    }

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
          (error) => reject(new Error(`Failed to load GLB: ${error.message}`))
        );
      });

      return this._processGLTF(gltf);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /**
   * Processes the loaded GLTF scene to extract meshes and bounds.
   * @param {Object} gltf - The loaded GLTF object.
   * @returns {Object} Extracted data.
   * @private
   */
  _processGLTF(gltf) {
    const scene = gltf.scene;
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
