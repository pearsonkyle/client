import { assetUrl } from '../config';

type ResponseBodyType = 'text' | 'arrayBuffer';

type ResponseBody<T extends ResponseBodyType> = T extends 'arrayBuffer' ? ArrayBuffer : string;

/**
 * Loads a game file.
 *
 * Paths arrive in the form the game's own XML and Lua use - backslash-separated and of
 * inconsistent case - and are resolved against the asset server, which reads them
 * straight out of the client's MPQ chain. Absolute URLs and root-relative paths are
 * passed through untouched so ordinary web assets still work.
 */
export default async <T extends ResponseBodyType = 'text'>(
  path: string,
  bodyType: T = 'text' as T,
): Promise<ResponseBody<T>> => {
  const url = /^([a-z]+:)?\/\//i.test(path) || path.startsWith('/') ? path : assetUrl(path);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load ${path}: ${response.status} ${response.statusText}`);
  }

  return (bodyType === 'arrayBuffer'
    ? await response.arrayBuffer()
    : await response.text()) as ResponseBody<T>;
};
