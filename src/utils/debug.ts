// This file contains utility functions for assisting with debugging in the application.

/**
 * Generate path for debug files.
 * @param fileName - The name of the file to be created.
 * @returns The full path to the debug file.
 */
export function getDebugFilePath(fileName: string): string {
  return `./src/debug/${fileName}`;
}

/**
 * Generate test input file path.
 * @param fileName - The name of the test input file.
 * @returns The full path to the test input file.
 */
export function getTestInputFilePath(
  fileName:
    | "input.pdf"
    | "input2.pdf"
    | "input3.pdf"
    | "input4.pdf"
    | "input5.pdf"
    | "input6.pdf"
    | "input7.pdf"
    | "input8.pdf"
): string {
  return `./src/test/${fileName}`;
}
