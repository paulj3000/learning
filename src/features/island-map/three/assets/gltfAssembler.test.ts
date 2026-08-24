import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { assembleGltfDocument, hexToRgb01, type MeshPart } from './gltfAssembler';
import { buildBoxPrimitive, buildConePrimitive } from './primitives';

function parse(document: Record<string, unknown>): Promise<GLTF> {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(
      JSON.stringify(document),
      '',
      resolve,
      (error: unknown) => reject(error instanceof Error ? error : new Error(String(error))),
    );
  });
}

describe('hexToRgb01', () => {
  it('converts a 0xRRGGBB hex color into a 0..1 rgb triplet', () => {
    expect(hexToRgb01(0xff0000)).toEqual([1, 0, 0]);
    expect(hexToRgb01(0x000000)).toEqual([0, 0, 0]);
    expect(hexToRgb01(0xffffff)).toEqual([1, 1, 1]);
  });
});

describe('assembleGltfDocument', () => {
  it('produces valid JSON accepted by the real GLTFLoader for a single static part', async () => {
    const part: MeshPart = { name: 'Box', primitive: buildBoxPrimitive(1, 1, 1), color: hexToRgb01(0x808080) };
    const document = assembleGltfDocument({ parts: [part] });

    const gltf = await parse(document);
    const mesh = gltf.scene.getObjectByName('Box');
    expect(mesh).toBeDefined();
    expect(gltf.animations).toHaveLength(0);
  });

  it('assembles multiple named parts as independent root nodes with their own transforms', async () => {
    const parts: MeshPart[] = [
      { name: 'Body', primitive: buildBoxPrimitive(0.5, 0.7, 0.35), color: hexToRgb01(0x7a5230) },
      { name: 'Head', primitive: buildBoxPrimitive(0.3, 0.3, 0.3), color: hexToRgb01(0xd9a670), translation: [0, 0.7, 0] },
    ];
    const document = assembleGltfDocument({ parts });

    const gltf = await parse(document);
    expect(gltf.scene.children).toHaveLength(2);
    const head = gltf.scene.getObjectByName('Head');
    expect(head?.position.y).toBeCloseTo(0.7);
  });

  it('produces a named, playable TRS animation clip targeting the right node', async () => {
    const parts: MeshPart[] = [
      { name: 'Lid', primitive: buildBoxPrimitive(0.6, 0.12, 0.4), color: hexToRgb01(0xb3872c) },
    ];
    const document = assembleGltfDocument({
      parts,
      animations: [
        {
          name: 'Open',
          channels: [
            {
              targetPart: 'Lid',
              path: 'rotation',
              times: [0, 0.8],
              values: [0, 0, 0, 1, -0.5, 0, 0, 0.87],
            },
          ],
        },
      ],
    });

    const gltf = await parse(document);
    expect(gltf.animations).toHaveLength(1);
    expect(gltf.animations[0].name).toBe('Open');
    expect(gltf.animations[0].duration).toBeCloseTo(0.8);
    expect(gltf.animations[0].tracks[0].name).toBe('Lid.quaternion');
  });

  it('throws when an animation channel targets an unknown part', () => {
    const parts: MeshPart[] = [{ name: 'Box', primitive: buildBoxPrimitive(1, 1, 1), color: hexToRgb01(0x808080) }];
    expect(() =>
      assembleGltfDocument({
        parts,
        animations: [
          { name: 'Idle', channels: [{ targetPart: 'DoesNotExist', path: 'translation', times: [0], values: [0, 0, 0] }] },
        ],
      }),
    ).toThrow(/unknown part/);
  });

  it('includes accessor min/max bounds on every POSITION accessor', () => {
    const part: MeshPart = { name: 'Cone', primitive: buildConePrimitive(0.5, 1.4, 8), color: hexToRgb01(0x6b4a34) };
    const document = assembleGltfDocument({ parts: [part] }) as { accessors: { type: string; min?: number[]; max?: number[] }[] };
    const positionAccessor = document.accessors[0];
    expect(positionAccessor.type).toBe('VEC3');
    expect(positionAccessor.min).toBeDefined();
    expect(positionAccessor.max).toBeDefined();
    expect(positionAccessor.min![1]).toBeCloseTo(0);
    expect(positionAccessor.max![1]).toBeCloseTo(1.4);
  });
});
