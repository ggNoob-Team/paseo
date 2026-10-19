import { invokeDesktopCommand } from "@/desktop/electron/invoke";

export interface DesktopFileStat {
  size: number;
}

export async function statDesktopFile(path: string): Promise<DesktopFileStat> {
  return await invokeDesktopCommand<DesktopFileStat>("stat_local_file", { path });
}

export async function readDesktopFileChunk(input: {
  path: string;
  offset: number;
  length: number;
}): Promise<Uint8Array> {
  return await invokeDesktopCommand<Uint8Array>("read_local_file_chunk", input);
}
