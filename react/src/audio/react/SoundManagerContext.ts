import { createContext } from 'react';
import type { SoundManager } from '../AudioTypes';

export const SoundManagerContext = createContext<SoundManager | null>(null);
