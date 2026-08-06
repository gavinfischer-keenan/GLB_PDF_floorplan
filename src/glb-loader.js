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
                    (gltf) => resolve(gltf),
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
        
        // Ensure world matrices are updated before extraction
        scene.updateMatrixWorld(true);

        const meshes = [];
        const bounds = new THREE.Box3();
        let totalTriangles = 0;

        scene.traverse((child) => {
            if (child.isMesh) {
                const meshData = this._extractMeshData(child);
                if (meshData) {
                    meshes.push(meshData);
                    totalTriangles += meshData.triangleCount;
                    
                    // Expand bounds
                    const geometry = child.geometry;
                    geometry.computeBoundingBox();
                    const box = geometry.boundingBox.clone();
                    box.applyMatrix4(child.matrixWorld);
                    bounds.union(box);
                }
            }
        });

        // If bounds are empty (e.g. no meshes), set them to 0
        if (bounds.isEmpty()) {
            bounds.set(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0));
        }

        return {
            scene,
            meshes,
            bounds: {
                min: { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z },
                max: { x: bounds.max.x, y: bounds.max.y, z: bounds.max.z }
            },
            totalTriangles,
            meshCount: meshes.length
        };
    }

    /**
     * Extracts world-space geometry data from a single mesh.
     * @param {THREE.Mesh} mesh - The mesh to extract data from.
     * @returns {Object|null} Extracted mesh data.
     * @private
     */
    _extractMeshData(mesh) {
        const geometry = mesh.geometry;
        const positionAttribute = geometry.attributes.position;
        if (!positionAttribute) return null;

        const normalAttribute = geometry.attributes.normal;
        
        const vertexCount = positionAttribute.count;
        const positions = new Float32Array(vertexCount * 3);
        const normals = new Float32Array(vertexCount * 3); // Defaults to 0 if no normals

        const matrixWorld = mesh.matrixWorld;
        const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrixWorld);

        const vec3 = new THREE.Vector3();

        // Extract and transform positions and normals
        for (let i = 0; i < vertexCount; i++) {
            // Position
            vec3.fromBufferAttribute(positionAttribute, i);
            vec3.applyMatrix4(matrixWorld);
            positions[i * 3] = vec3.x;
            positions[i * 3 + 1] = vec3.y;
            positions[i * 3 + 2] = vec3.z;

            // Normal
            if (normalAttribute) {
                vec3.fromBufferAttribute(normalAttribute, i);
                vec3.applyMatrix3(normalMatrix).normalize();
                normals[i * 3] = vec3.x;
                normals[i * 3 + 1] = vec3.y;
                normals[i * 3 + 2] = vec3.z;
            }
        }

        // Handle indices
        let indices = geometry.index ? geometry.index.array : null;
        let triangleCount = 0;

        if (indices) {
            triangleCount = Math.floor(indices.length / 3);
            // Ensure indices are either Uint16Array or Uint32Array
            if (!(indices instanceof Uint16Array) && !(indices instanceof Uint32Array)) {
                indices = vertexCount > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
            }
        } else {
            // Generate sequential indices for non-indexed geometry
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
            name: mesh.name || 'Unnamed Mesh'
        };
    }
}
