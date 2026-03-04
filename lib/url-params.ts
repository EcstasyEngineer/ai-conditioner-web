export interface SessionParams {
  theme: string;
  petName: string;
  dominantName: string;
  duration: number; // minutes
}

/**
 * Encode session params to URL search string
 */
export function encodeSessionParams(params: SessionParams): string {
  const searchParams = new URLSearchParams({
    theme: params.theme,
    pet: params.petName,
    dom: params.dominantName,
    dur: params.duration.toString(),
  });
  return searchParams.toString();
}

/**
 * Decode session params from URL search string
 * Returns null if required params are missing
 */
export function decodeSessionParams(search: string): SessionParams | null {
  const params = new URLSearchParams(search);

  const theme = params.get('theme');
  const petName = params.get('pet');
  const dominantName = params.get('dom');
  const duration = params.get('dur');

  if (!theme || !petName || !dominantName || !duration) {
    return null;
  }

  const durationNum = parseInt(duration, 10);
  if (isNaN(durationNum) || durationNum <= 0) {
    return null;
  }

  return {
    theme,
    petName,
    dominantName,
    duration: durationNum,
  };
}

/**
 * Build a shareable URL for a session
 */
export function buildSessionUrl(params: SessionParams): string {
  return `${window.location.origin}/play?${encodeSessionParams(params)}`;
}
