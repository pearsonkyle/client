// Hand-written types for @wowserhq/stormjs 0.4.1, which ships none.
//
// Covers the surface the asset server uses: mounting a real directory into Emscripten's
// virtual filesystem, opening an MPQ, applying the patch chain, and reading files.

declare module '@wowserhq/stormjs' {
  export type EmscriptenFilesystems = {
    NODEFS: unknown;
    MEMFS: unknown;
    IDBFS: unknown;
  };

  export const FS: {
    filesystems: EmscriptenFilesystems;
    mkdir(path: string): void;
    mount(type: unknown, options: { root: string }, mountPoint: string): void;
    unmount(mountPoint: string): void;
  };

  export class File {
    get name(): string;
    get size(): number;
    read(): Uint8Array;
    close(): void;
  }

  export type FindData = {
    fileName: string;
    fileSize: number;
    plainName?: string;
  };

  export class MPQ {
    static open(path: string, mode?: string): Promise<MPQ>;
    hasFile(fileName: string): boolean;
    openFile(fileName: string): File;
    patch(path: string, prefix?: string): void;
    search(mask: string, listfile?: string): FindData[];
    close(): void;
  }
}
