/**
 * Anything a Three.js engine handle needs to expose for cleanup. Lives outside the React
 * host (`ThreeGameContainer.tsx`, which re-exports it) so engine modules can name it without
 * importing React (LAI-0203).
 */
export interface ThreeEngineHandle {
  dispose(): void;
}
