import Device from '../../gfx/Device';
import GfxTexture from '../../gfx/Texture';
import Shader from '../../gfx/Shader';
import UIRoot from '../components/UIRoot';
import WebGL2Device from '../../gfx/apis/webgl2/WebGL2Device';
import { Matrix4 } from '../../math';

import RenderBatch from './RenderBatch';

// Bytes per vertex: position (3f), packed colour (1f), texture coords (2f).
const VERTEX_STRIDE = 24;
const FLOATS_PER_VERTEX = VERTEX_STRIDE / 4;

type UploadedTexture = {
  handle: WebGLTexture;
  // The decoded pixels this handle was uploaded from. Textures start as a 1x1
  // placeholder and get a new ImageData when the BLP finishes decoding, so comparing
  // identity is enough to know when a re-upload is due.
  image: ImageData;
};

// TODO: Device agnostic (not bound to WebGL2Device)
class Renderer {
  vertexShader: Shader;
  pixelShader: Shader;
  program: WebGLProgram | null;

  // GL objects are created once and reused. Creating them per mesh per frame - which is
  // what this used to do - leaks thousands of textures, buffers and vertex arrays a
  // second once there is a real render loop, and re-uploads and re-mipmaps every texture
  // on every frame.
  private viewProjMatrixPtr: WebGLUniformLocation | null = null;
  private positionPtr = -1;
  private textureCoordsPtr = -1;
  private vao: WebGLVertexArrayObject | null = null;
  private vertexBuffer: WebGLBuffer | null = null;
  private indexBuffer: WebGLBuffer | null = null;
  private vertexData = new Float32Array(FLOATS_PER_VERTEX * 64);

  private readonly uploaded = new WeakMap<GfxTexture, UploadedTexture>();

  constructor() {
    // TODO: Does not support stereo vertex shader yet
    this.vertexShader = (Device.instance as WebGL2Device).shaders.shaderFor('vertex', 'UI');
    this.pixelShader = (Device.instance as WebGL2Device).shaders.shaderFor('pixel', 'UI');

    this.program = null;
  }

  private ensureProgram(gl: WebGL2RenderingContext): boolean {
    if (this.program) {
      return true;
    }

    const { pixelShader, vertexShader } = this;
    if (!pixelShader.isValid || !vertexShader.isValid) {
      return false;
    }

    const program = gl.createProgram()!;
    gl.attachShader(program, vertexShader.apiShader!);
    gl.attachShader(program, pixelShader.apiShader!);
    gl.linkProgram(program);

    if (!(gl.getProgramParameter(program, gl.LINK_STATUS) as boolean)) {
      console.error(gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return false;
    }

    this.program = program;

    // Attribute and uniform lookups are string-keyed queries into the driver; they
    // belong here, not in the draw loop.
    this.viewProjMatrixPtr = gl.getUniformLocation(program, 'viewProjMatrix');
    this.positionPtr = gl.getAttribLocation(program, 'position');
    this.textureCoordsPtr = gl.getAttribLocation(program, 'textureCoords');

    this.vao = gl.createVertexArray();
    this.vertexBuffer = gl.createBuffer();
    this.indexBuffer = gl.createBuffer();

    // Attribute pointers live in the vertex array object and capture the buffer bound
    // at the time they are set, so this only has to happen once.
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.enableVertexAttribArray(this.positionPtr);
    gl.vertexAttribPointer(this.positionPtr, 3, gl.FLOAT, false, VERTEX_STRIDE, 0);
    gl.enableVertexAttribArray(this.textureCoordsPtr);
    gl.vertexAttribPointer(this.textureCoordsPtr, 2, gl.FLOAT, false, VERTEX_STRIDE, 16);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bindVertexArray(null);

    return true;
  }

  /** Uploads a texture's pixels once, and again only if they change. */
  private textureFor(gl: WebGL2RenderingContext, texture: GfxTexture): WebGLTexture {
    const existing = this.uploaded.get(texture);
    if (existing && existing.image === texture.image) {
      return existing.handle;
    }

    const handle = existing?.handle ?? gl.createTexture();

    gl.bindTexture(gl.TEXTURE_2D, handle);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA8,
      texture.image.width, texture.image.height, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, texture.image,
    );
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);

    this.uploaded.set(texture, { handle, image: texture.image });
    return handle;
  }

  private vertexDataFor(mesh: RenderBatch['meshes'][number]): Float32Array {
    const vertexCount = mesh.position.length;
    const needed = FLOATS_PER_VERTEX * vertexCount;
    if (this.vertexData.length < needed) {
      this.vertexData = new Float32Array(needed);
    }

    const data = this.vertexData;
    for (let i = 0; i < vertexCount; ++i) {
      const [x, y, z] = mesh.position[i]!;
      const [u, v] = mesh.textureCoords[i]!;

      const offset = FLOATS_PER_VERTEX * i;
      data[offset] = x;
      data[offset + 1] = y;
      data[offset + 2] = z;
      // Vertex colour, currently unread by the shader.
      data[offset + 3] = 0xffffffff;
      data[offset + 4] = u;
      data[offset + 5] = v;
    }

    return data.subarray(0, needed);
  }

  draw(batch: RenderBatch) {
    const root = UIRoot.instance;
    const { constants, gl } = (Device.instance as WebGL2Device);

    if (batch.meshes.length === 0 || !this.ensureProgram(gl)) {
      return;
    }

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    // TODO: Do not hardcode these matrices here
    const projMatrix = new Matrix4([
      2.50000024, 0, 0, 0,
      0, 3.33333349, 0, 0,
      -0, -0, -0.00200000009, 0,
      0, 0, 0, 1,
    ]);
    const offsetX = (root.rect.minX + root.rect.maxX) * 0.5;
    const offsetY = (root.rect.minY + root.rect.maxY) * 0.5;
    const viewProjMatrix = new Matrix4();
    viewProjMatrix.translate([-offsetX, -offsetY, 0.0]);
    viewProjMatrix.multiply(projMatrix).transpose();
    // The same for every mesh in the batch, so set it once.
    gl.uniformMatrix4fv(this.viewProjMatrixPtr, false, viewProjMatrix);

    gl.activeTexture(gl.TEXTURE0);

    for (const mesh of batch.meshes) {
      const indexCount = mesh.indices.length;
      if (indexCount === 0) {
        continue;
      }

      // TODO: Is this correct?
      if (mesh.blendMode !== null) {
        gl.enable(gl.BLEND);
        gl.blendFunc(constants.blendSources[mesh.blendMode], constants.blendDestinations[mesh.blendMode]);
      } else {
        gl.disable(gl.BLEND);
      }

      gl.bindTexture(gl.TEXTURE_2D, this.textureFor(gl, mesh.texture));

      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.vertexDataFor(mesh), gl.DYNAMIC_DRAW);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint8Array(mesh.indices), gl.DYNAMIC_DRAW);

      gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_BYTE, 0);
    }

    gl.bindVertexArray(null);

    // TODO: Font rendering
    // TODO: Callbacks
  }
}

export default Renderer;
