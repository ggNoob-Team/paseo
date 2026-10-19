/**
 * Largest file either upload path accepts. Clients check this before reading
 * and the daemon checks the declared size before accepting transfer frames.
 */
export const MAX_FILE_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_FILE_UPLOAD_LABEL = "2GB";
